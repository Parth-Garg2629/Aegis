import asyncio
from aegis_server.providers.ollama import ollama_vlm_provider
from aegis_server.protocol import ContextUpdatePayload, SanitizedSchema, SanitizedElement, BoundingBox
from aegis_server.session import ActionHistoryItem

schema = SanitizedSchema(
    url="http://test.com",
    title="Test",
    elements=[
        SanitizedElement(id="id-0", tagName="div", boundingBox=BoundingBox(x=0,y=0,width=100,height=100), isInteractive=False, isVisible=True, isDisabled=False, isReadOnly=False, label="Test"),
        SanitizedElement(id="id-1", tagName="button", boundingBox=BoundingBox(x=0,y=0,width=100,height=100), isInteractive=True, isVisible=True, isDisabled=False, isReadOnly=False, label="Click Me")
    ]
)

ctx = ContextUpdatePayload(
    step_number=1,
    agent_state="running",
    sanitized_screenshot="",
    screenshot_format="webp",
    sanitized_schema=schema,
    previous_action_result=None,
    client_metadata=None
)

try:
    action = ollama_vlm_provider.generate_action(context=ctx, goal="Click the button")
    print("ACTION:", action)
except Exception as e:
    print("ERROR:", e)
