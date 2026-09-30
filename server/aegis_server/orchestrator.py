"""
orchestrator.py — Agent Orchestrator Engine (E4)
================================================
Engine loop managing VLM calls, session state transitions, 
and generating actions.
"""

import re
from typing import Optional, Tuple
from datetime import datetime, timezone
from urllib.parse import unquote_plus
from aegis_server.protocol import ActionObject, ContextUpdatePayload, RiskAssessment
from aegis_server.providers import VLMProvider, get_configured_provider
from aegis_server.session import Session, SessionState
from aegis_server.slog import slog
from aegis_server.audit_db import audit_db


_SEARCH_GOAL = re.compile(
    r"^\s*search\s+for\s+(.+?)\s*$",
    re.IGNORECASE,
)
_SEARCH_GOAL_FOLLOW_UP = re.compile(
    r"\s+and\s+(?:go|open|visit|click|select)\b.*$",
    re.IGNORECASE,
)


def _search_fallback(goal: str, context: ContextUpdatePayload) -> Optional[ActionObject]:
    """Recover an explicit search request when the model incorrectly returns fail."""
    match = _SEARCH_GOAL.match(goal)
    if not match:
        return None

    query = _SEARCH_GOAL_FOLLOW_UP.sub("", match.group(1)).strip().strip(" \t\r\n\"'`.,!?;:")
    if not query:
        return None

    for element in context.sanitized_schema.elements:
        if (
            element.tagName.lower() not in {"input", "textarea"}
            or not element.isVisible
            or not element.isInteractive
            or element.isDisabled
            or element.isReadOnly
        ):
            continue

        attrs = element.attributes or {}
        hints = " ".join(
            str(value)
            for value in (
                element.type,
                element.role,
                element.label,
                attrs.get("type"),
                attrs.get("role"),
                attrs.get("aria-label"),
                attrs.get("placeholder"),
                attrs.get("name"),
            )
            if value
        ).lower()
        is_search = (
            str(element.type or attrs.get("type", "")).lower() == "search"
            or str(attrs.get("name", "")).lower() in {"q", "query"}
            or bool(re.search(r"\b(search|find)\b", hints))
        )
        if is_search:
            return ActionObject(
                action_type="type",
                target=element.id,
                value=query[:500],
                reasoning="Use the visible search field for the requested search.",
            )
    return None


def _search_completion_action(
    goal: str, context: ContextUpdatePayload
) -> Optional[ActionObject]:
    """Finish a search-only goal after a successful search reaches its results page."""
    match = _SEARCH_GOAL.match(goal)
    previous = context.previous_action_result
    if not match or not previous or not previous.success or previous.action_type != "type":
        return None

    # A goal that asks to open or visit a result still has work after searching.
    raw_query = match.group(1)
    if _SEARCH_GOAL_FOLLOW_UP.search(raw_query):
        return None
    query = raw_query.strip().strip(" \t\r\n\"'`.,!?;:")
    if not query:
        return None

    normalize = lambda value: re.sub(r"\W+", " ", value.casefold()).strip()
    normalized_query = normalize(query)
    page_text = normalize(unquote_plus(context.sanitized_schema.url)) + " " + normalize(
        context.sanitized_schema.title
    )
    if normalized_query and normalized_query in page_text:
        return ActionObject(
            action_type="done",
            reasoning="The requested search results are visible.",
        )
    return None


class AgentOrchestrator:
    def __init__(self, provider: Optional[VLMProvider] = None):
        if provider is None:
            self.provider = get_configured_provider()
        else:
            self.provider = provider

    def decide_next_action(self, session: Session, context: ContextUpdatePayload) -> Tuple[ActionObject, Optional[RiskAssessment]]:
        slog.info(
            module="ORCHESTRATOR",
            event="PROCESSING_CONTEXT_UPDATE",
            session_id=session.session_id,
            step_number=context.step_number,
        )

        session.set_inferring()

        try:
            # 1. Validation (Verify context has sanitized schema and screenshot unless step 1)
            # Handled by E5, but basic checks can go here if needed.
            if session.current_step > session.max_steps:
                return ActionObject(action_type="fail", reasoning="Maximum steps reached"), None

            # Finish search-only goals when the previous search submission
            # succeeded and the current page identifies the requested results.
            action = _search_completion_action(session.goal, context)
            if action:
                slog.info(
                    module="ORCHESTRATOR",
                    event="SEARCH_GOAL_COMPLETED",
                    session_id=session.session_id,
                    step_number=context.step_number,
                )
            else:
                # 2. Call VLM
                action = self.provider.generate_action(
                    context,
                    goal=session.goal,
                    action_history=list(session.action_history)
                )

            if action.action_type == "fail":
                fallback = _search_fallback(session.goal, context)
                if fallback:
                    action = fallback
                    slog.info(
                        module="ORCHESTRATOR",
                        event="SEARCH_FALLBACK_APPLIED",
                        session_id=session.session_id,
                        step_number=context.step_number,
                        target_element_id=fallback.target,
                    )

            # 3. Server-side validation
            from aegis_server.action_validator import action_validator
            val_res = action_validator.validate_action(action, context)
            if not val_res.valid:
                slog.warn(
                    module="ORCHESTRATOR",
                    event="ACTION_VALIDATION_FAILED",
                    session_id=session.session_id,
                    step_number=context.step_number,
                    error_code=val_res.error_code,
                    error_message=val_res.error_message
                )
                return ActionObject(action_type="fail", reasoning=f"Action validation failed: {val_res.error_message}"), None

            # 4. Server-side risk evaluation
            from aegis_server.risk_engine import risk_engine
            risk_assessment = risk_engine.evaluate(action, context)
            
            # 5. Fail closed if blocked
            if risk_assessment.level == "blocked":
                slog.warn(
                    module="ORCHESTRATOR",
                    event="ACTION_BLOCKED",
                    session_id=session.session_id,
                    step_number=context.step_number,
                    reason=risk_assessment.reason
                )
                return ActionObject(action_type="fail", reasoning=f"Action blocked by risk engine: {risk_assessment.reason}"), risk_assessment

            slog.info(
                module="ORCHESTRATOR",
                event="ACTION_DECIDED",
                session_id=session.session_id,
                step_number=context.step_number,
                action_type=action.action_type,
                risk_level=risk_assessment.level
            )

            try:
                _ts = datetime.now(timezone.utc).isoformat()
                # Find target role
                sanitized_target_role = None
                action_value_safe = action.value
                value_classification = "NON_SENSITIVE"
                if action.value == "[NEEDS_LOCAL_INPUT]":
                    value_classification = "LOCAL_INPUT_PROVIDED"
                    action_value_safe = "[LOCAL_INPUT_PROVIDED]"
                    
                if action.target:
                    for el in context.sanitized_schema.elements:
                        if el.id == action.target:
                            sanitized_target_role = el.tagName
                            break
                
                audit_db.record_action(
                    session_id=session.session_id,
                    step_number=context.step_number,
                    action_type=action.action_type,
                    target_element_id=action.target,
                    sanitized_target_role=sanitized_target_role,
                    value_classification=value_classification,
                    action_value_safe=action_value_safe,
                    vlm_reasoning=action.reasoning,
                    risk_category=risk_assessment.category or "SAFE",
                    confirmation_required=(risk_assessment.level == "high_risk"),
                    confirmation_outcome="NOT_REQUIRED" if risk_assessment.level == "safe" else None,
                    execution_status="SUCCESS",
                    error_code=None,
                    timestamp=_ts
                )
                
                audit_db.record_metric(
                    session_id=session.session_id,
                    step_number=context.step_number,
                    timestamp=_ts,
                    dom_elements_total=len(context.sanitized_schema.elements),
                    screenshot_payload_bytes=len(context.sanitized_screenshot) if context.sanitized_screenshot else 0
                )
            except Exception as audit_err:
                slog.warn(module="ORCHESTRATOR", event="AUDIT_RECORD_FAILED", error=str(audit_err))

            return action, risk_assessment

        except Exception as e:
            slog.error(
                module="ORCHESTRATOR", 
                event="VLM_GENERATION_FAILED", 
                session_id=session.session_id, 
                error=str(e)
            )
            return ActionObject(action_type="fail", reasoning="VLM generation failed"), None
        
        finally:
            # Return to WAITING_CONTEXT state after inferring is done
            if session.state == SessionState.INFERRING:
                session.set_waiting_context()


orchestrator = AgentOrchestrator()
