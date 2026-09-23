import json
from fastapi.testclient import TestClient
from aegis_server.main import app


def test_health_endpoint():
    client = TestClient(app)
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["protocol_version"] == "1.0"


def test_websocket_walking_skeleton_cycles():
    client = TestClient(app)

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
