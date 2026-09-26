"""
test_ws_gateway.py — E1 Gateway Hardening Tests
================================================
Tests for:
- Malformed JSON rejection
- Envelope validation
- Unknown message type silently discarded
- Oversized message rejection
- Step-number correlation
- Session resume (valid + expired)
- Ping/pong
- Auth token enforcement
- Existing walking skeleton regression
"""

import json
import os

import pytest
from fastapi.testclient import TestClient

from aegis_server.main import app
from aegis_server.session import session_manager, SessionState

# ── Helper fixtures / payloads ────────────────────────────────────────────────

VALID_INIT = {
    "type": "session_init",
    "session_id": None,
    "timestamp": "2026-09-22T12:00:00Z",
    "protocol_version": "1.0",
    "payload": {
        "goal": "Search for scholarships on FP-01",
        "client_metadata": {
            "extension_version": "1.0.0",
            "browser": "chrome",
            "browser_version": "120.0",
            "max_steps": 30,
        },
    },
}

VALID_ELEMENT = {
    "id": "el-search-input",
    "tagName": "input",
    "type": "text",
    "boundingBox": {"x": 10, "y": 20, "width": 200, "height": 30},
    "isVisible": True,
    "isDisabled": False,
    "isReadOnly": False,
    "isInteractive": True,
}

VALID_CTX_STEP1 = {
    "type": "context_update",
    "session_id": None,  # filled per test
    "timestamp": "2026-09-22T12:00:01Z",
    "protocol_version": "1.0",
    "payload": {
        "step_number": 1,
        "agent_state": "running",
        "sanitized_screenshot": "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=",
        "screenshot_format": "webp",
        "sanitized_schema": {
            "url": "http://localhost:8000/fixtures/fp_01.html",
            "title": "FP-01",
            "elements": [VALID_ELEMENT],
        },
        "previous_action_result": None,
    },
}


def _make_client():
    return TestClient(app)


def _init_session(ws) -> str:
    ws.send_text(json.dumps(VALID_INIT))
    resp = json.loads(ws.receive_text())
    assert resp["type"] == "session_created"
    return resp["session_id"]


# ── Health endpoint ────────────────────────────────────────────────────────────

def test_health_endpoint():
    client = _make_client()
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["protocol_version"] == "1.0"


# ── E1: Malformed JSON rejection ──────────────────────────────────────────────

def test_malformed_json_rejected():
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        ws.send_text("this is not json{{{{")
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_error"
        assert resp["payload"]["error_code"] == "E-PROTO-01"
        # Error message must NOT contain the raw payload
        assert "this is not json" not in resp["payload"]["error_message"]


# ── E1: Missing envelope fields ───────────────────────────────────────────────

def test_missing_envelope_fields():
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        # Missing 'type' and 'timestamp' required by BaseEnvelope
        ws.send_text(json.dumps({"payload": {}}))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_error"
        assert resp["payload"]["error_code"] == "E-PROTO-01"


def test_missing_timestamp_rejected():
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        # Has type but no timestamp (BaseEnvelope requires it)
        ws.send_text(json.dumps({"type": "ping", "session_id": "x", "protocol_version": "1.0", "payload": {}}))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_error"
        assert resp["payload"]["error_code"] == "E-PROTO-01"


# ── E1: Unknown message type silently discarded ───────────────────────────────

def test_unknown_message_type_discarded():
    """
    Unknown type must be discarded — no error response, no crash.
    We verify by sending a valid envelope with an unknown type and checking
    that no response is emitted (the server stays alive for the next message).
    """
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        # Send valid envelope with unknown type
        unknown_msg = {
            "type": "invented_type",
            "session_id": None,
            "timestamp": "2026-09-22T12:00:00Z",
            "protocol_version": "1.0",
            "payload": {},
        }
        ws.send_text(json.dumps(unknown_msg))

        # Now send a valid session_init — server must still respond
        ws.send_text(json.dumps(VALID_INIT))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_created"


# ── E1: Oversized message ─────────────────────────────────────────────────────

def test_oversized_message_rejected():
    """Message exceeding 2 MB must be rejected with E-SRV-03."""
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        # Build a JSON string that is >2 MB
        big_payload = {"type": "ping", "session_id": "x",
                       "timestamp": "2026-09-22T12:00:00Z",
                       "protocol_version": "1.0",
                       "payload": {"data": "A" * (2 * 1024 * 1024 + 1)}}
        ws.send_text(json.dumps(big_payload))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_error"
        assert resp["payload"]["error_code"] == "E-SRV-03"


# ── E1: Step-number correlation ───────────────────────────────────────────────

def test_step_number_correlation():
    """context_update with wrong step_number → E-SRV-05."""
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        session_id = _init_session(ws)

        # Send step=5 when server expects step=1
        wrong_step_ctx = dict(VALID_CTX_STEP1)
        wrong_step_ctx = json.loads(json.dumps(wrong_step_ctx))  # deep copy
        wrong_step_ctx["session_id"] = session_id
        wrong_step_ctx["payload"]["step_number"] = 5  # wrong!

        ws.send_text(json.dumps(wrong_step_ctx))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_error"
        assert resp["payload"]["error_code"] == "E-SRV-05"


def test_correct_step_number_accepted():
    """context_update with correct step_number → action response."""
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        session_id = _init_session(ws)

        ctx = json.loads(json.dumps(VALID_CTX_STEP1))
        ctx["session_id"] = session_id

        ws.send_text(json.dumps(ctx))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "action"
        assert resp["payload"]["step_number"] == 1


# ── E1: Ping / pong ───────────────────────────────────────────────────────────

def test_ping_pong():
    """Send ping → receive pong with matching session_id."""
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        session_id = _init_session(ws)

        ping = {
            "type": "ping",
            "session_id": session_id,
            "timestamp": "2026-09-22T12:00:00Z",
            "protocol_version": "1.0",
            "payload": {},
        }
        ws.send_text(json.dumps(ping))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "pong"
        assert resp["session_id"] == session_id


# ── E1: Session resume — valid ────────────────────────────────────────────────

def test_session_resume_valid():
    """
    After disconnect, a session enters DISCONNECTED_GRACE.
    A new WS connection sending session_resume should get session_resumed(resumed=True).
    """
    client = _make_client()

    # First connection — create session and disconnect
    with client.websocket_connect("/ws") as ws:
        session_id = _init_session(ws)

    # Manually put session into DISCONNECTED_GRACE (simulating ws disconnect)
    session = session_manager.get_session(session_id)
    assert session is not None
    session.mark_disconnected()
    assert session.state == SessionState.DISCONNECTED_GRACE

    # Second connection — resume
    with client.websocket_connect("/ws") as ws2:
        resume_msg = {
            "type": "session_resume",
            "session_id": session_id,
            "timestamp": "2026-09-22T12:01:00Z",
            "protocol_version": "1.0",
            "payload": {"last_known_step": 1},
        }
        ws2.send_text(json.dumps(resume_msg))
        resp = json.loads(ws2.receive_text())
        assert resp["type"] == "session_resumed"
        assert resp["payload"]["resumed"] is True
        assert resp["session_id"] == session_id


# ── E1: Session resume — expired ─────────────────────────────────────────────

def test_session_resume_expired():
    """Resume of unknown/non-existent session → session_resumed(resumed=False)."""
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        resume_msg = {
            "type": "session_resume",
            "session_id": "nonexistent-session-id",
            "timestamp": "2026-09-22T12:01:00Z",
            "protocol_version": "1.0",
            "payload": {"last_known_step": 1},
        }
        ws.send_text(json.dumps(resume_msg))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_resumed"
        assert resp["payload"]["resumed"] is False


def test_session_resume_active_session_rejected():
    """Resume of a session in ACTIVE state → session_resumed(resumed=False)."""
    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        session_id = _init_session(ws)

        # Session is ACTIVE, not in grace period
        resume_msg = {
            "type": "session_resume",
            "session_id": session_id,
            "timestamp": "2026-09-22T12:01:00Z",
            "protocol_version": "1.0",
            "payload": {"last_known_step": 1},
        }
        ws.send_text(json.dumps(resume_msg))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_resumed"
        assert resp["payload"]["resumed"] is False


# ── E1: Auth token when configured ───────────────────────────────────────────

def test_auth_token_when_configured(monkeypatch):
    """
    When AEGIS_AUTH_TOKEN is set, connections without valid token are rejected.
    The auth token value is never logged.
    """
    monkeypatch.setenv("AEGIS_AUTH_TOKEN", "test-secret-token-123")

    client = _make_client()

    # No token — should be rejected (4001 close)
    with pytest.raises(Exception):
        with client.websocket_connect("/ws") as ws:
            ws.send_text(json.dumps(VALID_INIT))
            ws.receive_text()  # should not get here


def test_auth_token_valid_passes(monkeypatch):
    """Valid token → connection accepted."""
    monkeypatch.setenv("AEGIS_AUTH_TOKEN", "valid-test-token")

    client = _make_client()
    with client.websocket_connect("/ws?token=valid-test-token") as ws:
        ws.send_text(json.dumps(VALID_INIT))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_created"


def test_auth_token_not_set_allows_all(monkeypatch):
    """When AEGIS_AUTH_TOKEN is not set, all connections are allowed (demo mode)."""
    monkeypatch.delenv("AEGIS_AUTH_TOKEN", raising=False)

    client = _make_client()
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps(VALID_INIT))
        resp = json.loads(ws.receive_text())
        assert resp["type"] == "session_created"


# ── Regression: Full walking skeleton ─────────────────────────────────────────

def test_websocket_walking_skeleton_cycles():
    """Regression: Phase A walking skeleton still works after E1 hardening."""
    client = _make_client()

    with client.websocket_connect("/ws") as ws:
        init_payload = {
            "type": "session_init",
            "session_id": None,
            "timestamp": "2026-09-22T12:00:00Z",
            "protocol_version": "1.0",
            "payload": {
                "goal": "Search for scholarships on FP-01",
                "client_metadata": {
                    "extension_version": "1.0.0",
                    "browser": "chrome",
                    "browser_version": "120.0",
                    "max_steps": 30,
                },
            },
        }
        ws.send_text(json.dumps(init_payload))

        created_raw = ws.receive_text()
        created_data = json.loads(created_raw)
        assert created_data["type"] == "session_created"
        session_id = created_data["session_id"]
        assert session_id is not None
        assert created_data["payload"]["server_max_steps"] == 30

        ctx1 = {
            "type": "context_update",
            "session_id": session_id,
            "timestamp": "2026-09-22T12:00:01Z",
            "protocol_version": "1.0",
            "payload": {
                "step_number": 1,
                "agent_state": "running",
                "sanitized_screenshot": "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=",
                "screenshot_format": "webp",
                "sanitized_schema": {
                    "url": "http://localhost:8000/fixtures/fp_01.html",
                    "title": "FP-01",
                    "elements": [
                        {
                            "id": "el-search-input",
                            "tagName": "input",
                            "type": "text",
                            "boundingBox": {"x": 10, "y": 20, "width": 200, "height": 30},
                            "isVisible": True,
                            "isDisabled": False,
                            "isReadOnly": False,
                            "isInteractive": True,
                        }
                    ],
                },
                "previous_action_result": None,
            },
        }
        ws.send_text(json.dumps(ctx1))

        action1_raw = ws.receive_text()
        action1_data = json.loads(action1_raw)
        assert action1_data["type"] == "action"
        assert action1_data["payload"]["step_number"] == 1
        assert action1_data["payload"]["action"]["action_type"] == "type"

        res1 = {
            "type": "action_result",
            "session_id": session_id,
            "timestamp": "2026-09-22T12:00:02Z",
            "protocol_version": "1.0",
            "payload": {
                "step_number": 1,
                "action_type": "type",
                "success": True,
            },
        }
        ws.send_text(json.dumps(res1))

        ctx2 = {
            "type": "context_update",
            "session_id": session_id,
            "timestamp": "2026-09-22T12:00:03Z",
            "protocol_version": "1.0",
            "payload": {
                "step_number": 2,
                "agent_state": "running",
                "sanitized_screenshot": "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=",
                "screenshot_format": "webp",
                "sanitized_schema": {
                    "url": "http://localhost:8000/fixtures/fp_01.html",
                    "title": "FP-01",
                    "elements": [
                        {
                            "id": "el-submit-button",
                            "tagName": "button",
                            "type": "submit",
                            "boundingBox": {"x": 10, "y": 60, "width": 100, "height": 30},
                            "isVisible": True,
                            "isDisabled": False,
                            "isReadOnly": False,
                            "isInteractive": True,
                        }
                    ],
                },
                "previous_action_result": {
                    "step_number": 1,
                    "action_type": "type",
                    "success": True,
                },
            },
        }
        ws.send_text(json.dumps(ctx2))

        action2_raw = ws.receive_text()
        action2_data = json.loads(action2_raw)
        assert action2_data["type"] == "action"
        assert action2_data["payload"]["step_number"] == 2
        assert action2_data["payload"]["action"]["action_type"] == "click"

        res2 = {
            "type": "action_result",
            "session_id": session_id,
            "timestamp": "2026-09-22T12:00:04Z",
            "protocol_version": "1.0",
            "payload": {
                "step_number": 2,
                "action_type": "click",
                "success": True,
            },
        }
        ws.send_text(json.dumps(res2))

        ctx3 = {
            "type": "context_update",
            "session_id": session_id,
            "timestamp": "2026-09-22T12:00:05Z",
            "protocol_version": "1.0",
            "payload": {
                "step_number": 3,
                "agent_state": "running",
                "sanitized_screenshot": "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=",
                "screenshot_format": "webp",
                "sanitized_schema": {
                    "url": "http://localhost:8000/fixtures/fp_01.html",
                    "title": "FP-01",
                    "elements": [],
                },
                "previous_action_result": {
                    "step_number": 2,
                    "action_type": "click",
                    "success": True,
                },
            },
        }
        ws.send_text(json.dumps(ctx3))

        action3_raw = ws.receive_text()
        action3_data = json.loads(action3_raw)
        assert action3_data["type"] == "action"
        assert action3_data["payload"]["step_number"] == 3
        assert action3_data["payload"]["action"]["action_type"] == "done"

        end_msg = {
            "type": "session_end",
            "session_id": session_id,
            "timestamp": "2026-09-22T12:00:06Z",
            "protocol_version": "1.0",
            "payload": {
                "reason": "goal_achieved",
                "final_step": 3,
            },
        }
        ws.send_text(json.dumps(end_msg))
