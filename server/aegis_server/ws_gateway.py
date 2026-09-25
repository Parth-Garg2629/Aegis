"""
ws_gateway.py — E1 Hardened WebSocket Gateway
==============================================
E1 additions over Phase A skeleton:
 1. Message size limit (>2 MB → E-SRV-03)
 2. Envelope validation before dispatch (E-PROTO-01)
 3. session_resume → session_resumed handler
 4. Step-number correlation for context_update (E-SRV-05)
 5. Demo-grade auth token via ?token= query param (ADR-11)
 6. Idle timeout 120 s (E-SRV-06)
 7. VLM processing timeout 30 s (E-SRV-06)
 8. Disconnect → DISCONNECTED_GRACE session state
 9. Privacy: goal text never logged
10. E-SRV-* error codes for server-side errors
"""

import asyncio
import os
from datetime import datetime, timezone
import json
from typing import Any, Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from aegis_server.protocol import (
    ActionMessage,
    ActionPayload,
    ActionResultMessage,
    BaseEnvelope,
    ContextUpdateMessage,
    PingMessage,
    PongMessage,
    SessionCreatedMessage,
    SessionCreatedPayload,
    SessionEndMessage,
    SessionErrorMessage,
    SessionErrorPayload,
    SessionInitMessage,
    SessionResumeMessage,
    SessionResumedMessage,
    SessionResumedPayload,
)
from aegis_server.orchestrator import orchestrator
from aegis_server.session import session_manager, SessionState
from aegis_server.audit_db import audit_db
from aegis_server.slog import slog

# ── Constants ────────────────────────────────────────────────────────────────
MAX_MESSAGE_BYTES: int = 2 * 1024 * 1024   # 2 MB
IDLE_TIMEOUT_SECONDS: float = 120.0
VLM_TIMEOUT_SECONDS: float = 30.0


def make_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_error(
    session_id: str,
    error_code: str,
    error_message: str,
    recoverable: bool = False,
    suggested_action: Optional[str] = None,
) -> SessionErrorMessage:
    return SessionErrorMessage(
        session_id=session_id,
        timestamp=make_timestamp(),
        payload=SessionErrorPayload(
            error_code=error_code,
            error_message=error_message,
            recoverable=recoverable,
            suggested_action=suggested_action,  # type: ignore[arg-type]
        ),
    )


def check_auth_token(token: Optional[str]) -> bool:
    """
    Demo-grade authentication (ADR-11).
    If AEGIS_AUTH_TOKEN env var is not set → allow all (localhost demo mode).
    If set → token must match exactly.
    The token value is NEVER logged, persisted, or included in VLM prompts.
    """
    server_token = os.environ.get("AEGIS_AUTH_TOKEN", "")
    if not server_token:
        return True
    return bool(token and token == server_token)


async def handle_websocket_connection(
    websocket: WebSocket, token: Optional[str] = None
) -> None:
    """
    Main E1-hardened WebSocket handler.
    Called by main.py with the ?token= query parameter forwarded.
    """
    # ── Demo auth — checked before accept() ─────────────────────────────────
    if not check_auth_token(token):
        await websocket.close(code=4001)
        # Never log the token value
        slog.warn(module="WS_GATEWAY", event="AUTH_REJECTED")
        return

    await websocket.accept()
    current_session_id: Optional[str] = None

    slog.info(module="WS_GATEWAY", event="CLIENT_CONNECTED")

    try:
        while True:
            # ── Idle timeout ─────────────────────────────────────────────────
            try:
                raw_text: str = await asyncio.wait_for(
                    websocket.receive_text(), timeout=IDLE_TIMEOUT_SECONDS
                )
            except asyncio.TimeoutError:
                slog.warn(
                    module="WS_GATEWAY",
                    event="IDLE_TIMEOUT",
                    session_id=current_session_id or "unknown",
                )
                try:
                    err = _make_error(
                        current_session_id or "unknown",
                        "E-SRV-06",
                        "Connection idle timeout",
                        recoverable=False,
                        suggested_action="reconnect",
                    )
                    await websocket.send_text(err.model_dump_json())
                except Exception:
                    pass
                break

            # ── Size limit ───────────────────────────────────────────────────
            if len(raw_text.encode("utf-8")) > MAX_MESSAGE_BYTES:
                slog.warn(
                    module="WS_GATEWAY",
                    event="MESSAGE_TOO_LARGE",
                    session_id=current_session_id or "unknown",
                )
                try:
                    err = _make_error(
                        current_session_id or "unknown",
                        "E-SRV-03",
                        "Message exceeds maximum allowed size",
                        recoverable=False,
                    )
                    await websocket.send_text(err.model_dump_json())
                except Exception:
                    pass
                break

            # ── JSON parse ───────────────────────────────────────────────────
            try:
                data: Dict[str, Any] = json.loads(raw_text)
            except Exception:
                err = _make_error(
                    current_session_id or "unknown",
                    "E-PROTO-01",
                    "Malformed JSON",
                    recoverable=False,
                )
                await websocket.send_text(err.model_dump_json())
                continue

            # ── Envelope validation ──────────────────────────────────────────
            # Validate all required envelope fields before dispatch.
            # Raw payload content is never included in error messages.
            try:
                BaseEnvelope.model_validate(data)
            except ValidationError:
                err = _make_error(
                    current_session_id or "unknown",
                    "E-PROTO-01",
                    "Invalid message envelope: missing or malformed required fields",
                    recoverable=False,
                )
                await websocket.send_text(err.model_dump_json())
                continue

            msg_type: Any = data.get("type")

            # ── session_init ──────────────────────────────────────────────────
            if msg_type == "session_init":
                try:
                    init_msg = SessionInitMessage.model_validate(data)
                    session = session_manager.create_session(
                        goal=init_msg.payload.goal,
                        client_metadata=init_msg.payload.client_metadata,
                        server_max_steps=30,
                    )
                    current_session_id = session.session_id

                    # Privacy: goal text is NOT logged
                    slog.info(
                        module="WS_GATEWAY",
                        event="SESSION_INITIALIZED",
                        session_id=current_session_id,
                    )

                    audit_db.record_session_start(
                        session_id=current_session_id,
                        protocol_version=init_msg.protocol_version,
                        client_metadata=init_msg.payload.client_metadata,
                        start_time=init_msg.timestamp
                    )

                    created_msg = SessionCreatedMessage(
                        session_id=current_session_id,
                        timestamp=make_timestamp(),
                        payload=SessionCreatedPayload(server_max_steps=session.max_steps),
                    )
                    await websocket.send_text(created_msg.model_dump_json())
                    
                    # After init, the server waits for the first context update
                    session.set_waiting_context()

                except ValidationError:
                    err = _make_error(
                        "unknown",
                        "E-PROTO-02",
                        "Invalid session_init payload",
                        recoverable=False,
                    )
                    await websocket.send_text(err.model_dump_json())
                except Exception:
                    err = _make_error(
                        "unknown",
                        "E-SRV-01",
                        "Session initialization failed",
                        recoverable=False,
                    )
                    await websocket.send_text(err.model_dump_json())

            # ── session_resume ────────────────────────────────────────────────
            elif msg_type == "session_resume":
                try:
                    resume_msg = SessionResumeMessage.model_validate(data)
                    session = session_manager.get_session(resume_msg.session_id)

                    if session and session.state == SessionState.DISCONNECTED_GRACE:
                        session.resume()
                        current_session_id = session.session_id
                        resumed = SessionResumedMessage(
                            session_id=session.session_id,
                            timestamp=make_timestamp(),
                            payload=SessionResumedPayload(
                                resumed=True,
                                server_step=session.current_step,
                                reason="Session resumed within grace period",
                            ),
                        )
                        await websocket.send_text(resumed.model_dump_json())
                        slog.info(
                            module="WS_GATEWAY",
                            event="SESSION_RESUMED",
                            session_id=session.session_id,
                            step_number=session.current_step,
                        )
                    else:
                        # Not found or expired
                        not_resumed = SessionResumedMessage(
                            session_id=resume_msg.session_id,
                            timestamp=make_timestamp(),
                            payload=SessionResumedPayload(
                                resumed=False,
                                server_step=None,
                                reason="Session not found or grace period expired",
                            ),
                        )
                        await websocket.send_text(not_resumed.model_dump_json())
                        slog.warn(
                            module="WS_GATEWAY",
                            event="SESSION_RESUME_REJECTED",
                            session_id=resume_msg.session_id,
                        )
                except Exception:
                    err = _make_error(
                        data.get("session_id") or "unknown",
                        "E-SRV-02",
                        "Session resume processing failed",
                        recoverable=False,
                    )
                    await websocket.send_text(err.model_dump_json())

            # ── context_update ────────────────────────────────────────────────
            elif msg_type == "context_update":
                try:
                    ctx_msg = ContextUpdateMessage.model_validate(data)
                except ValidationError:
                    err = _make_error(
                        data.get("session_id") or "unknown",
                        "E-PROTO-01",
                        "Invalid context_update payload",
                        recoverable=False,
                    )
                    await websocket.send_text(err.model_dump_json())
                    continue

                session = session_manager.get_session(ctx_msg.session_id)
                if not session:
                    err = _make_error(
                        ctx_msg.session_id,
                        "E-SESSION-01",
                        f"Session '{ctx_msg.session_id}' not found",
                        recoverable=False,
                    )
                    await websocket.send_text(err.model_dump_json())
                    continue

                # ── Step counting: Enforce server-side max_steps ─────────────
                if ctx_msg.payload.step_number > session.max_steps:
                    err = _make_error(
                        ctx_msg.session_id,
                        "E-SESSION-02",
                        f"Maximum step limit ({session.max_steps}) reached.",
                        recoverable=False,
                    )
                    await websocket.send_text(err.model_dump_json())
                    session.terminate()
                    continue

                # ── Step-number correlation (E-SRV-05) ──────────────────────
                if ctx_msg.payload.step_number != session.current_step:
                    slog.warn(
                        module="WS_GATEWAY",
                        event="STEP_CORRELATION_MISMATCH",
                        session_id=ctx_msg.session_id,
                        step_number=ctx_msg.payload.step_number,
                    )
                    err = _make_error(
                        ctx_msg.session_id,
                        "E-SRV-05",
                        (
                            f"Step number mismatch: expected {session.current_step}, "
                            f"got {ctx_msg.payload.step_number}"
                        ),
                        recoverable=True,
                    )
                    await websocket.send_text(err.model_dump_json())
                    continue

                # ── VLM with timeout ──────────────────────────────────────────
                try:
                    action, risk_assessment = await asyncio.wait_for(
                        asyncio.to_thread(
                            orchestrator.decide_next_action, session, ctx_msg.payload
                        ),
                        timeout=VLM_TIMEOUT_SECONDS,
                    )
                    # Now that the orchestrator is purely an engine, the gateway handles session data updates
                    session.update_context(ctx_msg.payload)
                    session.record_action(action)
                    
                except asyncio.TimeoutError:
                    slog.warn(
                        module="WS_GATEWAY",
                        event="VLM_TIMEOUT",
                        session_id=ctx_msg.session_id,
                        step_number=ctx_msg.payload.step_number,
                    )
                    err = _make_error(
                        ctx_msg.session_id,
                        "E-SRV-06",
                        "VLM processing timeout",
                        recoverable=True,
                        suggested_action="retry",
                    )
                    await websocket.send_text(err.model_dump_json())
                    continue
                except Exception:
                    err = _make_error(
                        ctx_msg.session_id,
                        "E-SRV-04",
                        "Error processing context update",
                        recoverable=True,
                        suggested_action="retry",
                    )
                    await websocket.send_text(err.model_dump_json())
                    continue

                action_msg = ActionMessage(
                    session_id=session.session_id,
                    timestamp=make_timestamp(),
                    payload=ActionPayload(
                        step_number=ctx_msg.payload.step_number, 
                        action=action,
                        risk_assessment=risk_assessment
                    ),
                )
                await websocket.send_text(action_msg.model_dump_json())

            # ── action_result ─────────────────────────────────────────────────
            elif msg_type == "action_result":
                try:
                    result_msg = ActionResultMessage.model_validate(data)
                    slog.info(
                        module="WS_GATEWAY",
                        event="ACTION_RESULT_RECEIVED",
                        session_id=result_msg.session_id,
                        step_number=result_msg.payload.step_number,
                        success=result_msg.payload.success,
                        action_type=result_msg.payload.action_type,
                    )
                except Exception:
                    slog.warn(
                        module="WS_GATEWAY",
                        event="ACTION_RESULT_PARSE_ERROR",
                        session_id=current_session_id or "unknown",
                    )

            # ── session_end ───────────────────────────────────────────────────
            elif msg_type == "session_end":
                try:
                    end_msg = SessionEndMessage.model_validate(data)
                    session = session_manager.get_session(end_msg.session_id)
                    if session:
                        session.terminate()
                    slog.info(
                        module="WS_GATEWAY",
                        event="SESSION_ENDED",
                        session_id=end_msg.session_id,
                        reason=end_msg.payload.reason,
                        step_number=end_msg.payload.final_step,
                    )
                    audit_db.record_session_end(
                        session_id=end_msg.session_id,
                        end_time=make_timestamp(),
                        total_steps=end_msg.payload.final_step,
                        termination_reason=end_msg.payload.reason,
                        is_success=end_msg.payload.reason == "goal_achieved"
                    )
                except Exception:
                    slog.warn(
                        module="WS_GATEWAY",
                        event="SESSION_END_PARSE_ERROR",
                        session_id=current_session_id or "unknown",
                    )
                break

            # ── ping ──────────────────────────────────────────────────────────
            elif msg_type == "ping":
                try:
                    ping_msg = PingMessage.model_validate(data)
                    pong_msg = PongMessage(
                        session_id=ping_msg.session_id,
                        timestamp=make_timestamp(),
                        payload={},
                    )
                    await websocket.send_text(pong_msg.model_dump_json())
                except Exception:
                    slog.warn(
                        module="WS_GATEWAY",
                        event="PING_PARSE_ERROR",
                        session_id=current_session_id or "unknown",
                    )

            # ── unknown type — silently discard (API_SPEC §5.2) ───────────────
            else:
                slog.warn(
                    module="WS_GATEWAY",
                    event="UNKNOWN_MESSAGE_TYPE",
                    session_id=current_session_id or "unknown",
                )

    except WebSocketDisconnect:
        slog.info(
            module="WS_GATEWAY",
            event="CLIENT_DISCONNECTED",
            session_id=current_session_id or "unknown",
        )
        # Transition to grace period to allow reconnect
        if current_session_id:
            session = session_manager.get_session(current_session_id)
            if session and session.state not in (
                SessionState.TERMINATED,
                SessionState.DISCONNECTED_GRACE,
            ):
                session.mark_disconnected()
    except Exception:
        slog.error(
            module="WS_GATEWAY",
            event="WEBSOCKET_EXCEPTION",
            session_id=current_session_id or "unknown",
        )
