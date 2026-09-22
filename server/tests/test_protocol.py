"""
Contract tests for AEGIS Server Protocol Models
Source of Truth: docs/API_SPEC.md §18
"""

import pytest
from pydantic import ValidationError
from aegis_server.protocol import (
    ContextUpdateMessage,
    ActionMessage,
    ActionResultMessage,
    SessionInitMessage,
    SessionCreatedMessage,
    ActionObject,
)


def test_golden_context_update_contract():
    # Verbatim golden message from API_SPEC §18 Step 5
    raw = {
        "type": "context_update",
        "session_id": "sess-abc123",
        "timestamp": "2026-09-19T10:30:20.000Z",
        "protocol_version": "1.0",
        "payload": {
            "step_number": 5,
            "agent_state": "running",
            "sanitized_screenshot": "<base64-webp>",
            "screenshot_format": "webp",
            "sanitized_schema": {
                "url": "https://www.irctc.co.in/booking/passengers",
                "title": "Passenger Details - IRCTC",
                "elements": [
                    {
                        "id": "el-10",
                        "tagName": "input",
                        "type": "text",
                        "role": None,
                        "label": "Passenger Name",
                        "text": None,
                        "value": "",
                        "boundingBox": {"x": 100, "y": 180, "width": 300, "height": 36},
                        "isVisible": True,
                        "isDisabled": False,
                        "isReadOnly": False,
                        "isInteractive": True,
                        "parentFormId": "form-passengers",
                        "attributes": {
                            "name": "passengerName",
                            "placeholder": "Full name as on ID",
                        },
                    },
                    {
                        "id": "el-11",
                        "tagName": "input",
                        "type": "text",
                        "role": None,
                        "label": "Aadhaar Number",
                        "text": None,
                        "value": "[REDACTED_AADHAAR]",
                        "boundingBox": {"x": 100, "y": 240, "width": 300, "height": 36},
                        "isVisible": True,
                        "isDisabled": False,
                        "isReadOnly": False,
                        "isInteractive": True,
                        "parentFormId": "form-passengers",
                        "attributes": {"name": "aadhaar", "placeholder": "12-digit Aadhaar"},
                    },
                    {
                        "id": "el-12",
                        "tagName": "button",
                        "type": "submit",
                        "role": "button",
                        "label": "Continue to Payment",
                        "text": "Continue to Payment",
                        "value": None,
                        "boundingBox": {"x": 200, "y": 400, "width": 180, "height": 44},
                        "isVisible": True,
                        "isDisabled": False,
                        "isReadOnly": False,
                        "isInteractive": True,
                        "parentFormId": "form-passengers",
                        "attributes": {"name": "continueBtn"},
                    },
                ],
                "forms": [
                    {
                        "id": "form-passengers",
                        "action": "/booking/payment",
                        "method": "POST",
                        "elementIds": ["el-10", "el-11", "el-12"],
                    }
                ],
            },
            "previous_action_result": {
                "action_type": "select",
                "target_element_id": "el-08",
                "success": True,
                "error_code": None,
                "error_message": None,
                "local_input_status": None,
            },
        },
    }

    msg = ContextUpdateMessage.model_validate(raw)
    assert msg.type == "context_update"
    assert msg.payload.step_number == 5
    assert len(msg.payload.sanitized_schema.elements) == 3
    assert msg.payload.sanitized_schema.elements[1].value == "[REDACTED_AADHAAR]"


def test_golden_action_contract():
    # Verbatim golden message from API_SPEC §18 Step 5
    raw = {
        "type": "action",
        "session_id": "sess-abc123",
        "timestamp": "2026-09-19T10:30:23.500Z",
        "protocol_version": "1.0",
        "payload": {
            "step_number": 5,
            "action": {
                "action_type": "type",
                "target": "el-10",
                "value": "Rahul Sharma",
                "reasoning": "The Passenger Name field is empty. I will type the name.",
            },
        },
    }

    msg = ActionMessage.model_validate(raw)
    assert msg.type == "action"
    assert msg.payload.action.action_type == "type"
    assert msg.payload.action.target == "el-10"


def test_golden_action_result_contract():
    # Verbatim golden message from API_SPEC §18 Step 5
    raw = {
        "type": "action_result",
        "session_id": "sess-abc123",
        "timestamp": "2026-09-19T10:30:24.100Z",
        "protocol_version": "1.0",
        "payload": {
            "step_number": 5,
            "action_type": "type",
            "success": True,
            "error_code": None,
            "error_message": None,
            "local_input_status": None,
        },
    }

    msg = ActionResultMessage.model_validate(raw)
    assert msg.type == "action_result"
    assert msg.payload.success is True


def test_action_object_vocabulary_restriction():
    valid = ActionObject(action_type="click", target="el-1")
    assert valid.action_type == "click"

    with pytest.raises(ValidationError):
        ActionObject(action_type="execute_script")  # arbitrary execution not allowed
