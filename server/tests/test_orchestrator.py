import pytest
from aegis_server.orchestrator import AgentOrchestrator
from aegis_server.session import Session, SessionState
from aegis_server.protocol import ClientMetadata, ContextUpdatePayload, ActionObject, SanitizedSchema, SanitizedElement, BoundingBox
from aegis_server.providers.mock import MockVLMProvider

@pytest.fixture
def session():
    cm = ClientMetadata(extension_version="1.0", browser="chrome", browser_version="130", max_steps=5)
    s = Session("test_session", "Find something", cm, max_steps=5)
    # The session starts in ACTIVE, we manually set to WAITING_CONTEXT
    s.set_waiting_context()
    return s

@pytest.fixture
def context():
    schema = SanitizedSchema(
        url="http://test.local",
        title="Test Page",
        elements=[
            SanitizedElement(id="el-1", tagName="button", isVisible=True, isInteractive=True, isDisabled=False, isReadOnly=False, boundingBox=BoundingBox(x=0,y=0,width=10,height=10), role="button", text="Click me"),
            SanitizedElement(id="el-2", tagName="input", isVisible=True, isInteractive=True, isDisabled=False, isReadOnly=False, boundingBox=BoundingBox(x=0,y=0,width=10,height=10), role="textbox", attributes={"type": "text"})
        ]
    )
    return ContextUpdatePayload(
        step_number=1,
        agent_state="running",
        sanitized_screenshot="",
        screenshot_format="webp",
        sanitized_schema=schema
    )

def test_orchestrator_safe_action(session, context):
    provider = MockVLMProvider()
    provider.script = [ActionObject(action_type="click", target="el-1", reasoning="click button")]
    orch = AgentOrchestrator(provider=provider)
    
    action, risk = orch.decide_next_action(session, context)
    
    assert action.action_type == "click"
    assert action.target == "el-1"
    assert risk is not None
    assert risk.level == "safe"
    assert session.state == SessionState.WAITING_CONTEXT

def test_orchestrator_max_steps(session, context):
    provider = MockVLMProvider()
    orch = AgentOrchestrator(provider=provider)
    
    session.current_step = 6
    action, risk = orch.decide_next_action(session, context)
    
    assert action.action_type == "fail"
    assert action.reasoning is not None and "Maximum steps" in action.reasoning
    assert risk is None

def test_orchestrator_provider_failure(session, context):
    class FailingProvider(MockVLMProvider):
        def generate_action(self, *args, **kwargs):
            raise Exception("Provider timeout or error")
    
    orch = AgentOrchestrator(provider=FailingProvider())
    action, risk = orch.decide_next_action(session, context)
    
    assert action.action_type == "fail"
    assert risk is None

def test_orchestrator_blocked_action(session, context):
    provider = MockVLMProvider()
    # Script injection will be blocked by risk engine and action validator, but let's test a case where risk blocks it.
    provider.script = [ActionObject(action_type="type", target="el-2", value="javascript:alert(1)", reasoning="test")]
    orch = AgentOrchestrator(provider=provider)
    
    action, risk = orch.decide_next_action(session, context)
    assert action.action_type == "fail"
    # If validation fails, risk is None. Let's make an action that passes validation but fails risk.
    # Like external navigation. 
    context.sanitized_schema.elements.append(SanitizedElement(id="el-3", tagName="a", isVisible=True, isInteractive=True, isDisabled=False, isReadOnly=False, boundingBox=BoundingBox(x=0,y=0,width=10,height=10), role="link", attributes={"href": "http://external.com"}))
    provider.script = [ActionObject(action_type="click", target="el-3", reasoning="test")]
    provider._script_index = 0
    action2, risk2 = orch.decide_next_action(session, context)
    
    assert action2.action_type == "fail"
    assert risk2 is not None
    assert risk2.level == "blocked"

def test_orchestrator_high_risk_action(session, context):
    provider = MockVLMProvider()
    context.sanitized_schema.elements.append(SanitizedElement(id="el-4", tagName="button", isVisible=True, isInteractive=True, isDisabled=False, isReadOnly=False, boundingBox=BoundingBox(x=0,y=0,width=10,height=10), role="button", text="Pay Now"))
    provider.script = [ActionObject(action_type="click", target="el-4", reasoning="test")]
    orch = AgentOrchestrator(provider=provider)
    
    action, risk = orch.decide_next_action(session, context)
    assert action.action_type == "click"
    assert risk is not None
    assert risk.level == "high_risk"

def test_orchestrator_invalid_action(session, context):
    provider = MockVLMProvider()
    provider.script = [ActionObject(action_type="click", target="el-99", reasoning="target does not exist")]
    orch = AgentOrchestrator(provider=provider)
    
    action, risk = orch.decide_next_action(session, context)
    assert action.action_type == "fail"
    assert action.reasoning is not None and "validation failed" in action.reasoning
    assert risk is None

def test_orchestrator_terminal_done_and_fail(session, context):
    provider = MockVLMProvider()
    provider.script = [
        ActionObject(action_type="done", reasoning="finished"),
        ActionObject(action_type="fail", reasoning="aborted")
    ]
    orch = AgentOrchestrator(provider=provider)
    
    action1, risk1 = orch.decide_next_action(session, context)
    assert action1.action_type == "done"
    assert risk1 is not None
    assert risk1.level == "safe"
    
    action2, risk2 = orch.decide_next_action(session, context)
    assert action2.action_type == "fail"
    assert risk2 is not None
    assert risk2.level == "safe"

