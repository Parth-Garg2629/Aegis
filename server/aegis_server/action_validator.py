"""
action_validator.py — Server-Side Action Validation (E5)
======================================================
Validates VLM-proposed actions against the current context
and structural rules before returning them to the client.
"""

import re
from urllib.parse import urlsplit
from dataclasses import dataclass
from typing import Optional

from aegis_server.protocol import ActionObject, ContextUpdatePayload

@dataclass
class ValidationResult:
    valid: bool
    error_code: Optional[str] = None
    error_message: Optional[str] = None

class ActionValidator:
    def __init__(self):
        # script-injection patterns to block in 'value'
        self.BLOCKED_PATTERNS = [
            r"javascript:",
            r"<script",
            r"eval\(",
            r"onclick=",
            r"onerror=",
        ]

    def validate_action(self, action: ActionObject, context: ContextUpdatePayload) -> ValidationResult:
        # 1. Closed action vocabulary is handled by ActionObject pydantic schema itself during parsing,
        # but if we get an action object constructed directly, we validate it here.
        valid_types = {"click", "type", "scroll", "select", "hover", "navigate", "wait", "done", "fail"}
        if action.action_type not in valid_types:
            return ValidationResult(False, "E-VAL-01", f"Invalid action_type: {action.action_type}")

        # 2. Per-action-type field requirements
        if action.action_type in {"click", "hover"}:
            if not action.target:
                return ValidationResult(False, "E-VAL-03", f"Action {action.action_type} requires a target")

        if action.action_type == "type":
            if not action.target:
                return ValidationResult(False, "E-VAL-03", "Action type requires a target")
            if action.value is None:
                return ValidationResult(False, "E-VAL-04", "Action type requires a value")

        if action.action_type == "select":
            if not action.target:
                return ValidationResult(False, "E-VAL-03", "Action select requires a target")
            if action.value is None:
                return ValidationResult(False, "E-VAL-04", "Action select requires a value")

        if action.action_type == "navigate":
            if not action.value:
                return ValidationResult(False, "E-VAL-04", "Navigation requires a URL")
            parsed = urlsplit(action.value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                return ValidationResult(False, "E-VAL-07", "Navigation URL must use HTTP or HTTPS")

        if action.action_type == "scroll":
            if action.value not in {"up", "down"}:
                return ValidationResult(False, "E-VAL-05", "Action scroll requires value to be 'up' or 'down'")

        # 3. Target validation against schema
        if action.target:
            # Strip literal id="..." or id='...' if the model hallucinates it
            if action.target.startswith('id="') and action.target.endswith('"'):
                action.target = action.target[4:-1]
            elif action.target.startswith("id='") and action.target.endswith("'"):
                action.target = action.target[4:-1]

            valid_targets = {el.id for el in context.sanitized_schema.elements}
            if action.target not in valid_targets:
                # A target is a capability reference created by the content
                # script. Never substitute a label or arbitrary element when a
                # model returns an unknown ID.
                return ValidationResult(False, "E-VAL-02", "Action target is not present in the sanitized schema")

        # 4. Value safety check (script injection)
        if action.value is not None:
            val_str = action.value.lower()
            for pattern in self.BLOCKED_PATTERNS:
                if re.search(pattern, val_str):
                    return ValidationResult(False, "E-VAL-06", "Script injection pattern detected in value")

        # 5. Reasoning text safety
        if action.reasoning:
            action.reasoning = action.reasoning[:1000]

        return ValidationResult(True)

action_validator = ActionValidator()
