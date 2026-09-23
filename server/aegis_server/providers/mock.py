from typing import Optional
from aegis_server.protocol import ActionObject, ContextUpdatePayload


class MockVLMProvider:

    def generate_action(self, context: ContextUpdatePayload, goal: Optional[str] = None) -> ActionObject:
        step = context.step_number
        elements = context.sanitized_schema.elements

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

        return ActionObject(
            action_type="done",
            target=None,
            value=None,
            reasoning="Form submitted and verified, task goal achieved.",
        )


mock_vlm_provider = MockVLMProvider()
