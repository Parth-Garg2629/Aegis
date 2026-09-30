"""
mock.py — Mock VLM Provider
===========================
E3 Hardening:
- Implements VLMProvider abstract base class.
- Supports configurable scripted action sequences.
- Retains deterministic fallback behavior for regression tests.
"""

from typing import List, Optional

from aegis_server.protocol import ActionObject, ContextUpdatePayload
from aegis_server.session import ActionHistoryItem
from aegis_server.providers.base import VLMProvider


class MockVLMProvider(VLMProvider):
    def __init__(self, script: Optional[List[ActionObject]] = None):
        """
        Initialize the mock provider.
        If a script is provided, it will yield actions from the script sequentially.
        Otherwise, it falls back to a default deterministic sequence for testing.
        """
        self.script = script
        self._script_index = 0

    def generate_action(
        self,
        context: ContextUpdatePayload,
        goal: str,
        action_history: Optional[List[ActionHistoryItem]] = None,
    ) -> ActionObject:
        
        # 1. Scripted behavior
        if self.script is not None:
            if self._script_index < len(self.script):
                action = self.script[self._script_index]
                self._script_index += 1
                return action
            return ActionObject(
                action_type="done",
                reasoning="Script exhausted.",
            )

        # 2. Default deterministic fallback (for Phase A walking skeleton tests)
        step = context.step_number
        elements = context.sanitized_schema.elements
        fallback_id = elements[0].id if elements else "unknown-target"

        if context.sanitized_schema.title == "AEGIS Demo Form":
            if step == 1:
                target_id = next((el.id for el in elements if el.tagName == "input"), fallback_id)
                return ActionObject(action_type="type", target=target_id, value="Acme Corp", reasoning="Entering organization name")
            if step == 2:
                target_id = next((el.id for el in elements if el.tagName == "button"), fallback_id)
                return ActionObject(action_type="click", target=target_id, reasoning="Clicking Continue")
            if step == 3:
                # Find a checkbox or second button
                checkboxes = [el.id for el in elements if el.tagName == "input" and el.type == "checkbox"]
                target_id = checkboxes[0] if checkboxes else fallback_id
                return ActionObject(action_type="click", target=target_id, reasoning="Accepting terms")
            if step == 4:
                buttons = [el.id for el in elements if el.tagName == "button"]
                target_id = buttons[1] if len(buttons) > 1 else fallback_id
                return ActionObject(action_type="click", target=target_id, reasoning="Clicking Complete Setup")
            return ActionObject(action_type="done", reasoning="Setup Complete!")

        # 2. Default deterministic fallback (for Phase A walking skeleton tests)
        if step == 1:
            target_id = next((el.id for el in elements if el.tagName in ("input", "textarea") and el.type != "hidden"), fallback_id)
            return ActionObject(
                action_type="type",
                target=target_id,
                value="Scholarship Portal",
                reasoning="Entering search query into scholarship application form",
            )

        if step == 2:
            target_id = next((el.id for el in elements if el.tagName == "button" or el.role == "button" or el.type == "submit"), fallback_id)
            return ActionObject(
                action_type="click",
                target=target_id,
                value=None,
                reasoning="Clicking submit button to execute search",
            )

        return ActionObject(
            action_type="done",
            target=None,
            value=None,
            reasoning="Form submitted and verified, task goal achieved.",
        )


mock_vlm_provider = MockVLMProvider()
