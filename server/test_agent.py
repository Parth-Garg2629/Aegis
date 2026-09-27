import os
import asyncio
from aegis_server.providers.ollama import ollama_vlm_provider
from aegis_server.protocol import ContextUpdatePayload, ActionObject
from aegis_server.action_validator import action_validator

def test_qwen_05b():
    os.environ["OLLAMA_MODEL"] = "qwen2.5:0.5b"
    
    # Mock context payload
    context = ContextUpdatePayload.model_validate({
        "session_id": "test",
        "step_number": 1,
        "url": "https://www.google.com",
        "title": "Google",
        "agent_state": "running",
        "screenshot_format": "webp",
        "sanitized_schema": {
            "url": "https://www.google.com",
            "title": "Google",
            "elements": [
                {
                    "id": "id-0", "tagName": "textarea", "label": "Search", "text": "", "attributes": {},
                    "boundingBox": {"x": 0, "y": 0, "width": 100, "height": 100},
                    "isVisible": True, "isDisabled": False, "isReadOnly": False, "isInteractive": True
                },
                {
                    "id": "id-1", "tagName": "button", "label": "Google Search", "text": "Google Search", "attributes": {},
                    "boundingBox": {"x": 0, "y": 0, "width": 100, "height": 100},
                    "isVisible": True, "isDisabled": False, "isReadOnly": False, "isInteractive": True
                }
            ]
        },
        "sanitized_screenshot": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    })
    
    print("Sending prompt to Qwen2.5 0.5B...")
    action = ollama_vlm_provider.generate_action(context, goal="search for isro")
    print("Action output:", action)
    
    print("Validating action...")
    val_res = action_validator.validate_action(action, context)
    print("Validation Result:", val_res)
    print("Final Target ID:", action.target)

if __name__ == "__main__":
    test_qwen_05b()
