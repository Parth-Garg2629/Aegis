"""
Tests for AEGIS Server Safe Structured Logging (slog)
"""

from aegis_server.slog import slog, set_log_sink, filter_safe_fields


def test_python_slog_filters_unwhitelisted_fields():
    raw_data = {
        "level": "info",
        "module": "VLM_ORCHESTRATOR",
        "event": "ACTION_PROPOSED",
        "session_id": "sess-456",
        "step_number": 3,
        "action_type": "type",
        "duration_ms": 120,
        # Dangerous fields:
        "raw_user_secret": "mySecretPassword123",
        "sql_query": "SELECT * FROM users",
    }

    safe = filter_safe_fields(raw_data)
    assert safe["module"] == "VLM_ORCHESTRATOR"
    assert safe["event"] == "ACTION_PROPOSED"
    assert safe["session_id"] == "sess-456"
    assert safe["step_number"] == 3
    assert safe["action_type"] == "type"
    assert safe["duration_ms"] == 120
    assert "timestamp" in safe

    assert "raw_user_secret" not in safe
    assert "sql_query" not in safe


def test_python_slog_sink_routing():
    captured = []

    def custom_sink(entry):
        captured.append(entry)

    set_log_sink(custom_sink)

    slog.info(
        module="WS_GATEWAY",
        event="CLIENT_CONNECTED",
        session_id="sess-789",
        unauthorized_field="leak_attempt",
    )

    assert len(captured) == 1
    entry = captured[0]
    assert entry["module"] == "WS_GATEWAY"
    assert entry["event"] == "CLIENT_CONNECTED"
    assert entry["session_id"] == "sess-789"
    assert "unauthorized_field" not in entry
