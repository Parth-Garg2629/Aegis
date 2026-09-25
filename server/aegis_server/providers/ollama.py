import json
import os
import httpx
from typing import Optional

from aegis_server.protocol import ActionObject, ContextUpdatePayload
from aegis_server.providers.mock import MockVLMProvider
from aegis_server.slog import slog

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts", "system_v1.txt")

with open(PROMPT_PATH, "r", encoding="utf-8") as f:
    SYSTEM_PROMPT = f.read()


class OllamaProvider(MockVLMProvider):
    def __init__(self, url: str = "http://localhost:11434", model: str = "qwen3-vl:4b"):
        self.url = url
        self.model = model

    def generate_action(self, context: ContextUpdatePayload, goal: Optional[str] = None) -> ActionObject:
        slog.info(module="OLLAMA", event="CALLING_VLM", model=self.model, step=context.step_number)

        user_prompt = f"USER GOAL: {goal or 'No goal provided'}\n\n"
        user_prompt += f"CURRENT STEP: {context.step_number}\n\n"

        if context.previous_action_result:
            user_prompt += f"PREVIOUS ACTION RESULT: {context.previous_action_result.model_dump_json()}\n\n"

        user_prompt += "STRUCTURED SCHEMA:\n"
        user_prompt += context.sanitized_schema.model_dump_json(indent=2) + "\n\n"
        user_prompt += "[Sanitized screenshot is attached as the image input]\n\n"
        user_prompt += "Based on the sanitized screenshot, the structured schema, and the user's goal,\n"
        user_prompt += "what is the single next action to take?\n\nRespond with exactly one JSON action block.\n"

        images = []
        if context.sanitized_screenshot:
            img = context.sanitized_screenshot
            if img.startswith("data:image"):
                img = img.split(",", 1)[1]
            images.append(img)

        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": user_prompt,
                    "images": images
                }
            ],
            "format": "json",
            "options": {
                "temperature": 0.0,
                "num_predict": 2048
            },
            "keep_alive": "5m",
            "stream": False
        }

        try:
            with httpx.Client(timeout=120.0) as client:
                response = client.post(f"{self.url}/api/chat", json=payload)
                response.raise_for_status()
                result = response.json()

            msg_obj = result.get("message", {})
            content = msg_obj.get("content", "").strip()
            thinking = msg_obj.get("thinking", "").strip()
            text_to_search = content if content else thinking
            
            import re
            # Extract JSON block containing action_type
            json_str = ""
            matches = re.findall(r'\{[^{}]*"action_type"[^{}]*\}', text_to_search)
            if matches:
                json_str = matches[-1]
            else:
                blocks = re.findall(r'\{[\s\S]*?\}', text_to_search)
                for b in reversed(blocks):
                    try:
                        j = json.loads(b)
                        if isinstance(j, dict) and "action_type" in j:
                            json_str = b
                            break
                    except Exception:
                        continue
            
            if not json_str:
                json_str = text_to_search

            try:
                parsed = json.loads(json_str)
            except json.JSONDecodeError as err:
                slog.error(module="OLLAMA", event="JSON_PARSE_ERROR", content=content or thinking)
                return ActionObject(action_type="fail", reasoning="Failed to parse JSON from VLM")

            return ActionObject(
                action_type=parsed.get("action_type", "fail"),
                target=parsed.get("target"),
                value=parsed.get("value"),
                reasoning=parsed.get("reasoning", "")
            )

        except Exception as e:
            slog.error(module="OLLAMA", event="API_ERROR", error=str(e))
            return ActionObject(action_type="fail", reasoning=f"VLM API Error: {str(e)}")


ollama_vlm_provider = OllamaProvider()
