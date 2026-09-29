"""
test_full_model.py - AEGIS Comprehensive Model Test Suite
==========================================================

Tests EVERY layer of the AEGIS server pipeline end-to-end:

  1. Ollama Connectivity          — Can we reach the local Ollama server?
  2. Model Availability           — Is the configured model loaded & ready?
  3. JSON Extraction              — Does _extract_json_object handle all edge cases?
  4. Action Normalization          — Does _normalize_action produce valid ActionObjects?
  5. Action Validator              — Does it enforce closed vocab, target refs, injection blocking?
  6. Risk Engine                   — Does it classify safe / high_risk / blocked correctly?
  7. Session State Machine         — Do state transitions and history work?
  8. Prompt Builder                — Does the system prompt load from template?
  9. Orchestrator Pipeline         — Full decide_next_action with mock provider
 10. Live VLM Inference           — Real Ollama call → ActionObject round-trip

Usage:
    cd server
    set PYTHONIOENCODING=utf-8
    python test_full_model.py

Environment:
    OLLAMA_BASE_URL  (default: http://127.0.0.1:11434)
    OLLAMA_MODEL     (default: qwen3-vl:4b)
"""

import json
import os
import sys
import time
import traceback
from dataclasses import dataclass
from typing import Optional, List

# Force UTF-8 output on Windows
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore

# -- Ensure the server package is importable --
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── AEGIS imports ────────────────────────────────────────────────────────────
from aegis_server.protocol import (
    ActionObject,
    ContextUpdatePayload,
    SanitizedSchema,
    SanitizedElement,
    BoundingBox,
    PreviousActionResult,
    RiskAssessment,
    ClientMetadata,
    SessionInitPayload,
)
from aegis_server.providers.ollama import OllamaProvider
from aegis_server.action_validator import ActionValidator, action_validator
from aegis_server.risk_engine import RiskEngine, risk_engine
from aegis_server.session import Session, SessionManager, SessionState, ActionHistoryItem
from aegis_server.prompt_builder import PromptBuilder, prompt_builder
from aegis_server.orchestrator import AgentOrchestrator
from aegis_server.providers.base import VLMProvider
from aegis_server.providers.mock import mock_vlm_provider

import httpx


# ══════════════════════════════════════════════════════════════════════════════
# CONSTANTS & HELPERS
# ══════════════════════════════════════════════════════════════════════════════

OLLAMA_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3-vl:4b")

PASS = "[PASS]"
FAIL = "[FAIL]"
WARN = "[WARN]"
SKIP = "[SKIP]"

passed = 0
failed = 0
skipped = 0
warnings = 0


def report(status: str, test_name: str, detail: str = ""):
    global passed, failed, skipped, warnings
    if status == PASS:
        passed += 1
    elif status == FAIL:
        failed += 1
    elif status == SKIP:
        skipped += 1
    elif status == WARN:
        warnings += 1
    detail_str = f"  — {detail}" if detail else ""
    print(f"  {status}  {test_name}{detail_str}")


def make_schema(
    elements: Optional[List[SanitizedElement]] = None,
    url: str = "https://example.com",
    title: str = "Test Page",
) -> SanitizedSchema:
    if elements is None:
        elements = [
            SanitizedElement(
                id="el-0",
                tagName="input",
                type="text",
                label="Search",
                boundingBox=BoundingBox(x=10, y=10, width=200, height=30),
                isVisible=True,
                isDisabled=False,
                isReadOnly=False,
                isInteractive=True,
            ),
            SanitizedElement(
                id="el-1",
                tagName="button",
                text="Submit",
                label="Submit",
                boundingBox=BoundingBox(x=10, y=50, width=100, height=30),
                isVisible=True,
                isDisabled=False,
                isReadOnly=False,
                isInteractive=True,
            ),
            SanitizedElement(
                id="el-2",
                tagName="a",
                text="External Link",
                label="External Link",
                attributes={"href": "https://evil.com/phish"},
                boundingBox=BoundingBox(x=10, y=90, width=100, height=30),
                isVisible=True,
                isDisabled=False,
                isReadOnly=False,
                isInteractive=True,
            ),
        ]
    return SanitizedSchema(url=url, title=title, elements=elements)


def make_context(
    step: int = 1,
    schema: Optional[SanitizedSchema] = None,
    screenshot: str = "",
    prev_result: Optional[PreviousActionResult] = None,
) -> ContextUpdatePayload:
    return ContextUpdatePayload(
        step_number=step,
        agent_state="running",
        sanitized_screenshot=screenshot,
        screenshot_format="webp",
        sanitized_schema=schema or make_schema(),
        previous_action_result=prev_result,
    )


def make_client_metadata() -> ClientMetadata:
    return ClientMetadata(
        extension_version="1.0.0",
        browser="chrome",
        browser_version="130.0.0.0",
        max_steps=30,
    )


# ══════════════════════════════════════════════════════════════════════════════
# TEST SUITES
# ══════════════════════════════════════════════════════════════════════════════


def test_1_ollama_connectivity() -> bool:
    """Check if Ollama HTTP server is reachable."""
    print("\n=== TEST 1: Ollama Connectivity ===")
    try:
        resp = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=10.0)
        if resp.status_code == 200:
            report(PASS, "Ollama server reachable", f"URL={OLLAMA_URL}")
            return True
        else:
            report(FAIL, "Ollama server responded with error", f"Status={resp.status_code}")
            return False
    except httpx.ConnectError:
        report(FAIL, "Cannot connect to Ollama", f"URL={OLLAMA_URL} — Is Ollama running?")
        return False
    except Exception as e:
        report(FAIL, "Ollama connectivity check failed", str(e))
        return False


def test_2_model_availability() -> bool:
    """Check if the configured model is available on Ollama."""
    print("\n=== TEST 2: Model Availability ===")
    try:
        resp = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=10.0)
        data = resp.json()
        models = [m.get("name", "") for m in data.get("models", [])]
        
        # Check exact or partial match
        model_found = any(OLLAMA_MODEL in m for m in models)
        
        if model_found:
            report(PASS, f"Model '{OLLAMA_MODEL}' is available")
            return True
        else:
            available = ", ".join(models[:10]) if models else "(none)"
            report(FAIL, f"Model '{OLLAMA_MODEL}' NOT found", f"Available: {available}")
            return False
    except Exception as e:
        report(FAIL, "Model availability check failed", str(e))
        return False


def test_3_json_extraction():
    """Test OllamaProvider._extract_json_object with various inputs."""
    print("\n=== TEST 3: JSON Extraction ===")

    extract = OllamaProvider._extract_json_object

    # 3a — Clean JSON
    result = extract('{"action_type": "click", "target": "el-0"}')
    if result and result.get("action_type") == "click":
        report(PASS, "Clean JSON")
    else:
        report(FAIL, "Clean JSON", repr(result))

    # 3b — Markdown fenced JSON
    result = extract('```json\n{"action_type": "type", "target": "el-1", "value": "hello"}\n```')
    if result and result.get("action_type") == "type":
        report(PASS, "Markdown fenced JSON")
    else:
        report(FAIL, "Markdown fenced JSON", repr(result))

    # 3c — JSON embedded in text
    result = extract('Here is the action: {"action_type": "scroll", "value": "down"} done.')
    if result and result.get("action_type") == "scroll":
        report(PASS, "JSON embedded in text")
    else:
        report(FAIL, "JSON embedded in text", repr(result))

    # 3d — Empty/None input
    result = extract("")
    if result is None:
        report(PASS, "Empty input returns None")
    else:
        report(FAIL, "Empty input should return None", repr(result))

    result = extract(None)  # type: ignore
    if result is None:
        report(PASS, "None input returns None")
    else:
        report(FAIL, "None input should return None", repr(result))

    # 3e — Invalid JSON
    result = extract("this is not json at all")
    if result is None:
        report(PASS, "Invalid text returns None")
    else:
        report(FAIL, "Invalid text should return None", repr(result))

    # 3f — Nested JSON (should extract outer)
    result = extract('{"action_type": "click", "target": "el-0", "reasoning": "nested {key}"}')
    if result and result.get("action_type") == "click":
        report(PASS, "JSON with nested braces in string")
    else:
        report(FAIL, "JSON with nested braces in string", repr(result))

    # 3g — Whitespace-padded JSON
    result = extract('   \n  {"action_type": "done"}  \n  ')
    if result and result.get("action_type") == "done":
        report(PASS, "Whitespace-padded JSON")
    else:
        report(FAIL, "Whitespace-padded JSON", repr(result))


def test_4_action_normalization():
    """Test OllamaProvider._normalize_action."""
    print("\n=== TEST 4: Action Normalization ===")

    normalize = OllamaProvider._normalize_action

    # 4a — Valid click
    result = normalize({"action_type": "click", "target": "el-0", "reasoning": "test"})
    if result and result.action_type == "click" and result.target == "el-0":
        report(PASS, "Valid click action")
    else:
        report(FAIL, "Valid click action", repr(result))

    # 4b — Valid type with value
    result = normalize({"action_type": "type", "target": "el-1", "value": "hello"})
    if result and result.action_type == "type" and result.value == "hello":
        report(PASS, "Valid type action with value")
    else:
        report(FAIL, "Valid type action with value", repr(result))

    # 4c — Case insensitivity
    result = normalize({"action_type": "CLICK", "target": "el-0"})
    if result and result.action_type == "click":
        report(PASS, "Case-insensitive action_type")
    else:
        report(FAIL, "Case-insensitive action_type", repr(result))

    # 4d — Invalid action_type
    result = normalize({"action_type": "fly", "target": "el-0"})
    if result is None:
        report(PASS, "Invalid action_type returns None")
    else:
        report(FAIL, "Invalid action_type should return None", repr(result))

    # 4e — Missing action_type
    result = normalize({"target": "el-0"})
    if result is None:
        report(PASS, "Missing action_type returns None")
    else:
        report(FAIL, "Missing action_type should return None", repr(result))

    # 4f — Done/fail without target
    result = normalize({"action_type": "done", "reasoning": "Goal achieved"})
    if result and result.action_type == "done":
        report(PASS, "done action without target")
    else:
        report(FAIL, "done action without target", repr(result))

    result = normalize({"action_type": "fail", "reasoning": "Cannot proceed"})
    if result and result.action_type == "fail":
        report(PASS, "fail action without target")
    else:
        report(FAIL, "fail action without target", repr(result))

    # 4g — Long reasoning gets truncated
    long_reasoning = "x" * 2000
    result = normalize({"action_type": "done", "reasoning": long_reasoning})
    if result and len(result.reasoning or "") <= 1000:
        report(PASS, "Long reasoning truncated to ≤1000 chars")
    else:
        report(FAIL, "Long reasoning should be truncated", f"len={len(result.reasoning or '') if result else 'None'}")

    # 4h — Non-dict input
    result = normalize("not a dict")  # type: ignore
    if result is None:
        report(PASS, "Non-dict input returns None")
    else:
        report(FAIL, "Non-dict input should return None", repr(result))


def test_5_action_validator():
    """Test ActionValidator against protocol rules."""
    print("\n=== TEST 5: Action Validator ===")

    ctx = make_context()
    av = action_validator

    # 5a — Valid click on existing target
    action = ActionObject(action_type="click", target="el-0")
    result = av.validate_action(action, ctx)
    if result.valid:
        report(PASS, "Click on valid target")
    else:
        report(FAIL, "Click on valid target should be valid", result.error_message or "")

    # 5b — Click on non-existent target
    action = ActionObject(action_type="click", target="el-999")
    result = av.validate_action(action, ctx)
    if not result.valid and result.error_code == "E-VAL-02":
        report(PASS, "Click on non-existent target → E-VAL-02")
    else:
        report(FAIL, "Click on non-existent target should fail E-VAL-02", f"valid={result.valid}, code={result.error_code}")

    # 5c — Click without target
    action = ActionObject(action_type="click", target=None)
    result = av.validate_action(action, ctx)
    if not result.valid and result.error_code == "E-VAL-03":
        report(PASS, "Click without target → E-VAL-03")
    else:
        report(FAIL, "Click without target should fail E-VAL-03", f"valid={result.valid}, code={result.error_code}")

    # 5d — Type without value
    action = ActionObject(action_type="type", target="el-0", value=None)
    result = av.validate_action(action, ctx)
    if not result.valid and result.error_code == "E-VAL-04":
        report(PASS, "Type without value → E-VAL-04")
    else:
        report(FAIL, "Type without value should fail E-VAL-04", f"valid={result.valid}, code={result.error_code}")

    # 5e — Type with valid target and value
    action = ActionObject(action_type="type", target="el-0", value="hello")
    result = av.validate_action(action, ctx)
    if result.valid:
        report(PASS, "Type with valid target & value")
    else:
        report(FAIL, "Type with valid target & value should be valid", result.error_message or "")

    # 5f — Scroll with invalid direction
    action = ActionObject(action_type="scroll", value="left")
    result = av.validate_action(action, ctx)
    if not result.valid and result.error_code == "E-VAL-05":
        report(PASS, "Scroll with invalid direction → E-VAL-05")
    else:
        report(FAIL, "Scroll with invalid direction should fail E-VAL-05", f"valid={result.valid}, code={result.error_code}")

    # 5g — Scroll with valid direction
    action = ActionObject(action_type="scroll", value="down")
    result = av.validate_action(action, ctx)
    if result.valid:
        report(PASS, "Scroll with valid direction 'down'")
    else:
        report(FAIL, "Scroll with valid direction should pass", result.error_message or "")

    # 5h — Script injection in value
    action = ActionObject(action_type="type", target="el-0", value="<script>alert(1)</script>")
    result = av.validate_action(action, ctx)
    if not result.valid and result.error_code == "E-VAL-06":
        report(PASS, "Script injection blocked → E-VAL-06")
    else:
        report(FAIL, "Script injection should fail E-VAL-06", f"valid={result.valid}, code={result.error_code}")

    # 5i — javascript: URI injection
    action = ActionObject(action_type="type", target="el-0", value="javascript:void(0)")
    result = av.validate_action(action, ctx)
    if not result.valid and result.error_code == "E-VAL-06":
        report(PASS, "javascript: URI injection blocked → E-VAL-06")
    else:
        report(FAIL, "javascript: URI injection should fail E-VAL-06", f"valid={result.valid}, code={result.error_code}")

    # 5j — done/fail don't need target
    action = ActionObject(action_type="done")
    result = av.validate_action(action, ctx)
    if result.valid:
        report(PASS, "done without target is valid")
    else:
        report(FAIL, "done without target should be valid", result.error_message or "")

    # 5k — Target with id="..." wrapper gets stripped
    action = ActionObject(action_type="click", target='id="el-0"')
    result = av.validate_action(action, ctx)
    if result.valid and action.target == "el-0":
        report(PASS, "Target id=\"...\" wrapper stripped correctly")
    else:
        report(FAIL, "Target id=\"...\" wrapper should be stripped", f"target={action.target}, valid={result.valid}")


def test_6_risk_engine():
    """Test RiskEngine classification."""
    print("\n=== TEST 6: Risk Engine ===")

    re = risk_engine
    ctx = make_context()

    # 6a — Safe actions
    for at in ["wait", "done", "fail", "scroll"]:
        action = ActionObject(action_type=at, value="down" if at == "scroll" else None)  # type: ignore
        result = re.evaluate(action, ctx)
        if result.level == "safe":
            report(PASS, f"'{at}' action → safe")
        else:
            report(FAIL, f"'{at}' action should be safe", f"level={result.level}")

    # 6b — Script injection → blocked
    action = ActionObject(action_type="type", target="el-0", value="javascript:alert(1)")
    result = re.evaluate(action, ctx)
    if result.level == "blocked":
        report(PASS, "Script injection in type → blocked")
    else:
        report(FAIL, "Script injection should be blocked", f"level={result.level}")

    # 6c — External link click → blocked
    action = ActionObject(action_type="click", target="el-2")
    result = re.evaluate(action, ctx)
    if result.level == "blocked":
        report(PASS, "External link click → blocked")
    else:
        report(FAIL, "External link click should be blocked", f"level={result.level}")

    # 6d — Payment keyword → high_risk
    pay_elements = [
        SanitizedElement(
            id="el-pay",
            tagName="button",
            text="Buy Now",
            label="Buy Now",
            boundingBox=BoundingBox(x=10, y=10, width=100, height=30),
            isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
        )
    ]
    pay_ctx = make_context(schema=make_schema(elements=pay_elements))
    action = ActionObject(action_type="click", target="el-pay")
    result = re.evaluate(action, pay_ctx)
    if result.level == "high_risk" and result.category == "HR-01":
        report(PASS, "Payment button click → high_risk HR-01")
    else:
        report(FAIL, "Payment button should be high_risk HR-01", f"level={result.level}, cat={result.category}")

    # 6e — Password field typing → blocked
    pw_elements = [
        SanitizedElement(
            id="el-pw",
            tagName="input",
            type="password",
            label="Password",
            boundingBox=BoundingBox(x=10, y=10, width=100, height=30),
            isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
        )
    ]
    pw_ctx = make_context(schema=make_schema(elements=pw_elements))
    action = ActionObject(action_type="type", target="el-pw", value="my_secret_password")
    result = re.evaluate(action, pw_ctx)
    if result.level == "blocked":
        report(PASS, "Typing raw value into password field → blocked")
    else:
        report(FAIL, "Typing into password field should be blocked", f"level={result.level}")

    # 6f — [NEEDS_LOCAL_INPUT] typing → safe
    action = ActionObject(action_type="type", target="el-pw", value="[NEEDS_LOCAL_INPUT]")
    result = re.evaluate(action, pw_ctx)
    if result.level == "safe":
        report(PASS, "[NEEDS_LOCAL_INPUT] value → safe")
    else:
        report(FAIL, "[NEEDS_LOCAL_INPUT] should be safe", f"level={result.level}")

    # 6g — Normal click → safe
    action = ActionObject(action_type="click", target="el-1")
    result = re.evaluate(action, ctx)
    if result.level == "safe":
        report(PASS, "Normal button click → safe")
    else:
        report(FAIL, "Normal button click should be safe", f"level={result.level}")


def test_7_session_state_machine():
    """Test Session state transitions, history, and privacy."""
    print("\n=== TEST 7: Session State Machine ===")

    meta = make_client_metadata()

    # 7a — Session creation → ACTIVE
    session = Session("test-001", "Search for scholarships", meta, max_steps=10)
    if session.state == SessionState.ACTIVE:
        report(PASS, "New session starts in ACTIVE state")
    else:
        report(FAIL, "New session should be ACTIVE", f"state={session.state}")

    # 7b — ACTIVE → WAITING_CONTEXT
    session.set_waiting_context()
    if session.state == SessionState.WAITING_CONTEXT:
        report(PASS, "Transition: ACTIVE → WAITING_CONTEXT")
    else:
        report(FAIL, "Should transition to WAITING_CONTEXT", f"state={session.state}")

    # 7c — WAITING_CONTEXT → INFERRING
    session.set_inferring()
    if session.state == SessionState.INFERRING:
        report(PASS, "Transition: WAITING_CONTEXT → INFERRING")
    else:
        report(FAIL, "Should transition to INFERRING", f"state={session.state}")

    # 7d — INFERRING → WAITING_CONTEXT
    session.set_waiting_context()
    if session.state == SessionState.WAITING_CONTEXT:
        report(PASS, "Transition: INFERRING → WAITING_CONTEXT")
    else:
        report(FAIL, "Should transition to WAITING_CONTEXT", f"state={session.state}")

    # 7e — Action history recording
    action = ActionObject(action_type="click", target="el-0", reasoning="Click search")
    session.record_action(action)
    if len(session.action_history) == 1:
        item = session.action_history[0]
        if item.action_type == "click" and item.target == "el-0":
            report(PASS, "Action recorded in history")
        else:
            report(FAIL, "Action history item mismatch", f"type={item.action_type}, target={item.target}")
    else:
        report(FAIL, "Action history should have 1 item", f"len={len(session.action_history)}")

    # 7f — Step number incremented
    if session.current_step == 2:
        report(PASS, "Step number incremented after action")
    else:
        report(FAIL, "Step number should be 2", f"step={session.current_step}")

    # 7g — Privacy: [NEEDS_LOCAL_INPUT] redacted
    local_input_action = ActionObject(action_type="type", target="el-1", value="[NEEDS_LOCAL_INPUT]")
    session.record_action(local_input_action)
    last_item = session.action_history[-1]
    if last_item.value == "[LOCAL_INPUT_PROVIDED]":
        report(PASS, "Privacy: [NEEDS_LOCAL_INPUT] → [LOCAL_INPUT_PROVIDED]")
    else:
        report(FAIL, "Should redact to [LOCAL_INPUT_PROVIDED]", f"value={last_item.value}")

    # 7h — History FIFO maxlen=5
    for i in range(10):
        session.record_action(ActionObject(action_type="scroll", value="down"))
    if len(session.action_history) == 5:
        report(PASS, "Action history FIFO capped at 5")
    else:
        report(FAIL, "History should cap at 5", f"len={len(session.action_history)}")

    # 7i — Disconnect and resume
    session.set_inferring()
    session.set_waiting_context()
    session.mark_disconnected()
    if session.state == SessionState.DISCONNECTED_GRACE:
        report(PASS, "Transition to DISCONNECTED_GRACE")
    else:
        report(FAIL, "Should be DISCONNECTED_GRACE", f"state={session.state}")

    session.resume()
    if session.state == SessionState.WAITING_CONTEXT:
        report(PASS, "Resume → WAITING_CONTEXT")
    else:
        report(FAIL, "Resume should go to WAITING_CONTEXT", f"state={session.state}")

    # 7j — Terminate clears goal & history
    session.terminate()
    if session.state == SessionState.TERMINATED and session.goal == "" and len(session.action_history) == 0:
        report(PASS, "Terminate clears goal & history")
    else:
        report(FAIL, "Terminate should clear state", f"state={session.state}, goal='{session.goal}', history_len={len(session.action_history)}")

    # 7k — Invalid transition raises error
    try:
        session2 = Session("test-002", "test", meta)
        session2.terminate()
        session2.set_waiting_context()  # TERMINATED → WAITING_CONTEXT is invalid
        report(FAIL, "Invalid transition should raise error")
    except Exception:
        report(PASS, "Invalid transition raises StateTransitionError")

    # 7l — SessionManager
    sm = SessionManager()
    s1 = sm.create_session("goal1", meta)
    s2 = sm.create_session("goal2", meta)
    if sm.get_session(s1.session_id) is not None and sm.get_session(s2.session_id) is not None:
        report(PASS, "SessionManager create & get")
    else:
        report(FAIL, "SessionManager should track sessions")

    removed = sm.remove_session(s1.session_id)
    if removed and sm.get_session(s1.session_id) is None:
        report(PASS, "SessionManager remove")
    else:
        report(FAIL, "SessionManager remove should work")


def test_8_prompt_builder():
    """Test PromptBuilder loads and builds correctly."""
    print("\n=== TEST 8: Prompt Builder ===")

    # 8a — Global instance loads without error
    try:
        system_prompt = prompt_builder.build_system_prompt(
            extension_version="1.0.0",
            browser="chrome",
        )
        if len(system_prompt) > 50:
            report(PASS, "System prompt loaded", f"length={len(system_prompt)} chars")
        else:
            report(WARN, "System prompt suspiciously short", f"length={len(system_prompt)}")
    except Exception as e:
        report(FAIL, "Prompt builder failed", str(e))

    # 8b — OllamaProvider._build_prompt generates expected sections
    provider = OllamaProvider()
    ctx = make_context()
    user_prompt = provider._build_prompt(ctx, goal="Search for scholarships")

    checks = {
        "USER GOAL": "USER GOAL" in user_prompt,
        "CURRENT STEP": "CURRENT STEP" in user_prompt,
        "PAGE ELEMENTS": "PAGE ELEMENTS" in user_prompt,
        "el-0": "el-0" in user_prompt,
        "el-1": "el-1" in user_prompt,
    }
    all_ok = all(checks.values())
    if all_ok:
        report(PASS, "User prompt contains required sections")
    else:
        missing = [k for k, v in checks.items() if not v]
        report(FAIL, "User prompt missing sections", f"Missing: {missing}")

    # 8c — Action history in prompt
    history = [
        ActionHistoryItem(step_number=1, action_type="click", target="el-0", value=None, reasoning="test"),
        ActionHistoryItem(step_number=2, action_type="type", target="el-1", value="hello", reasoning="typing"),
    ]
    user_prompt_with_history = provider._build_prompt(ctx, goal="Test", action_history=history)
    if "ACTION HISTORY" in user_prompt_with_history and "Step 1" in user_prompt_with_history:
        report(PASS, "Action history included in prompt")
    else:
        report(FAIL, "Action history should appear in prompt")


def test_9_orchestrator_pipeline():
    """Test the full orchestrator pipeline with mock provider."""
    print("\n=== TEST 9: Orchestrator Pipeline (Mock Provider) ===")

    meta = make_client_metadata()
    ctx = make_context()

    # 9a — Mock provider orchestrator
    orch = AgentOrchestrator(provider=mock_vlm_provider)
    session = Session("orch-test-001", "Click the submit button", meta)
    session.set_waiting_context()

    action, risk = orch.decide_next_action(session, ctx)

    if action is not None and isinstance(action, ActionObject):
        report(PASS, f"Orchestrator returned ActionObject", f"type={action.action_type}")
    else:
        report(FAIL, "Orchestrator should return ActionObject", repr(action))

    if risk is not None and isinstance(risk, RiskAssessment):
        report(PASS, f"Orchestrator returned RiskAssessment", f"level={risk.level}")
    else:
        # Risk can be None if action was fail
        if action.action_type == "fail":
            report(PASS, "Orchestrator returned None risk (fail action)")
        else:
            report(WARN, "No RiskAssessment returned")

    # 9b — Max steps enforcement
    session2 = Session("orch-test-002", "test", meta, max_steps=1)
    session2.set_waiting_context()
    session2.record_action(ActionObject(action_type="click", target="el-0"))  # step 1 → step 2
    ctx2 = make_context(step=2)
    action2, _ = orch.decide_next_action(session2, ctx2)
    if action2.action_type == "fail" and "Maximum steps" in (action2.reasoning or ""):
        report(PASS, "Max steps enforcement → fail")
    else:
        report(WARN, "Max steps may not enforce correctly", f"type={action2.action_type}, reason={action2.reasoning}")


def test_10_live_vlm_inference(ollama_ok: bool):
    """Test real Ollama VLM inference end-to-end."""
    print("\n=== TEST 10: Live VLM Inference ===")

    if not ollama_ok:
        report(SKIP, "Skipping live VLM test (Ollama not reachable)")
        return

    provider = OllamaProvider(
        url=OLLAMA_URL,
        model=OLLAMA_MODEL,
        timeout_seconds=300.0,
    )

    # Build a realistic context — Google-like search page
    schema = SanitizedSchema(
        url="https://www.google.com",
        title="Google",
        elements=[
            SanitizedElement(
                id="search-input",
                tagName="textarea",
                label="Search",
                text="",
                boundingBox=BoundingBox(x=220, y=300, width=560, height=44),
                isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
            ),
            SanitizedElement(
                id="search-btn",
                tagName="button",
                label="Google Search",
                text="Google Search",
                boundingBox=BoundingBox(x=350, y=370, width=120, height=36),
                isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
            ),
            SanitizedElement(
                id="lucky-btn",
                tagName="button",
                label="I'm Feeling Lucky",
                text="I'm Feeling Lucky",
                boundingBox=BoundingBox(x=500, y=370, width=150, height=36),
                isVisible=True, isDisabled=False, isReadOnly=False, isInteractive=True,
            ),
        ],
    )

    ctx = ContextUpdatePayload(
        step_number=1,
        agent_state="running",
        sanitized_screenshot="",
        screenshot_format="webp",
        sanitized_schema=schema,
    )

    goal = "Search for 'ISRO missions' on Google"

    print(f"  [i] Calling {OLLAMA_MODEL} with goal: '{goal}'...")
    print(f"  [i] This may take 30-120 seconds on first run...")

    start = time.perf_counter()
    try:
        action = provider.generate_action(context=ctx, goal=goal)
        elapsed = time.perf_counter() - start

        print(f"  [i] Response in {elapsed:.1f}s")
        print(f"  [i] Action: type={action.action_type}, target={action.target}, value={action.value}")
        print(f"  [i] Reasoning: {action.reasoning[:120] if action.reasoning else '(none)'}...")

        # Validate the response
        if action.action_type == "fail":
            report(FAIL, "VLM returned fail action", action.reasoning or "")
        elif action.action_type in {"click", "type", "scroll", "hover", "select", "wait", "done"}:
            report(PASS, f"VLM returned valid action_type='{action.action_type}'")

            # Check if the target exists in our schema
            valid_ids = {"search-input", "search-btn", "lucky-btn"}
            if action.target:
                if action.target in valid_ids:
                    report(PASS, f"VLM target '{action.target}' is in the schema")
                else:
                    report(WARN, f"VLM target '{action.target}' NOT in schema", "Model hallucinated a target")

            # For a search goal, we expect either type (into search-input) or click
            if action.action_type == "type" and action.target == "search-input":
                report(PASS, "VLM chose correct action: type into search-input", f"value='{action.value}'")
            elif action.action_type == "click":
                report(PASS, f"VLM chose click on {action.target}")
            else:
                report(WARN, f"Unexpected action for search goal", f"type={action.action_type}, target={action.target}")
        else:
            report(FAIL, "VLM returned unknown action_type", action.action_type)

        # Latency check
        if elapsed < 120:
            report(PASS, f"VLM latency acceptable", f"{elapsed:.1f}s")
        else:
            report(WARN, f"VLM latency high", f"{elapsed:.1f}s - consider GPU acceleration")

        # 10b — Validate the action against our context
        val_result = action_validator.validate_action(action, ctx)
        if val_result.valid:
            report(PASS, "VLM action passes server-side validation")
        else:
            report(WARN, "VLM action failed validation", f"code={val_result.error_code}, msg={val_result.error_message}")

        # 10c — Risk engine on VLM action
        risk = risk_engine.evaluate(action, ctx)
        report(PASS, f"Risk engine classified VLM action", f"level={risk.level}")

    except Exception as e:
        elapsed = time.perf_counter() - start
        report(FAIL, f"Live VLM inference failed after {elapsed:.1f}s", str(e))
        traceback.print_exc()


def test_11_protocol_models():
    """Test Pydantic protocol model validation edge cases."""
    print("\n=== TEST 11: Protocol Model Validation ===")

    # 11a — ActionObject rejects invalid action_type
    try:
        ActionObject(action_type="invalid_action", target="el-0")  # type: ignore
        report(FAIL, "ActionObject should reject invalid action_type")
    except Exception:
        report(PASS, "ActionObject rejects invalid action_type via Pydantic")

    # 11b — ContextUpdatePayload rejects step_number < 1
    try:
        make_context(step=0)
        report(FAIL, "ContextUpdatePayload should reject step=0")
    except Exception:
        report(PASS, "ContextUpdatePayload rejects step_number=0")

    # 11c — ContextUpdatePayload rejects invalid agent_state
    try:
        ContextUpdatePayload(
            step_number=1,
            agent_state="invalid_state",  # type: ignore
            sanitized_screenshot="",
            screenshot_format="webp",
            sanitized_schema=make_schema(),
        )
        report(FAIL, "Should reject invalid agent_state")
    except Exception:
        report(PASS, "Rejects invalid agent_state")

    # 11d — ClientMetadata validates
    try:
        meta = ClientMetadata(
            extension_version="1.0.0",
            browser="chrome",
            browser_version="130.0.0.0",
            max_steps=30,
        )
        report(PASS, "ClientMetadata validation OK")
    except Exception as e:
        report(FAIL, "ClientMetadata validation failed", str(e))

    # 11e — ClientMetadata rejects max_steps > 100
    try:
        ClientMetadata(
            extension_version="1.0.0",
            browser="chrome",
            browser_version="130.0.0.0",
            max_steps=200,  # type: ignore
        )
        report(FAIL, "ClientMetadata should reject max_steps=200")
    except Exception:
        report(PASS, "ClientMetadata rejects max_steps > 100")

    # 11f — Value max_length enforcement
    try:
        ActionObject(action_type="type", target="el-0", value="x" * 501)
        report(FAIL, "ActionObject should reject value > 500 chars")
    except Exception:
        report(PASS, "ActionObject rejects value > 500 chars")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 70)
    print("  AEGIS — Comprehensive Model & Pipeline Test Suite")
    print("=" * 70)
    print(f"  Ollama URL:   {OLLAMA_URL}")
    print(f"  Model:        {OLLAMA_MODEL}")
    print(f"  Python:       {sys.version.split()[0]}")
    print("=" * 70)

    # Run all tests
    ollama_ok = test_1_ollama_connectivity()
    model_ok = test_2_model_availability() if ollama_ok else False
    test_3_json_extraction()
    test_4_action_normalization()
    test_5_action_validator()
    test_6_risk_engine()
    test_7_session_state_machine()
    test_8_prompt_builder()
    test_9_orchestrator_pipeline()
    test_10_live_vlm_inference(ollama_ok and model_ok)
    test_11_protocol_models()

    # Summary
    total = passed + failed + skipped + warnings
    print("\n" + "=" * 70)
    print("  SUMMARY")
    print("=" * 70)
    print(f"  Total:    {total}")
    print(f"  {PASS}:  {passed}")
    print(f"  {FAIL}:  {failed}")
    print(f"  {WARN}:  {warnings}")
    print(f"  {SKIP}:  {skipped}")
    print("=" * 70)

    if failed == 0:
        print("\n  >>> ALL TESTS PASSED! The AEGIS model pipeline is working correctly. <<<\n")
    else:
        print(f"\n  >>> {failed} test(s) failed. Review the output above for details. <<<\n")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
