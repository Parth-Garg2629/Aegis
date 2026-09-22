"""
AEGIS FastAPI WebSocket Gateway (Work Package E1)
Source of Truth: docs/API_SPEC.md §3, §5-§10, docs/IMPLEMENTATION_PLAN.md E1
Handles real-time bi-directional WebSocket communication between Extension and Backend.
"""

from datetime import datetime, timezone
import json
from typing import Any, Dict
from fastapi import WebSocket, WebSocketDisconnect
from aegis_server.protocol import (
    ActionMessage,
    ActionPayload,
    ActionResultMessage,
    ContextUpdateMessage,
    PingMessage,
    PongMessage,
    SessionCreatedMessage,
    SessionCreatedPayload,
    SessionEndMessage,
    SessionErrorMessage,
    SessionErrorPayload,
    SessionInitMessage,
)
from aegis_server.orchestrator import orchestrator
from aegis_server.session import session_manager
from aegis_server.slog import slog


def make_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


async def handle_websocket_connection(websocket: WebSocket) -> None:
    await websocket.accept()
    current_session_id: str | None = None

    slog.info(module="WS_GATEWAY", event="CLIENT_CONNECTED")

    try:
        while True:
            raw_text = await websocket.receive_text()
            try:
                data: Dict[str, Any] = json.loads(raw_text)
            except Exception as e:
                err_msg = SessionErrorMessage(
                    session_id=current_session_id or "unknown",
                    timestamp=make_timestamp(),
                    payload=SessionErrorPayload(
                        error_code="E-PROTO-01",
                        error_message=f"Malformed JSON: {str(e)}",
                        recoverable=False,
                    ),
                )
                await websocket.send_text(err_msg.model_dump_json())
                continue

            msg_type = data.get("type")

            # 1. session_init
            if msg_type == "session_init":
                try:
                    init_msg = SessionInitMessage.model_validate(data)
                    session = session_manager.create_session(
                        goal=init_msg.payload.goal,
                        client_metadata=init_msg.payload.client_metadata,
                        server_max_steps=30,
                    )
                    current_session_id = session.session_id

                    slog.info(
                        module="WS_GATEWAY",
                        event="SESSION_INITIALIZED",
                        session_id=current_session_id,
                        goal=session.goal,
                    )

                    created_msg = SessionCreatedMessage(
                        session_id=current_session_id,
                        timestamp=make_timestamp(),
                        payload=SessionCreatedPayload(server_max_steps=session.max_steps),
                    )
                    await websocket.send_text(created_msg.model_dump_json())
                except Exception as e:
                    err_msg = SessionErrorMessage(
                        session_id="unknown",
                        timestamp=make_timestamp(),
                        payload=SessionErrorPayload(
                            error_code="E-PROTO-02",
                            error_message=f"Invalid session_init message: {str(e)}",
                            recoverable=False,
                        ),
                    )
                    await websocket.send_text(err_msg.model_dump_json())

            # 2. context_update
            elif msg_type == "context_update":
                try:
                    ctx_msg = ContextUpdateMessage.model_validate(data)
                    session = session_manager.get_session(ctx_msg.session_id)
                    if not session:
                        err_msg = SessionErrorMessage(
                            session_id=ctx_msg.session_id,
                            timestamp=make_timestamp(),
                            payload=SessionErrorPayload(
                                error_code="E-SESSION-01",
                                error_message=f"Session '{ctx_msg.session_id}' not found",
                                recoverable=False,
                            ),
                        )
                        await websocket.send_text(err_msg.model_dump_json())
                        continue

                    action, step_num = orchestrator.decide_next_action(session, ctx_msg.payload)

                    action_msg = ActionMessage(
                        session_id=session.session_id,
                        timestamp=make_timestamp(),
                        payload=ActionPayload(step_number=step_num, action=action),
                    )
                    await websocket.send_text(action_msg.model_dump_json())
                except Exception as e:
                    err_msg = SessionErrorMessage(
                        session_id=data.get("session_id", "unknown"),
                        timestamp=make_timestamp(),
                        payload=SessionErrorPayload(
                            error_code="E-PROTO-03",
                            error_message=f"Error processing context_update: {str(e)}",
                            recoverable=True,
                        ),
                    )
                    await websocket.send_text(err_msg.model_dump_json())

            # 3. action_result
            elif msg_type == "action_result":
                try:
                    result_msg = ActionResultMessage.model_validate(data)
                    slog.info(
                        module="WS_GATEWAY",
                        event="ACTION_RESULT_RECEIVED",
                        session_id=result_msg.session_id,
                        step_number=result_msg.payload.step_number,
                        success=result_msg.payload.success,
                    )
                except Exception as e:
                    slog.warn(module="WS_GATEWAY", event="ACTION_RESULT_PARSE_ERROR", message=str(e))

            # 4. session_end
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
                        final_step=end_msg.payload.final_step,
                    )
                except Exception as e:
                    slog.warn(module="WS_GATEWAY", event="SESSION_END_PARSE_ERROR", message=str(e))

            # 5. ping
            elif msg_type == "ping":
                try:
                    ping_msg = PingMessage.model_validate(data)
                    pong_msg = PongMessage(
                        session_id=ping_msg.session_id,
                        timestamp=make_timestamp(),
                        payload={},
                    )
                    await websocket.send_text(pong_msg.model_dump_json())
                except Exception as e:
                    slog.warn(module="WS_GATEWAY", event="PING_PARSE_ERROR", message=str(e))

            else:
                slog.warn(module="WS_GATEWAY", event="UNHANDLED_MESSAGE_TYPE", msg_type=msg_type)

    except WebSocketDisconnect:
        slog.info(module="WS_GATEWAY", event="CLIENT_DISCONNECTED", session_id=current_session_id)
    except Exception as e:
        slog.error(module="WS_GATEWAY", event="WEBSOCKET_EXCEPTION", message=str(e))
