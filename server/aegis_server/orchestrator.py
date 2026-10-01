"""
orchestrator.py — Agent Orchestrator Engine (E4)
================================================
Engine loop managing VLM calls, session state transitions, 
and generating actions.
"""

import re
from typing import Optional, Tuple
from datetime import datetime, timezone
from urllib.parse import urlsplit
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
_FIRST_LINK_GOAL = re.compile(
    r"\b(?:(?:go|open|visit|click|navigate)\b.*\b(?:first|top)\b.*\b(?:link|result|url)\b|(?:first|top)\s+(?:link|result|url)\b)",
    re.IGNORECASE,
)
_LOGOUT_GOAL = re.compile(r"\b(log\s*out|logout|sign\s*out|signout|log\s*off)\b", re.I)
_LOGOUT_CONTROL = re.compile(r"\b(log\s*out|logout|sign\s*out|signout|log\s*off)\b", re.I)
_PROFILE_MENU_CONTROL = re.compile(r"\b(profile|account|user\s+menu|your\s+account|my\s+account)\b", re.I)
_LOGIN_GOAL = re.compile(r"\b(log\s*in|login|sign\s*in|authenticate)\b", re.I)
_LOGIN_CONTROL = re.compile(r"\b(sign\s*in|log\s*in|continue\s+as)\b", re.I)


def _search_fallback(goal: str, context: ContextUpdatePayload) -> Optional[ActionObject]:
    """Recover an explicit search request when the model incorrectly returns fail."""
    match = _SEARCH_GOAL.match(goal)
    if not match:
        return None

    query = _SEARCH_GOAL_FOLLOW_UP.sub("", match.group(1)).strip().strip(" \t\r\n\"'`.,!?;:")
    if not query:
        return None

    for element in context.sanitized_schema.elements:
        if _is_search_field(element):
            return ActionObject(
                action_type="type",
                target=element.id,
                value=query[:500],
                reasoning="Use the visible search field for the requested search.",
            )
    return None


def _is_search_field(element) -> bool:
    if (
        element.tagName.lower() not in {"input", "textarea"}
        or not element.isVisible
        or not element.isInteractive
        or element.isDisabled
        or element.isReadOnly
    ):
        return False

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
    return (
        str(element.type or attrs.get("type", "")).lower() == "search"
        or str(attrs.get("name", "")).lower() in {"q", "query"}
        or bool(re.search(r"\b(search|find)\b", hints))
    )


def _action_targets_search_field(action: ActionObject, context: ContextUpdatePayload) -> bool:
    if action.action_type != "type" or not action.target:
        return False
    return any(
        element.id == action.target and _is_search_field(element)
        for element in context.sanitized_schema.elements
    )


def _action_targets_external_link(action: ActionObject, context: ContextUpdatePayload) -> bool:
    if action.action_type != "click" or not action.target:
        return False
    element = next(
        (item for item in context.sanitized_schema.elements if item.id == action.target),
        None,
    )
    if not element or element.tagName.lower() != "a":
        return False
    href = str((element.attributes or {}).get("href", ""))
    if not href.startswith(("http://", "https://")):
        return False
    target_host = urlsplit(href).hostname
    page_host = urlsplit(context.sanitized_schema.url).hostname
    return bool(target_host and page_host and target_host.lower() != page_host.lower())


def _element_action_text(element) -> str:
    attrs = element.attributes or {}
    return " ".join(
        str(value)
        for value in (
            element.label,
            element.text,
            attrs.get("aria-label"),
            attrs.get("title"),
        )
        if value
    )


def _logout_fallback(goal: str, context: ContextUpdatePayload) -> Optional[ActionObject]:
    """Choose only a clearly labeled logout control or profile menu for logout goals."""
    if not _LOGOUT_GOAL.search(goal):
        return None

    candidates = [
        element
        for element in context.sanitized_schema.elements
        if element.isVisible
        and element.isInteractive
        and not element.isDisabled
        and element.tagName.lower() in {"a", "button", "input"}
    ]
    logout_control = next(
        (element for element in candidates if _LOGOUT_CONTROL.search(_element_action_text(element))),
        None,
    )
    if logout_control:
        return ActionObject(
            action_type="click",
            target=logout_control.id,
            reasoning="Click the clearly labeled logout control.",
        )

    profile_menu = next(
        (element for element in candidates if _PROFILE_MENU_CONTROL.search(_element_action_text(element))),
        None,
    )
    if profile_menu:
        return ActionObject(
            action_type="click",
            target=profile_menu.id,
            reasoning="Open the clearly labeled account menu to find logout.",
        )
    return None


def _action_targets_logout(action: ActionObject, context: ContextUpdatePayload) -> bool:
    if action.action_type != "click" or not action.target:
        return False
    element = next(
        (item for item in context.sanitized_schema.elements if item.id == action.target),
        None,
    )
    return bool(element and _LOGOUT_CONTROL.search(_element_action_text(element)))


def _login_fallback(goal: str, context: ContextUpdatePayload) -> Optional[ActionObject]:
    """Use an explicit sign-in or existing-account continuation control."""
    if not _LOGIN_GOAL.search(goal):
        return None
    candidates = [
        element
        for element in context.sanitized_schema.elements
        if element.isVisible
        and element.isInteractive
        and not element.isDisabled
        and element.tagName.lower() in {"a", "button", "input"}
    ]
    # Prefer the visible continuation for an already selected account, then
    # fall back to the page's explicit email/sign-in route.
    for pattern in (re.compile(r"^\s*continue\s+as\b", re.I), _LOGIN_CONTROL):
        candidate = next(
            (element for element in candidates if pattern.search(_element_action_text(element))),
            None,
        )
        if candidate:
            return ActionObject(
                action_type="click",
                target=candidate.id,
                reasoning="Use the visible sign-in control.",
            )
    return None


def _action_targets_login_control(action: ActionObject, context: ContextUpdatePayload) -> bool:
    if action.action_type != "click" or not action.target:
        return False
    element = next(
        (item for item in context.sanitized_schema.elements if item.id == action.target),
        None,
    )
    return bool(element and _LOGIN_CONTROL.search(_element_action_text(element)))


def _login_completion_action(
    goal: str,
    context: ContextUpdatePayload,
    previous_action_was_login: bool,
) -> Optional[ActionObject]:
    previous = context.previous_action_result
    if not (
        _LOGIN_GOAL.search(goal)
        and previous_action_was_login
        and previous
        and previous.success
        and previous.action_type == "click"
    ):
        return None

    page_host = urlsplit(context.sanitized_schema.url).hostname or ""
    page_path = urlsplit(context.sanitized_schema.url).path.lower()
    if not page_host.endswith("linkedin.com"):
        return None
    if re.search(r"/feed(?:/|$)", page_path) or any(
        _LOGOUT_CONTROL.search(_element_action_text(element))
        for element in context.sanitized_schema.elements
    ):
        return ActionObject(
            action_type="done",
            reasoning="LinkedIn shows the authenticated session.",
        )
    return None


def _search_completion_action(
    goal: str,
    context: ContextUpdatePayload,
    previous_action_was_search: bool,
) -> Optional[ActionObject]:
    """Finish a search-only goal after its search field was successfully submitted."""
    match = _SEARCH_GOAL.match(goal)
    previous = context.previous_action_result
    if (
        not match
        or not previous_action_was_search
        or not previous
        or not previous.success
        or previous.action_type != "type"
    ):
        return None

    # A goal that asks to open or visit a result still has work after searching.
    raw_query = match.group(1)
    if _SEARCH_GOAL_FOLLOW_UP.search(raw_query):
        return None
    query = raw_query.strip().strip(" \t\r\n\"'`.,!?;:")
    if not query:
        return None
    return ActionObject(
        action_type="done",
        reasoning="The requested search was submitted successfully.",
    )


def _first_link_completion_action(
    goal: str,
    context: ContextUpdatePayload,
    previous_action_was_external_link: bool,
) -> Optional[ActionObject]:
    previous = context.previous_action_result
    if (
        _FIRST_LINK_GOAL.search(goal)
        and previous_action_was_external_link
        and previous
        and previous.success
        and previous.action_type == "click"
    ):
        return ActionObject(
            action_type="done",
            reasoning="The requested first external link opened successfully.",
        )
    return None


def _logout_completion_action(
    goal: str,
    context: ContextUpdatePayload,
    previous_action_was_logout: bool,
) -> Optional[ActionObject]:
    previous = context.previous_action_result
    if (
        _LOGOUT_GOAL.search(goal)
        and previous_action_was_logout
        and previous
        and previous.success
        and previous.action_type == "click"
    ):
        return ActionObject(
            action_type="done",
            reasoning="The requested logout control was clicked successfully.",
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

            # Finish search-only goals when the previous search-field action
            # succeeded. Goals with an explicit follow-up remain with the VLM.
            action = _search_completion_action(
                session.goal,
                context,
                session.last_action_was_search,
            ) or _first_link_completion_action(
                session.goal,
                context,
                session.last_action_was_external_link,
            ) or _logout_completion_action(
                session.goal,
                context,
                session.last_action_was_logout,
            ) or _login_completion_action(
                session.goal,
                context,
                session.last_action_was_login,
            )
            if action:
                slog.info(
                    module="ORCHESTRATOR",
                    event="TASK_COMPLETED_BY_RULE",
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

            # Follow the visible logout path deterministically: open the account
            # menu when needed, then click its explicit logout control. A model
            # guess at either step can otherwise fail before logout is reached.
            if _LOGOUT_GOAL.search(session.goal):
                logout_action = _logout_fallback(session.goal, context)
                if logout_action:
                    action = logout_action
                    slog.info(
                        module="ORCHESTRATOR",
                        event=(
                            "VISIBLE_LOGOUT_CONTROL_SELECTED"
                            if _action_targets_logout(logout_action, context)
                            else "VISIBLE_ACCOUNT_MENU_SELECTED_FOR_LOGOUT"
                        ),
                        session_id=session.session_id,
                        step_number=context.step_number,
                        target_element_id=logout_action.target,
                    )

            if action.action_type == "fail":
                fallback = (
                    _search_fallback(session.goal, context)
                    or _logout_fallback(session.goal, context)
                    or _login_fallback(session.goal, context)
                )
                if fallback:
                    action = fallback
                    slog.info(
                        module="ORCHESTRATOR",
                        event="TASK_ACTION_FALLBACK_APPLIED",
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

            session.last_action_was_search = _action_targets_search_field(action, context)
            session.last_action_was_external_link = _action_targets_external_link(action, context)
            session.last_action_was_logout = _action_targets_logout(action, context)
            session.last_action_was_login = _action_targets_login_control(action, context)

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
