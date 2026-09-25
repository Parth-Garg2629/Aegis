import pytest

from aegis_server.protocol import ActionObject, ContextUpdatePayload, SanitizedSchema, SanitizedElement
from aegis_server.action_validator import action_validator

def dummy_context(elements=["el-1", "el-2"]) -> ContextUpdatePayload:
    return ContextUpdatePayload(
        step_number=1,
        agent_state="running",
        sanitized_screenshot="",
        screenshot_format="webp",
        sanitized_schema=SanitizedSchema(
            url="http://test.com",
            title="Test",
            elements=[
                SanitizedElement(
                    id=el_id,
                    tagName="input",
                    type="text",
                    boundingBox={"x":0,"y":0,"width":10,"height":10},
                    isVisible=True,
                    isDisabled=False,
                    isReadOnly=False,
                    isInteractive=True
                )
                for el_id in elements
            ]
        ),
        previous_action_result=None,
    )

def test_valid_click_action():
    action = ActionObject(action_type="click", target="el-1")
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is True

def test_click_missing_target():
    action = ActionObject(action_type="click", target=None)
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is False
    assert "target" in res.error_message.lower()

def test_invalid_action_type():
    # Pydantic might catch this if strict, but if not:
    action = ActionObject.model_construct(action_type="execute_script")
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is False

def test_type_requires_value():
    action = ActionObject(action_type="type", target="el-1", value=None)
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is False
    assert "value" in res.error_message.lower()

def test_scroll_value_restriction():
    action = ActionObject(action_type="scroll", value="left")
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is False
    assert "up' or 'down" in res.error_message.lower()

def test_target_not_in_schema():
    action = ActionObject(action_type="click", target="el-99")
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is False
    assert res.error_code == "E-VAL-02"

def test_script_injection_blocked():
    action = ActionObject(action_type="type", target="el-1", value="javascript:alert(1)")
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is False
    
    action2 = ActionObject(action_type="type", target="el-1", value="hello <script> alert(1)")
    res2 = action_validator.validate_action(action2, dummy_context())
    assert res2.valid is False

def test_reasoning_truncated():
    long_reasoning = "a" * 2000
    action = ActionObject.model_construct(action_type="click", target="el-1", reasoning=long_reasoning)
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is True
    assert len(action.reasoning) == 1000

def test_valid_done_action():
    action = ActionObject(action_type="done")
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is True

def test_valid_fail_action():
    action = ActionObject(action_type="fail", reasoning="Because I failed")
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is True

def test_select_requires_target_and_value():
    action = ActionObject(action_type="select", target="el-1", value=None)
    res = action_validator.validate_action(action, dummy_context())
    assert res.valid is False
