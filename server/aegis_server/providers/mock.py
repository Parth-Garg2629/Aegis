"""
AEGIS Mock VLM Provider (Work Package E3)
Source of Truth: docs/TECHNICAL_SPEC.md §12.3, docs/IMPLEMENTATION_PLAN.md E3
Generates deterministic, schema-valid actions for walking-skeleton testing on FP-01.
"""

from typing import Optional
from aegis_server.protocol import ActionObject, ContextUpdatePayload


class MockVLMProvider:
    """
    Deterministic Mock VLM provider for walking skeleton.
    Step 1: Types query into search input.
    Step 2: Clicks submit button.
    Step 3: Emits 'done' action.
    """

    def generate_action(self, context: ContextUpdatePayload, goal: Optional[str] = None) -> ActionObject:
        step = context.step_number
        elements = context.sanitized_schema.elements

        # Step 1: Type into the first text input or search input
        if step == 1:
            target_id = "el-search-input"
            for el in elements:
                if el.tagName in ("input", "textarea") and el.type != "hidden":
                    target_id = el.id
                    break

            return ActionObject(
                action_type="type",
                target=target_id,
                value="Scholarship Portal",
                reasoning="Entering search query into scholarship application form",
            )

        # Step 2: Click the submit button
        if step == 2:
            target_id = "el-submit-button"
            for el in elements:
                if el.tagName == "button" or el.role == "button" or el.type == "submit":
                    target_id = el.id
                    break

            return ActionObject(
                action_type="click",
                target=target_id,
                value=None,
                reasoning="Clicking submit button to execute search",
            )

        # Step >= 3: Task completed
        return ActionObject(
            action_type="done",
            target=None,
            value=None,
            reasoning="Form submitted and verified, task goal achieved.",
        )


mock_vlm_provider = MockVLMProvider()
