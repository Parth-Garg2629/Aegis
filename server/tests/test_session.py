"""
test_session.py — E2 Session Management Tests
==============================================
Tests for:
- Session state machine transitions
- Session isolation (no cross-session data leakage)
- Action history FIFO window
- Max steps enforcement
- Termination cleanup
- Reconnect grace logic
- Concurrent sessions
- Privacy invariant: [NEEDS_LOCAL_INPUT] redaction
"""

import pytest
from datetime import datetime, timezone
import time

from aegis_server.protocol import ClientMetadata, ContextUpdatePayload, ActionObject
from aegis_server.session import (
    Session,
    SessionManager,
    SessionState,
    StateTransitionError,
    ActionHistoryItem,
)


@pytest.fixture
def manager():
    return SessionManager()


@pytest.fixture
def client_metadata():
    return ClientMetadata(
        extension_version="1.0.0",
        browser="chrome",
        browser_version="120",
        max_steps=10,
    )


@pytest.fixture
def dummy_context(step=1):
    return ContextUpdatePayload(
        step_number=step,
        agent_state="running",
        sanitized_screenshot="dummy_b64",
        screenshot_format="webp",
        sanitized_schema={"url": "test", "title": "test", "elements": []},
    )


def test_session_state_transitions(client_metadata):
    # INIT -> ACTIVE happens on init
    session = Session("sess_1", "goal", client_metadata)
    assert session.state == SessionState.ACTIVE
    
    # ACTIVE -> WAITING_CONTEXT
    session.set_waiting_context()
    assert session.state == SessionState.WAITING_CONTEXT
    
    # WAITING_CONTEXT -> INFERRING
    session.set_inferring()
    assert session.state == SessionState.INFERRING
    
    # INFERRING -> DISCONNECTED_GRACE
    session.mark_disconnected()
    assert session.state == SessionState.DISCONNECTED_GRACE
    
    # DISCONNECTED_GRACE -> WAITING_CONTEXT
    session.resume()
    assert session.state == SessionState.WAITING_CONTEXT
    
    # Invalid transition WAITING_CONTEXT -> ACTIVE is not allowed. We can test INFERRING again.
    session.set_inferring()
    assert session.state == SessionState.INFERRING
        
    # ACTIVE -> TERMINATED
    session.terminate()
    assert session.state == SessionState.TERMINATED
    
    # TERMINATED -> anything should fail
    with pytest.raises(StateTransitionError):
        session.resume()


def test_session_isolation(manager, client_metadata, dummy_context):
    sess1 = manager.create_session("goal 1", client_metadata)
    sess2 = manager.create_session("goal 2", client_metadata)
    
    sess1.update_context(dummy_context)
    action = ActionObject(action_type="click", target="btn", value=None)
    sess1.record_action(action)
    
    assert sess1.goal == "goal 1"
    assert sess2.goal == "goal 2"
    
    assert len(sess1.action_history) == 1
    assert len(sess2.action_history) == 0
    assert sess2.latest_context is None


def test_action_history_fifo(client_metadata):
    session = Session("sess", "goal", client_metadata)
    
    for i in range(1, 8):
        action = ActionObject(action_type="type", target=f"t{i}", value=f"v{i}")
        session.record_action(action)
    
    # Max length is 5
    assert len(session.action_history) == 5
    
    # Should contain items 3, 4, 5, 6, 7
    targets = [item.target for item in session.action_history]
    assert targets == ["t3", "t4", "t5", "t6", "t7"]


def test_session_termination_cleanup(client_metadata, dummy_context):
    session = Session("sess", "goal", client_metadata)
    session.update_context(dummy_context)
    action = ActionObject(action_type="click")
    session.record_action(action)
    
    assert session.latest_context is not None
    assert len(session.action_history) == 1
    assert session.goal == "goal"
    
    session.terminate()
    
    assert session.latest_context is None
    assert len(session.action_history) == 0
    assert session.goal == ""


def test_action_history_sensitive_value_redacted(client_metadata):
    session = Session("sess", "goal", client_metadata)
    
    sensitive_action = ActionObject(
        action_type="type", 
        target="password_field", 
        value="[NEEDS_LOCAL_INPUT]"
    )
    session.record_action(sensitive_action)
    
    stored_item = session.action_history[0]
    assert stored_item.value == "[LOCAL_INPUT_PROVIDED]"


def test_manager_cleanup_stale_sessions(manager, client_metadata):
    sess = manager.create_session("goal", client_metadata)
    sess.mark_disconnected()
    
    # Fake old disconnect time
    sess.disconnect_time = "2000-01-01T00:00:00Z"
    
    manager.cleanup_stale_sessions(grace_period_seconds=60)
    
    assert manager.get_session(sess.session_id) is None


def test_manager_cleanup_terminated(manager, client_metadata):
    sess = manager.create_session("goal", client_metadata)
    sess.terminate()
    
    manager.cleanup_terminated()
    
    assert manager.get_session(sess.session_id) is None


def test_concurrent_sessions(manager, client_metadata):
    # Natively supported by the dict
    sessions = []
    for i in range(10):
        sessions.append(manager.create_session(f"goal {i}", client_metadata))
    
    for i in range(10):
        s = manager.get_session(sessions[i].session_id)
        assert s.goal == f"goal {i}"
        
    for i in range(5):
        manager.remove_session(sessions[i].session_id)
        
    for i in range(10):
        if i < 5:
            assert manager.get_session(sessions[i].session_id) is None
        else:
            assert manager.get_session(sessions[i].session_id) is not None
