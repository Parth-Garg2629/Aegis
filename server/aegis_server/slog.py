"""
Safe Structured Logging for AEGIS Server (ADR-12, SECURITY_PRIVACY.md §20, PI-06)
Accepts strictly whitelisted fields only to prevent accidental PII leakage.
"""

from datetime import datetime, timezone
import json
import sys
from typing import Any, Callable, Dict, Optional

ALLOWED_LOG_FIELDS = {
    "timestamp",
    "level",
    "module",
    "event",
    "session_id",
    "step_number",
    "action_type",
    "risk_category",
    "error_code",
    "duration_ms",
    "element_id",
    "status",
    "target_url_origin",
    "model_name",
    "sanitized_count",
    "success",
    "reason",
}

LogSink = Callable[[Dict[str, Any]], None]


def _default_sink(entry: Dict[str, Any]) -> None:
    line = json.dumps(entry)
    if entry.get("level") == "error":
        sys.stderr.write(line + "\n")
        sys.stderr.flush()
    else:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


_current_sink: LogSink = _default_sink


def set_log_sink(sink: LogSink) -> None:
    global _current_sink
    _current_sink = sink


def filter_safe_fields(entry: Dict[str, Any]) -> Dict[str, Any]:
    safe: Dict[str, Any] = {
        "timestamp": entry.get("timestamp") or datetime.now(timezone.utc).isoformat(),
    }
    for k, v in entry.items():
        if k in ALLOWED_LOG_FIELDS:
            safe[k] = v
    return safe


class SafeLogger:
    @staticmethod
    def log(level: str, module: str, event: str, **kwargs: Any) -> Dict[str, Any]:
        raw = {"level": level, "module": module, "event": event, **kwargs}
        safe = filter_safe_fields(raw)
        _current_sink(safe)
        return safe

    @classmethod
    def info(cls, module: str, event: str, **kwargs: Any) -> Dict[str, Any]:
        return cls.log("info", module, event, **kwargs)

    @classmethod
    def warn(cls, module: str, event: str, **kwargs: Any) -> Dict[str, Any]:
        return cls.log("warn", module, event, **kwargs)

    @classmethod
    def error(cls, module: str, event: str, **kwargs: Any) -> Dict[str, Any]:
        return cls.log("error", module, event, **kwargs)

    @classmethod
    def debug(cls, module: str, event: str, **kwargs: Any) -> Dict[str, Any]:
        return cls.log("debug", module, event, **kwargs)


slog = SafeLogger()
