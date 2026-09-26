import pytest
from aegis_server.orchestrator import AgentOrchestrator
from aegis_server.session import session_manager, SessionState
from aegis_server.protocol import ClientMetadata, ContextUpdatePayload, ActionObject, SanitizedSchema, SanitizedElement, BoundingBox
from aegis_server.providers.mock import MockVLMProvider

@pytest.fixture
def session():
    cm = ClientMetadata(extension_version="1.0", browser="chrome", browser_version="130")
    s = session_manager.create_session("goal", cm)
    yield s
    session_manager.remove_session(s.session_id)

@pytest.fixture
def context():
    schema = SanitizedSchema(
        url="http://test.local",
        title="Test",
        elements=[
            SanitizedElement(id="el-1", tagName="button", isVisible=True, isInteractive=True, isDisabled=False, isReadOnly=False, boundingBox=BoundingBox(x=0,y=0,width=10,height=10), role="button", text="Click me"),
            SanitizedElement(id="el-2", tagName="a", isVisible=True, isInteractive=True, isDisabled=False, isReadOnly=False, boundingBox=BoundingBox(x=0,y=0,width=10,height=10), role="link", attributes={"href": "http://external.com"})
        ]
    )
    return ContextUpdatePayload(
        step_number=1,
        agent_state="running",
        sanitized_screenshot="",
        screenshot_format="webp",
        sanitized_schema=schema
    )

def run_scenario(session, context, actions):
    provider = MockVLMProvider()
    provider.script = actions
    orch = AgentOrchestrator(provider=provider)
    session.set_waiting_context()
    return orch.decide_next_action(session, context)

def test_scenario_happy_safe_action(session, context):
    action, risk = run_scenario(session, context, [ActionObject(action_type="click", target="el-1")])
    assert action.action_type == "click"
    assert risk is not None
    assert risk.level == "safe"

def test_scenario_malformed_vlm_output(session, context):
    # This simulates validation catching bad output
    # E.g. script injection or missing required fields
    action, risk = run_scenario(session, context, [ActionObject(action_type="type", target="el-1")])
    assert action.action_type == "fail" # validation fails because type requires value

def test_scenario_invalid_action(session, context):
    action, risk = run_scenario(session, context, [ActionObject(action_type="click", target="el-99")])
    assert action.action_type == "fail"

def test_scenario_blocked_action(session, context):
    action, risk = run_scenario(session, context, [ActionObject(action_type="click", target="el-2")])
    assert action.action_type == "fail"
    assert risk is not None
    assert risk.level == "blocked"

def test_scenario_stale_target(session, context):
    action, risk = run_scenario(session, context, [ActionObject(action_type="click", target="stale-id")])
    assert action.action_type == "fail"
    assert action.reasoning is not None and "validation failed" in action.reasoning

def test_scenario_max_steps(session, context):
    session.current_step = 35
    action, risk = run_scenario(session, context, [ActionObject(action_type="click", target="el-1")])
    assert action.action_type == "fail"
    assert action.reasoning is not None and "Maximum steps" in action.reasoning

def test_scenario_provider_failure(session, context):
    class FailingProvider(MockVLMProvider):
        def generate_action(self, *args, **kwargs):
            raise Exception("timeout")
    orch = AgentOrchestrator(provider=FailingProvider())
    session.set_waiting_context()
    action, risk = orch.decide_next_action(session, context)
    assert action.action_type == "fail"

def test_scenario_session_lifecycle(session):
    assert session.state == SessionState.ACTIVE
    session.set_waiting_context()
    assert session.state == SessionState.WAITING_CONTEXT
    session.set_inferring()
    assert session.state == SessionState.INFERRING
    session.terminate()
    assert session.state == SessionState.TERMINATED

def test_scenario_reconnect_resume(session):
    assert session.state == SessionState.ACTIVE
    session.mark_disconnected()
    assert session.state == SessionState.DISCONNECTED_GRACE
    session.resume()
    assert session.state == SessionState.WAITING_CONTEXT

def test_scenario_terminal_done(session, context):
    action, risk = run_scenario(session, context, [ActionObject(action_type="done")])
    assert action.action_type == "done"

def test_scenario_terminal_fail(session, context):
    action, risk = run_scenario(session, context, [ActionObject(action_type="fail")])
    assert action.action_type == "fail"
