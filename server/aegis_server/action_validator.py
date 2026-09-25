"""
action_validator.py — Server-Side Action Validation (E5)
======================================================
Validates VLM-proposed actions against the current context
and structural rules before returning them to the client.
"""

import re
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
        valid_types = {"click", "type", "scroll", "select", "hover", "wait", "done", "fail"}
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

        if action.action_type == "scroll":
            if action.value not in {"up", "down"}:
                return ValidationResult(False, "E-VAL-05", "Action scroll requires value to be 'up' or 'down'")

        # 3. Target validation against schema
        if action.target:
            valid_targets = {el.id for el in context.sanitized_schema.elements}
            if action.target not in valid_targets:
                return ValidationResult(False, "E-VAL-02", f"Target {action.target} not found in sanitized schema")

        # 4. Value safety check (script injection)
        if action.value is not None:
            val_str = str(action.value).lower()
            for pattern in self.BLOCKED_PATTERNS:
                if re.search(pattern, val_str):
                    return ValidationResult(False, "E-VAL-06", "Script injection pattern detected in value")

        # 5. Reasoning text safety
        if action.reasoning:
            action.reasoning = action.reasoning[:1000]

        return ValidationResult(True)

action_validator = ActionValidator()
