import sys
import os

# Add server directory to path
sys.path.insert(0, r"d:\Aegis\server")

from aegis_server.providers.ollama import OllamaProvider
from aegis_server.protocol import ContextUpdatePayload, SanitizedSchema, SanitizedElement, BoundingBox

schema = SanitizedSchema(
    url="http://localhost/fixtures/fp_01.html",
    title="FP-01 Scholarship Search",
    elements=[
        SanitizedElement(
            id="el-search-input",
            tagName="input",
            type="text",
            label="Search Query",
            boundingBox=BoundingBox(x=40, y=100, width=520, height=40),
            isVisible=True,
            isDisabled=False,
            isReadOnly=False,
            isInteractive=True,
        ),
        SanitizedElement(
            id="el-submit-button",
            tagName="button",
            text="Search Scholarships",
            boundingBox=BoundingBox(x=40, y=160, width=180, height=40),
            isVisible=True,
            isDisabled=False,
            isReadOnly=False,
            isInteractive=True,
        )
    ]
)

context = ContextUpdatePayload(
    step_number=1,
    agent_state="running",
    sanitized_screenshot="",
    screenshot_format="jpeg",
    sanitized_schema=schema,
    previous_action_result=None
)

provider = OllamaProvider()
print("Calling Ollama Provider with goal: 'Type hello into the text field and click the button.'")
from aegis_server.protocol import PreviousActionResult

context_step_2 = ContextUpdatePayload(
    step_number=2,
    agent_state="running",
    sanitized_screenshot="",
    screenshot_format="jpeg",
    sanitized_schema=schema,
    previous_action_result=PreviousActionResult(
        action_type="type",
        target_element_id="el-search-input",
        success=True
    )
)

context_step_3 = ContextUpdatePayload(
    step_number=3,
    agent_state="running",
    sanitized_screenshot="",
    screenshot_format="jpeg",
    sanitized_schema=schema,
    previous_action_result=PreviousActionResult(
        action_type="click",
        target_element_id="el-submit-button",
        success=True
    )
)

print("\n--- STEP 3 ---")
print("Calling Ollama Provider for Step 3...")
action_3 = provider.generate_action(context_step_3, goal="Type hello into the text field and click the button.")
print(f"Action 3 result: action_type={action_3.action_type}, target={action_3.target}, value={action_3.value}, reasoning={action_3.reasoning}")


