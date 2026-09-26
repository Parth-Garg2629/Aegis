"""
ollama.py — Ollama VLM Provider (E3 Hardened)
==============================================

AEGIS local VLM provider using Ollama + Qwen3-VL.

Design goals:
- Local-only Ollama endpoint.
- Vision input from sanitized screenshot only.
- Strict ActionObject JSON schema.
- Explicitly disable model thinking for low-latency agent actions.
- Robust JSON extraction/validation.
- Fail-closed behavior.
- Retry once on timeout / malformed response.
- Never log raw VLM output because it may contain sensitive content.
"""

import json
import os
import re
from typing import List, Optional, Dict, Any, Tuple

import httpx
from pydantic import ValidationError

from aegis_server.protocol import ActionObject, ContextUpdatePayload
from aegis_server.providers.base import VLMProvider
from aegis_server.session import ActionHistoryItem
from aegis_server.slog import slog
from aegis_server.prompt_builder import prompt_builder


class OllamaProvider(VLMProvider):
    """
    Local Ollama-backed VLM provider.

    Default:
        http://127.0.0.1:11434
        qwen3-vl:4b
    """

    def __init__(
        self,
        url: str = "http://127.0.0.1:11434",
        model: str = "qwen3-vl:4b",
        timeout_seconds: float = 60.0,
    ):
        self.url = url.rstrip("/")
        self.model_name = model
        self.timeout_seconds = timeout_seconds

    # ------------------------------------------------------------------
    # PROMPT
    # ------------------------------------------------------------------

    def _build_prompt(
        self,
        context: ContextUpdatePayload,
        goal: str,
        action_history: Optional[List[ActionHistoryItem]] = None,
    ) -> str:
        """
        Build the per-cycle agent prompt.
        """
        prompt = f"USER GOAL: {goal}\n"
        prompt += f"CURRENT STEP: {context.step_number}\n\n"

        if action_history:
            prompt += "ACTION HISTORY (Last 5):\n"
            for item in action_history[-5:]:
                success_str = f" [Success: {item.execution_success}]" if item.execution_success is not None else ""
                val_str = f" value='{item.value}'" if item.value is not None else ""
                tgt_str = f" target='{item.target}'" if item.target is not None else ""
                prompt += f"  Step {item.step_number}: {item.action_type}{tgt_str}{val_str}{success_str}\n"
            prompt += "\n"

        if context.previous_action_result:
            prompt += "PREVIOUS ACTION RESULT:\n"
            prompt += f"{context.previous_action_result.model_dump_json()}\n\n"

        prompt += "PAGE ELEMENTS:\n"
        for e in context.sanitized_schema.elements:
            opts = f", options={e.attributes.get('options')}" if e.attributes and 'options' in e.attributes else ""
            val = f", value=\"{e.value}\"" if e.value else ""
            prompt += f"- id=\"{e.id}\" tag=\"{e.tagName}\" label=\"{e.label}\"{val}{opts}\n"

        prompt += "\nRespond with the single JSON action to execute:"
        return prompt.strip()

    # ------------------------------------------------------------------
    # JSON EXTRACTION
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_json_object(content: str) -> Optional[Dict[str, Any]]:
        """
        Extract one JSON object from model output.

        Handles:
        - plain JSON
        - ```json ... ```
        - surrounding whitespace/text

        This is intentionally conservative:
        if we cannot obtain a JSON object, we fail closed.
        """

        if not content:
            return None

        text = content.strip()

        # 1. Direct JSON
        try:
            parsed = json.loads(text)

            if isinstance(parsed, dict):
                return parsed

        except json.JSONDecodeError:
            pass

        # 2. Markdown fenced JSON
        fenced = re.search(
            r"```(?:json)?\s*(\{.*?\})\s*```",
            text,
            flags=re.DOTALL | re.IGNORECASE,
        )

        if fenced:
            try:
                parsed = json.loads(fenced.group(1))

                if isinstance(parsed, dict):
                    return parsed

            except json.JSONDecodeError:
                pass

        # 3. Locate the first object in surrounding text.
        #
        # We deliberately use a small brace scanner rather than a greedy
        # regex so nested JSON remains valid.
        start = text.find("{")

        if start == -1:
            return None

        depth = 0
        in_string = False
        escaped = False

        for index in range(start, len(text)):
            char = text[index]

            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False

                continue

            if char == '"':
                in_string = True

            elif char == "{":
                depth += 1

            elif char == "}":
                depth -= 1

                if depth == 0:
                    candidate = text[start : index + 1]

                    try:
                        parsed = json.loads(candidate)

                        if isinstance(parsed, dict):
                            return parsed

                    except json.JSONDecodeError:
                        return None

        return None

    # ------------------------------------------------------------------
    # ACTION NORMALIZATION + VALIDATION
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_action(parsed: Dict[str, Any]) -> Optional[ActionObject]:
        """
        Convert model JSON into a validated ActionObject.

        Fail closed if the model returns an invalid action.
        """

        if not isinstance(parsed, dict):
            return None

        # Only these fields belong to the AEGIS ActionObject.
        action_type = parsed.get("action_type")
        target = parsed.get("target")
        value = parsed.get("value")
        reasoning = parsed.get("reasoning")

        if not isinstance(action_type, str):
            return None

        action_type = action_type.strip().lower()

        if target is not None:
            target = str(target).strip() or None

        if value is not None:
            value = str(value).strip() or None

        if reasoning is not None:
            reasoning = str(reasoning).strip()

            # Protocol limits reasoning to 1000 chars.
            reasoning = reasoning[:1000]
        else:
            reasoning = ""

        normalized = {
            "action_type": action_type,
            "target": target,
            "value": value,
            "reasoning": reasoning,
        }

        try:
            # Pydantic is the final authority for the ActionObject contract.
            return ActionObject.model_validate(normalized)

        except ValidationError:
            return None

    # ------------------------------------------------------------------
    # OLLAMA HTTP CALL
    # ------------------------------------------------------------------

    def _call_ollama(
        self,
        payload: Dict[str, Any],
    ) -> Tuple[bool, ActionObject]:
        """
        Make one Ollama /api/chat request.

        Returns:
            (True, validated_action)
            or
            (False, fail_action)

        Raw model output is NEVER written to logs.
        """

        fail_action = ActionObject(
            action_type="fail",
            reasoning="VLM response could not be safely parsed.",
        )

        try:
            with httpx.Client(
                timeout=httpx.Timeout(
                    connect=10.0,
                    read=self.timeout_seconds,
                    write=10.0,
                    pool=10.0,
                )
            ) as client:

                response = client.post(
                    f"{self.url}/api/chat",
                    json=payload,
                )

                response.raise_for_status()

                result = response.json()

            # ----------------------------------------------------------
            # Validate Ollama envelope
            # ----------------------------------------------------------

            message = result.get("message")

            if not isinstance(message, dict):
                slog.error(
                    module="OLLAMA",
                    event="INVALID_RESPONSE_ENVELOPE",
                )
                return False, fail_action

            content = message.get("content", "")

            if not isinstance(content, str):
                slog.error(
                    module="OLLAMA",
                    event="INVALID_RESPONSE_CONTENT",
                )
                return False, fail_action

            content = content.strip()

            # ----------------------------------------------------------
            # JSON extraction
            # ----------------------------------------------------------

            parsed = self._extract_json_object(content)

            if parsed is None:
                # IMPORTANT:
                # Do NOT log raw content here.
                # It could contain sensitive information.
                slog.error(
                    module="OLLAMA",
                    event="JSON_PARSE_ERROR",
                    response_length=len(content),
                )

                return False, fail_action

            # ----------------------------------------------------------
            # Action validation
            # ----------------------------------------------------------

            action = self._normalize_action(parsed)

            if action is None:
                slog.error(
                    module="OLLAMA",
                    event="ACTION_VALIDATION_ERROR",
                )
                return False, fail_action

            slog.info(
                module="OLLAMA",
                event="ACTION_PARSED",
                action_type=action.action_type,
            )

            return True, action

        except httpx.TimeoutException:
            slog.warn(
                module="OLLAMA",
                event="VLM_TIMEOUT",
            )

            return False, ActionObject(
                action_type="fail",
                reasoning="VLM timeout.",
            )

        except httpx.HTTPStatusError as exc:
            slog.error(
                module="OLLAMA",
                event="HTTP_ERROR",
                status_code=exc.response.status_code,
            )

            return False, ActionObject(
                action_type="fail",
                reasoning="VLM HTTP request failed.",
            )

        except httpx.RequestError:
            slog.error(
                module="OLLAMA",
                event="CONNECTION_ERROR",
            )

            return False, ActionObject(
                action_type="fail",
                reasoning="Could not connect to local Ollama.",
            )

        except Exception:
            # Do not expose arbitrary exception strings to the protocol.
            slog.error(
                module="OLLAMA",
                event="API_ERROR",
            )

            return False, ActionObject(
                action_type="fail",
                reasoning="Unexpected VLM provider error.",
            )

    # ------------------------------------------------------------------
    # PUBLIC PROVIDER API
    # ------------------------------------------------------------------

    def generate_action(
        self,
        context: ContextUpdatePayload,
        goal: str,
        action_history: Optional[List[ActionHistoryItem]] = None,
    ) -> ActionObject:

        slog.info(
            module="OLLAMA",
            event="CALLING_VLM",
            model=self.model_name,
            step=context.step_number,
        )

        user_prompt = self._build_prompt(
            context=context,
            goal=goal,
            action_history=action_history,
        )

        # --------------------------------------------------------------
        # Sanitized screenshot only
        # --------------------------------------------------------------

        images: List[str] = []

        if context.sanitized_screenshot:
            img = context.sanitized_screenshot

            if img.startswith("data:image"):
                img = img.split(",", 1)[1]

            images.append(img)

        # --------------------------------------------------------------
        # Strict structured output
        # --------------------------------------------------------------

        schema = ActionObject.model_json_schema()

        # --------------------------------------------------------------
        # Client metadata
        # --------------------------------------------------------------

        if hasattr(context, "client_metadata") and context.client_metadata:
            ext_ver = context.client_metadata.extension_version
            browser = context.client_metadata.browser
        else:
            ext_ver = "unknown"
            browser = "unknown"

        # --------------------------------------------------------------
        # System prompt
        # --------------------------------------------------------------

        system_prompt = prompt_builder.build_system_prompt(
            extension_version=ext_ver,
            browser=browser,
        )

        # --------------------------------------------------------------
        # Ollama payload
        # --------------------------------------------------------------

        payload: Dict[str, Any] = {
            "model": self.model_name,

            "messages": [
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": user_prompt,
                    "images": images,
                },
            ],

            # Ollama structured-output support.
            "format": "json",

            # Deterministic agent behavior.
            "options": {
                "temperature": 0.0,
                "top_p": 0.8,
                "num_predict": 512,
            },

            # Qwen3 supports thinking control.
            # Agent actions don't need a long reasoning trace.
            "think": False,

            "keep_alive": "5m",

            "stream": False,
        }

        # --------------------------------------------------------------
        # First attempt
        # --------------------------------------------------------------

        success, action = self._call_ollama(payload)

        if success:
            return action

        # --------------------------------------------------------------
        # One retry
        # --------------------------------------------------------------

        slog.info(
            module="OLLAMA",
            event="RETRYING_VLM",
            step=context.step_number,
        )

        success, action = self._call_ollama(payload)

        if success:
            return action

        # --------------------------------------------------------------
        # Fail closed
        # --------------------------------------------------------------

        return ActionObject(
            action_type="fail",
            reasoning="VLM failed to produce a valid browser action.",
        )


# ----------------------------------------------------------------------
# Global provider instance
# ----------------------------------------------------------------------

ollama_vlm_provider = OllamaProvider(
    url=os.environ.get(
        "OLLAMA_BASE_URL",
        "http://127.0.0.1:11434",
    ),
    model=os.environ.get(
        "OLLAMA_MODEL",
        "qwen3-vl:4b",
    ),
    timeout_seconds=float(
        os.environ.get(
            "OLLAMA_TIMEOUT_SECONDS",
            "60",
        )
    ),
)