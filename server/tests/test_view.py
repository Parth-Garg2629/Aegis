import pytest
from fastapi.testclient import TestClient
from aegis_server.main import app
from aegis_server.session import session_manager, Session
from aegis_server.protocol import ClientMetadata, ContextUpdatePayload, SanitizedSchema, ActionObject

client = TestClient(app)

@pytest.fixture
def test_session():
    cm = ClientMetadata(extension_version="1.0", browser="chrome", browser_version="130")
    session = session_manager.create_session("test_goal", cm)
    
    # Add a mock context
    schema = SanitizedSchema(url="http://test.com", title="Test", elements=[])
    ctx = ContextUpdatePayload(
        step_number=1,
        agent_state="running",
        sanitized_screenshot="dummy_screenshot_data",
        screenshot_format="webp",
        sanitized_schema=schema
    )
    session.update_context(ctx)
    session.record_action(ActionObject(action_type="click", target="el-1", reasoning="long long long reasoning"))
    yield session
    session_manager.remove_session(session.session_id)

def test_view_sessions_empty():
    session_manager._sessions.clear()
    response = client.get("/view/sessions")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 0
    assert len(data["active_sessions"]) == 0
    assert data["canary_badge"] == "E8_VIEW_ACTIVE"

def test_view_sessions_active(test_session):
    response = client.get("/view/sessions")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    session_data = data["active_sessions"][0]
    assert session_data["session_id"] == test_session.session_id
    assert "test_goal" not in session_data.values()
    assert session_data["goal_present"] is True

def test_view_session_detail(test_session):
    response = client.get(f"/view/sessions/{test_session.session_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == test_session.session_id
    assert len(data["action_history_last5"]) == 1
    history = data["action_history_last5"][0]
    assert history["action_type"] == "click"
    # Never expose raw goal
    assert "test_goal" not in str(data)

def test_view_latest_context(test_session):
    response = client.get(f"/view/sessions/{test_session.session_id}/latest-context")
    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == test_session.session_id
    assert data["url"] == "http://test.com"
    assert data["screenshot_bytes"] > 0
    # ensure it doesn't return the screenshot itself
    assert "dummy_screenshot_data" not in response.text
    
def test_view_latest_context_no_session():
    response = client.get("/view/sessions/invalid_id/latest-context")
    assert response.status_code == 404
