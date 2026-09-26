import pytest
import os
import sqlite3
from datetime import datetime, timedelta
from aegis_server.audit_db import AuditDB

@pytest.fixture
def temp_db_path(tmp_path):
    return str(tmp_path / "test_audit.db")

def test_audit_disabled_no_db_created(temp_db_path):
    db = AuditDB(db_path=temp_db_path, enabled=False)
    assert not os.path.exists(temp_db_path)

def test_audit_session_lifecycle(temp_db_path):
    db = AuditDB(db_path=temp_db_path, enabled=True)
    assert os.path.exists(temp_db_path)
    
    session_id = "sess-123"
    db.record_session_start(session_id, "1.0", {"browser": "chrome"}, "2026-09-22T12:00:00Z")
    
    db.record_action(
        session_id=session_id, step_number=1, action_type="click",
        target_element_id="el-1", sanitized_target_role="button",
        value_classification="NON_SENSITIVE", action_value_safe=None,
        vlm_reasoning="To proceed", risk_category="SAFE",
        confirmation_required=False, confirmation_outcome="NOT_REQUIRED",
        execution_status="SUCCESS", error_code=None, timestamp="2026-09-22T12:00:05Z"
    )
    
    db.record_session_end(session_id, "2026-09-22T12:00:10Z", 1, "goal_achieved", True)
    
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()
    
    cursor.execute("SELECT is_success, termination_reason FROM audit_sessions WHERE session_id=?", (session_id,))
    row = cursor.fetchone()
    assert row[0] == 1
    assert row[1] == "goal_achieved"
    
    cursor.execute("SELECT action_type, execution_status FROM audit_actions WHERE session_id=?", (session_id,))
    action_row = cursor.fetchone()
    assert action_row[0] == "click"
    assert action_row[1] == "SUCCESS"

def test_audit_action_privacy(temp_db_path):
    db = AuditDB(db_path=temp_db_path, enabled=True)
    session_id = "sess-123"
    db.record_session_start(session_id, "1.0", {}, "2026-09-22T12:00:00Z")
    
    db.record_action(
        session_id=session_id, step_number=1, action_type="type",
        target_element_id="el-1", sanitized_target_role="input",
        value_classification="LOCAL_INPUT_PROVIDED", action_value_safe="[LOCAL_INPUT_PROVIDED]",
        vlm_reasoning="Because", risk_category="SAFE",
        confirmation_required=False, confirmation_outcome="NOT_REQUIRED",
        execution_status="SUCCESS", error_code=None, timestamp="2026-09-22T12:00:05Z"
    )
    
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT action_value_safe FROM audit_actions WHERE session_id=?", (session_id,))
    row = cursor.fetchone()
    # verify privacy
    assert row[0] == "[LOCAL_INPUT_PROVIDED]"
    assert "secret" not in (row[0] or "")

def test_audit_no_goal_text(temp_db_path):
    db = AuditDB(db_path=temp_db_path, enabled=True)
    session_id = "sess-123"
    # goal is not even passed to record_session_start
    db.record_session_start(session_id, "1.0", {}, "2026-09-22T12:00:00Z")
    
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM audit_sessions")
    cols = [description[0] for description in cursor.description]
    assert "goal" not in cols

def test_audit_no_raw_pii(temp_db_path):
    db = AuditDB(db_path=temp_db_path, enabled=True)
    session_id = "sess-123"
    db.record_session_start(session_id, "1.0", {}, "2026-09-22T12:00:00Z")
    
    db.record_action(
        session_id=session_id, step_number=1, action_type="type",
        target_element_id="el-1", sanitized_target_role="input",
        value_classification="NON_SENSITIVE", action_value_safe="[REDACTED_AADHAAR]",
        vlm_reasoning="Because", risk_category="SAFE",
        confirmation_required=False, confirmation_outcome="NOT_REQUIRED",
        execution_status="SUCCESS", error_code=None, timestamp="2026-09-22T12:00:05Z"
    )
    
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT action_value_safe FROM audit_actions")
    row = cursor.fetchone()
    # It stores the REDACTED token, which is non-sensitive metadata, never the real Aadhaar
    assert row[0] == "[REDACTED_AADHAAR]"

def test_audit_metrics_recorded(temp_db_path):
    db = AuditDB(db_path=temp_db_path, enabled=True)
    session_id = "sess-123"
    db.record_session_start(session_id, "1.0", {}, "2026-09-22T12:00:00Z")
    
    db.record_metric(session_id, 1, "2026-09-22T12:00:05Z", vlm_latency_ms=1200.5, pii_entities_detected=3)
    
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT vlm_latency_ms, pii_entities_detected FROM audit_metrics")
    row = cursor.fetchone()
    assert row[0] == 1200.5
    assert row[1] == 3

def test_audit_security_event(temp_db_path):
    db = AuditDB(db_path=temp_db_path, enabled=True)
    session_id = "sess-123"
    db.record_session_start(session_id, "1.0", {}, "2026-09-22T12:00:00Z")
    
    db.record_security_event(session_id, "RISK_ACTION_BLOCKED_ENGINE", "HIGH", "2026-09-22T12:00:05Z", step_number=1, risk_code="HR-06")
    
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT event_type, risk_code FROM audit_security_events")
    row = cursor.fetchone()
    assert row[0] == "RISK_ACTION_BLOCKED_ENGINE"
    assert row[1] == "HR-06"

def test_audit_retention_cleanup(temp_db_path):
    db = AuditDB(db_path=temp_db_path, enabled=True)
    old_session = "sess-old"
    old_date = (datetime.utcnow() - timedelta(days=10)).isoformat()
    db.record_session_start(old_session, "1.0", {}, old_date)
    
    db.record_action(old_session, 1, "done", None, None, "NON_SENSITIVE", None, None, "SAFE", False, None, "SUCCESS", None, old_date)
    
    new_session = "sess-new"
    new_date = datetime.utcnow().isoformat()
    db.record_session_start(new_session, "1.0", {}, new_date)
    
    db.cleanup_old_records(days=7)
    
    conn = sqlite3.connect(temp_db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT session_id FROM audit_sessions")
    rows = cursor.fetchall()
    assert len(rows) == 1
    assert rows[0][0] == new_session
    
    # cascade delete check
    cursor.execute("SELECT session_id FROM audit_actions")
    actions = cursor.fetchall()
    assert len(actions) == 0
