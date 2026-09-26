"""
ollama.py — Ollama VLM Provider (E3 Hardened)
==============================================
E3 Hardening:
- Implements VLMProvider abstract base class.
- Uses strict JSON schema enforcement via Ollama's `format` parameter.
- Configurable timeout with 1 retry on timeout or parse failure.
- Output normalization (trimming, lowercasing).
- Fail-closed error handling.
"""

import json
import os
import httpx
from typing import List, Optional, Dict, Any, Tuple

from aegis_server.protocol import ActionObject, ContextUpdatePayload
from aegis_server.providers.base import VLMProvider
from aegis_server.session import ActionHistoryItem
from aegis_server.slog import slog
from aegis_server.prompt_builder import prompt_builder


class OllamaProvider(VLMProvider):
    def __init__(self, url: str = "http://localhost:11434", model: str = "qwen3-vl:4b", timeout_seconds: float = 30.0):
        self.url = url
        self.model = model
        self.timeout_seconds = timeout_seconds

    def _build_prompt(
        self,
        context: ContextUpdatePayload,
        goal: str,
        action_history: Optional[List[ActionHistoryItem]] = None,
    ) -> str:
        """
        Builds the per-cycle prompt based on BROWSER_AGENT_SPEC §4.3.
        """
        prompt = f"USER GOAL: {goal}\n\n"
        prompt += f"CURRENT STEP: {context.step_number}\n\n"

        if action_history and len(action_history) > 0:
            prompt += "ACTION HISTORY (Last 5):\n"
            for item in action_history[-5:]:
                success_str = f" [Success: {item.execution_success}]" if item.execution_success is not None else ""
                val_str = f" value='{item.value}'" if item.value else ""
                tgt_str = f" target='{item.target}'" if item.target else ""
                prompt += f"  Step {item.step_number}: {item.action_type}{tgt_str}{val_str}{success_str}\n"
            prompt += "\n"

        if context.previous_action_result:
            prompt += f"PREVIOUS ACTION RESULT: {context.previous_action_result.model_dump_json()}\n\n"

        prompt += "STRUCTURED SCHEMA:\n"
        prompt += context.sanitized_schema.model_dump_json(indent=2) + "\n\n"
        prompt += "[Sanitized screenshot is attached as the image input]\n\n"
        prompt += "Based on the sanitized screenshot, the structured schema, and the user's goal,\n"
        prompt += "what is the single next action to take?\n"
        
        return prompt

    def _call_ollama(self, payload: Dict[str, Any]) -> Tuple[bool, ActionObject]:
        """
        Makes a single HTTP call to Ollama.
        Returns (success, ActionObject).
        """
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(f"{self.url}/api/chat", json=payload)
                response.raise_for_status()
                result = response.json()

            msg_obj = result.get("message", {})
            content = msg_obj.get("content", "").strip()

            try:
                parsed = json.loads(content)
            except json.JSONDecodeError:
                slog.error(module="OLLAMA", event="JSON_PARSE_ERROR", content=content)
                return False, ActionObject(action_type="fail", reasoning="Failed to parse JSON from VLM")

            # Normalization
            action_type = str(parsed.get("action_type", "fail")).lower().strip()
            
            def norm_str(v: Any) -> Optional[str]:
                if v is None: return None
                s = str(v).strip()
                return s if s else None

            action = ActionObject(
                action_type=action_type,
                target=norm_str(parsed.get("target")),
                value=norm_str(parsed.get("value")),
                reasoning=norm_str(parsed.get("reasoning")) or ""
            )
            return True, action

        except httpx.TimeoutException:
            slog.warn(module="OLLAMA", event="VLM_TIMEOUT")
            return False, ActionObject(action_type="fail", reasoning="VLM timeout")
        except Exception as e:
            slog.error(module="OLLAMA", event="API_ERROR", error=str(e))
            return False, ActionObject(action_type="fail", reasoning=f"VLM API Error: {str(e)}")

    def generate_action(
        self,
        context: ContextUpdatePayload,
        goal: str,
        action_history: Optional[List[ActionHistoryItem]] = None,
    ) -> ActionObject:
        
        slog.info(module="OLLAMA", event="CALLING_VLM", model=self.model, step=context.step_number)

        user_prompt = self._build_prompt(context, goal, action_history)

        images = []
        if context.sanitized_screenshot:
            img = context.sanitized_screenshot
            if img.startswith("data:image"):
                img = img.split(",", 1)[1]
            images.append(img)

        # Get JSON schema for ActionObject to enforce strict structured output
        schema = ActionObject.model_json_schema()

        # Build system prompt dynamically
        ext_ver = context.client_metadata.extension_version if hasattr(context, "client_metadata") else "unknown"
        browser = context.client_metadata.browser if hasattr(context, "client_metadata") else "unknown"
        system_prompt = prompt_builder.build_system_prompt(extension_version=ext_ver, browser=browser)

        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": user_prompt,
                    "images": images
                }
            ],
            "format": schema,
            "options": {
                "temperature": 0.0,
                "num_predict": 2048
            },
            "keep_alive": "5m",
            "stream": False
        }

        # First attempt
        success, action = self._call_ollama(payload)
        if success:
            return action

        # Retry once on failure (timeout or parse error)
        slog.info(module="OLLAMA", event="RETRYING_VLM")
        success, action = self._call_ollama(payload)
        return action


ollama_vlm_provider = OllamaProvider()
