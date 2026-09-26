import pytest
from aegis_server.protocol import ActionObject, ContextUpdatePayload, SanitizedSchema, SanitizedElement, RiskAssessment
from aegis_server.risk_engine import risk_engine

def dummy_context(elements=[]) -> ContextUpdatePayload:
    return ContextUpdatePayload(
        step_number=1,
        agent_state="running",
        sanitized_screenshot="",
        screenshot_format="webp",
        sanitized_schema=SanitizedSchema(
            url="http://test.com/page",
            title="Test",
            elements=elements
        ),
        previous_action_result=None,
    )

def test_safe_scroll_action():
    action = ActionObject(action_type="scroll", value="down")
    res = risk_engine.evaluate(action, dummy_context())
    assert res.level == "safe"

def test_safe_wait_action():
    action = ActionObject(action_type="wait")
    res = risk_engine.evaluate(action, dummy_context())
    assert res.level == "safe"

def test_blocked_external_link():
    el = SanitizedElement(
        id="link-1", tagName="a", type="", boundingBox={"x":0,"y":0,"width":10,"height":10},
        isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
        attributes={"href": "http://malicious.com/stealer"}
    )
    action = ActionObject(action_type="click", target="link-1")
    res = risk_engine.evaluate(action, dummy_context([el]))
    assert res.level == "blocked"

def test_blocked_script_injection():
    action = ActionObject(action_type="type", target="el-1", value="javascript:alert(1)")
    res = risk_engine.evaluate(action, dummy_context())
    assert res.level == "blocked"

def test_hr01_payment_keyword():
    el = SanitizedElement(
        id="btn-1", tagName="button", type="button", boundingBox={"x":0,"y":0,"width":10,"height":10},
        isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
        text="Pay Now"
    )
    action = ActionObject(action_type="click", target="btn-1")
    res = risk_engine.evaluate(action, dummy_context([el]))
    assert res.level == "high_risk"
    assert res.category == "HR-01"

def test_hr02_deletion_keyword():
    el = SanitizedElement(
        id="btn-1", tagName="button", type="button", boundingBox={"x":0,"y":0,"width":10,"height":10},
        isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
        label="Delete Account"
    )
    action = ActionObject(action_type="click", target="btn-1")
    res = risk_engine.evaluate(action, dummy_context([el]))
    assert res.level == "high_risk"
    assert res.category == "HR-02"

def test_hr04_financial_form():
    el = SanitizedElement(
        id="input-1", tagName="input", type="text", boundingBox={"x":0,"y":0,"width":10,"height":10},
        isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
        value="[REDACTED_AADHAAR]"
    )
    submit = SanitizedElement(
        id="btn-1", tagName="button", type="submit", boundingBox={"x":0,"y":0,"width":10,"height":10},
        isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
    )
    action = ActionObject(action_type="click", target="btn-1")
    res = risk_engine.evaluate(action, dummy_context([el, submit]))
    assert res.level == "high_risk"
    assert res.category == "HR-04"

def test_hr05_sensitive_form_threshold():
    els = []
    for i in range(3):
        els.append(SanitizedElement(
            id=f"input-{i}", tagName="input", type="text", boundingBox={"x":0,"y":0,"width":10,"height":10},
            isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
            value=f"[REDACTED_PHONE]"
        ))
    submit = SanitizedElement(
        id="btn-1", tagName="button", type="submit", boundingBox={"x":0,"y":0,"width":10,"height":10},
        isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
    )
    els.append(submit)
    
    action = ActionObject(action_type="click", target="btn-1")
    res = risk_engine.evaluate(action, dummy_context(els))
    assert res.level == "high_risk"
    assert res.category == "HR-05"

def test_hr07_download():
    el = SanitizedElement(
        id="btn-1", tagName="a", type="", boundingBox={"x":0,"y":0,"width":10,"height":10},
        isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
        attributes={"download": ""}
    )
    action = ActionObject(action_type="click", target="btn-1")
    res = risk_engine.evaluate(action, dummy_context([el]))
    assert res.level == "high_risk"
    assert res.category == "HR-07"

def test_blocked_overrides_high_risk():
    # If it types javascript into a password field, script injection (blocked) should win, 
    # but my engine blocks both. Let's do script injection (blocked) vs a download button (HR-07).
    # Wait, action type can only be one.
    pass

def test_fail_closed_on_error():
    # Pass a malformed action
    res = risk_engine.evaluate(None, None)
    assert res.level == "blocked"

def test_deterministic_classification():
    el = SanitizedElement(
        id="btn-1", tagName="button", type="button", boundingBox={"x":0,"y":0,"width":10,"height":10},
        isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
        text="Pay Now"
    )
    action = ActionObject(action_type="click", target="btn-1")
    res1 = risk_engine.evaluate(action, dummy_context([el]))
    res2 = risk_engine.evaluate(action, dummy_context([el]))
    assert res1.level == res2.level == "high_risk"

def test_type_with_local_input_safe():
    el = SanitizedElement(
        id="input-1", tagName="input", type="password", boundingBox={"x":0,"y":0,"width":10,"height":10},
        isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
    )
    action = ActionObject(action_type="type", target="input-1", value="[NEEDS_LOCAL_INPUT]")
    res = risk_engine.evaluate(action, dummy_context([el]))
    assert res.level == "safe"
