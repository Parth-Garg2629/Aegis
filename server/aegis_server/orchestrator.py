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
    r"\b(?:(?:go|open|visit|click|navigate)\b.*\b(?:first|top)\b.*\b(?:link|result|url|website|site|page)\b|(?:first|top)\s+(?:link|result|url|website|site|page)\b)",
    re.IGNORECASE,
)
_OPEN_WEBSITE_GOAL = re.compile(
    r"^\s*(?:please\s+)?(?:open|go\s+to|visit|navigate\s+to)\s+(?:the\s+)?"
    r"(?P<site>https?://[^\s<>\"'`]+|(?:www\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?)"
    r"(?:\s+(?:website|site|homepage))?[.!?]*\s*$",
    re.IGNORECASE,
)
_KNOWN_WEBSITE_DOMAINS = {
    "linkedin": "linkedin.com",
    "google": "google.com",
    "wikipedia": "wikipedia.org",
    "amazon": "amazon.com",
    "facebook": "facebook.com",
    "instagram": "instagram.com",
    "youtube": "youtube.com",
    "github": "github.com",
    "reddit": "reddit.com",
}
_LOGOUT_GOAL = re.compile(r"\b(log\s*out|logout|sign\s*out|signout|log\s*off)\b", re.I)
_LOGOUT_CONTROL = re.compile(r"\b(log\s*out|logout|sign\s*out|signout|log\s*off)\b", re.I)
_PROFILE_MENU_CONTROL = re.compile(r"\b(profile|account|user\s+menu|your\s+account|my\s+account|me)\b", re.I)
_LOGIN_GOAL = re.compile(r"\b(log\s*in|login|sign\s*in|authenticate)\b", re.I)
_LOGIN_CONTROL = re.compile(r"\b(sign\s*in|log\s*in|continue\s+(?:as|with)|sign\s*in\s+with|login\s+with|use\s+another\s+account)\b", re.I)


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

    # Some sites, including Wikipedia layouts with collapsed search, expose a
    # launcher first and reveal the text field only after it is opened.
    search_launcher = next(
        (
            element
            for element in context.sanitized_schema.elements
            if element.isVisible
            and element.isInteractive
            and not element.isDisabled
            and element.tagName.lower() in {"button", "a"}
            and re.search(r"\bsearch\b", _element_action_text(element), re.I)
        ),
        None,
    )
    if search_launcher:
        return ActionObject(
            action_type="click",
            target=search_launcher.id,
            reasoning="Open the visible search control to reveal its search field.",
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
            element.id,
        )
        if value
    ).lower()
    return (
        str(element.type or attrs.get("type", "")).lower() == "search"
        or str(attrs.get("name", "")).lower() in {"q", "query", "search"}
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


def _website_navigation_action(goal: str, context: ContextUpdatePayload) -> Optional[ActionObject]:
    match = _OPEN_WEBSITE_GOAL.search(goal)
    if not match:
        return None

    site = match.group("site").rstrip(".,!?;:").strip().lower()
    if site.startswith(("http://", "https://")):
        destination = urlsplit(site)
        if (
            destination.scheme not in {"http", "https"}
            or not destination.hostname
            or destination.username is not None
            or destination.password is not None
        ):
            return None
        host = destination.hostname.lower()
        navigation_url = site
    else:
        site_without_www = site[4:] if site.startswith("www.") else site
        host = _KNOWN_WEBSITE_DOMAINS.get(
            site_without_www,
            site if "." in site else f"{site}.com",
        )
        navigation_url = f"https://{host}/"

    current_host = urlsplit(context.sanitized_schema.url).hostname or ""
    if current_host.lower() == host or current_host.lower().endswith(f".{host}"):
        return ActionObject(action_type="done", reasoning="The requested website is already open.")
    return ActionObject(
        action_type="navigate",
        value=navigation_url,
        reasoning="Open the website explicitly requested by the user.",
    )


def _linkedin_logout_navigation_action(
    goal: str,
    context: ContextUpdatePayload,
    navigation_started: bool = False,
) -> Optional[ActionObject]:
    if not _LOGOUT_GOAL.search(goal):
        return None
    page_url = urlsplit(context.sanitized_schema.url)
    host = (page_url.hostname or "").lower()
    if not (host == "linkedin.com" or host.endswith(".linkedin.com")):
        return None
    if _page_shows_logged_out_state(context):
        previous = context.previous_action_result
        if previous and previous.success and previous.action_type == "navigate":
            return ActionObject(action_type="done", reasoning="LinkedIn is showing its signed-out page.")
    previous = context.previous_action_result
    if (
        navigation_started
        and previous
        and previous.success
        and previous.action_type == "navigate"
    ):
        return ActionObject(
            action_type="fail",
            reasoning="LinkedIn did not show a signed-out page after its sign-out route loaded.",
        )
    # LinkedIn's own sign-out control routes through /m/logout/. This fallback
    # is used only for an explicit logout request on a LinkedIn page.
    return ActionObject(
        action_type="navigate",
        value=f"https://{host}/m/logout/",
        reasoning="Open LinkedIn's sign-out route for the requested logout.",
    )


def _first_link_action(
    goal: str,
    context: ContextUpdatePayload,
    previous_search_succeeded: bool,
    wait_count: int,
) -> Optional[ActionObject]:
    if not (_FIRST_LINK_GOAL.search(goal) and _SEARCH_GOAL.match(goal) and previous_search_succeeded):
        return None
    for element in context.sanitized_schema.elements:
        if element.tagName.lower() != "a" or not element.isVisible or not element.isInteractive:
            continue
        href = str((element.attributes or {}).get("href", ""))
        if not href.startswith(("http://", "https://")):
            continue
        host = (urlsplit(href).hostname or "").lower()
        page_host = (urlsplit(context.sanitized_schema.url).hostname or "").lower()
        search_engine_hosts = (
            "google.com",
            "bing.com",
            "duckduckgo.com",
            "search.yahoo.com",
        )
        is_search_engine_link = any(
            host == engine or host.endswith(f".{engine}")
            for engine in search_engine_hosts
        )
        if (
            not host
            or host == page_host
            or is_search_engine_link
            or not _element_action_text(element).strip()
        ):
            continue
        return ActionObject(
            action_type="click",
            target=element.id,
            reasoning="Open the first visible external search result as requested.",
        )
    if wait_count == 0:
        return ActionObject(
            action_type="wait",
            value="1500",
            reasoning="Wait briefly for the search results page to finish loading.",
        )
    return ActionObject(
        action_type="fail",
        reasoning="Search results did not expose a visible first website link.",
    )


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


def _logout_fallback(
    goal: str,
    context: ContextUpdatePayload,
    allow_profile_menu: bool = True,
) -> Optional[ActionObject]:
    """Choose only a clearly labeled logout control or profile menu for logout goals."""
    if not _LOGOUT_GOAL.search(goal):
        return None

    candidates = [
        element
        for element in context.sanitized_schema.elements
        if element.isVisible
        and element.isInteractive
        and not element.isDisabled
        and (
            element.tagName.lower() in {"a", "button", "input"}
            or element.tagName.lower() == "li"
            or element.role in {"menuitem", "menuitemcheckbox", "menuitemradio"}
        )
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

    if not allow_profile_menu:
        return None

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


def _action_targets_profile_menu(action: ActionObject, context: ContextUpdatePayload) -> bool:
    if action.action_type != "click" or not action.target:
        return False
    element = next(
        (item for item in context.sanitized_schema.elements if item.id == action.target),
        None,
    )
    return bool(element and _PROFILE_MENU_CONTROL.search(_element_action_text(element)))


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


def _google_account_chooser_action(
    goal: str,
    context: ContextUpdatePayload,
) -> Optional[ActionObject]:
    """Select only an unambiguous signed-out account on Google's chooser page."""
    if not _LOGIN_GOAL.search(goal):
        return None
    page_url = urlsplit(context.sanitized_schema.url)
    if (page_url.hostname or "").lower() != "accounts.google.com" or not re.search(
        r"/signin/accountchooser(?:/|$)", page_url.path, re.I
    ):
        return None

    candidates = [
        element
        for element in context.sanitized_schema.elements
        if element.isVisible
        and element.isInteractive
        and not element.isDisabled
        and (
            element.tagName.lower() in {"a", "button", "div", "li"}
            or element.role in {"button", "link", "menuitem"}
        )
    ]
    signed_out_accounts = [
        element for element in candidates
        if re.search(r"\bsigned\s+out\b", _element_action_text(element), re.I)
    ]
    if len(signed_out_accounts) == 1:
        return ActionObject(
            action_type="click",
            target=signed_out_accounts[0].id,
            reasoning="Continue with the single signed-out account.",
        )

    # If account selection is ambiguous or unavailable, proceed to the
    # explicit alternate-account form so the user can provide their choice.
    alternate_accounts = [
        element for element in candidates
        if re.search(r"\buse\s+another\s+account\b", _element_action_text(element), re.I)
    ]
    if len(alternate_accounts) == 1:
        return ActionObject(
            action_type="click",
            target=alternate_accounts[0].id,
            reasoning="Open the account sign-in form for user input.",
        )
    return None


def _login_credential_input_action(
    goal: str,
    context: ContextUpdatePayload,
) -> Optional[ActionObject]:
    """Ask for credentials through the extension's local-input path."""
    if not _LOGIN_GOAL.search(goal):
        return None

    fields = []
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
                element.label,
                element.text,
                attrs.get("type"),
                attrs.get("autocomplete"),
                attrs.get("aria-label"),
                attrs.get("placeholder"),
                attrs.get("name"),
            )
            if value
        ).lower()
        if element.value and str(element.value).startswith("[REDACTED_"):
            continue

        if re.search(r"password|current-password|new-password", hints):
            priority = 2
        elif re.search(r"email|username|user\s*name|identifier", hints):
            priority = 1
        elif re.search(r"one[- ]?time|verification|security code|authenticator|\botp\b", hints):
            priority = 3
        else:
            continue
        fields.append((priority, element))

    if not fields:
        return None
    _priority, field = min(fields, key=lambda item: item[0])
    return ActionObject(
        action_type="type",
        target=field.id,
        value="[NEEDS_LOCAL_INPUT]",
        reasoning="Request the required sign-in value locally.",
    )


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
    login_flow_started: bool = False,
) -> Optional[ActionObject]:
    previous = context.previous_action_result
    if not (
        _LOGIN_GOAL.search(goal)
        and (previous_action_was_login or login_flow_started)
        and previous
        and previous.success
        and previous.action_type in {"click", "type", "navigate"}
    ):
        return None

    if _is_authenticated_context(context):
        return ActionObject(
            action_type="done",
            reasoning="The page shows an authenticated session.",
        )
    return None


def _is_authenticated_context(context: ContextUpdatePayload) -> bool:
    page_url = urlsplit(context.sanitized_schema.url)
    elements = [
        element for element in context.sanitized_schema.elements
        if element.isVisible and element.isInteractive
    ]
    if any(_LOGOUT_CONTROL.search(_element_action_text(element)) for element in elements):
        return True
    if re.search(r"/(?:feed|home|dashboard)(?:/|$)", page_url.path, re.I):
        return True
    account_controls = [
        element for element in elements
        if _PROFILE_MENU_CONTROL.search(_element_action_text(element))
    ]
    authenticated_nav = re.compile(
        r"\b(messages?|messaging|notifications?|dashboard|my\s+account|my\s+profile|"
        r"workspace|projects|settings|feed|home)\b",
        re.I,
    )
    has_authenticated_nav = any(
        authenticated_nav.search(_element_action_text(element)) for element in elements
    )
    has_password_field = any(
        element.tagName.lower() == "input"
        and (element.type or (element.attributes or {}).get("type", "")).lower() == "password"
        for element in elements
    )
    has_sign_in_control = any(
        re.search(r"\b(sign\s*in|log\s*in|login)\b", _element_action_text(element), re.I)
        for element in elements
    )
    return bool(
        account_controls
        and has_authenticated_nav
        and not has_password_field
        and not has_sign_in_control
    )


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
        and previous
        and previous.success
        and previous.action_type in {"click", "navigate"}
        and (previous_action_was_logout or previous.action_type == "navigate")
        and _page_shows_logged_out_state(context)
    ):
        return ActionObject(
            action_type="done",
            reasoning="The requested logout control was clicked successfully.",
        )
    return None


def _logout_already_complete_action(
    goal: str,
    context: ContextUpdatePayload,
) -> Optional[ActionObject]:
    """Treat a positively identified signed-out page as an idempotent logout."""
    if _LOGOUT_GOAL.search(goal) and _page_shows_logged_out_state(context):
        return ActionObject(
            action_type="done",
            reasoning="The current page already shows a signed-out state.",
        )
    return None


def _page_shows_logged_out_state(context: ContextUpdatePayload) -> bool:
    """Recognize a successful logout redirect even if the site's control label was opaque."""
    schema = context.sanitized_schema
    page_url = urlsplit(schema.url)
    path = page_url.path
    if re.search(r"/(?:log[-_]?out|sign[-_]?out)(?:/|$)", path, re.I):
        return True

    visible_controls = [
        element
        for element in schema.elements
        if element.isVisible and element.isInteractive and not element.isDisabled
    ]
    has_sign_in_control = any(
        re.search(r"\b(sign\s*in|log\s*in|login)\b", _element_action_text(element), re.I)
        for element in visible_controls
    )
    has_sign_out_control = any(
        _LOGOUT_CONTROL.search(_element_action_text(element))
        for element in visible_controls
    )
    has_signed_out_marker = any(
        re.search(r"\bsigned\s+out\b", _element_action_text(element), re.I)
        for element in visible_controls
    )
    has_password_field = any(
        element.tagName.lower() == "input"
        and (element.type or (element.attributes or {}).get("type", "")).lower() == "password"
        for element in visible_controls
    )
    if (
        (page_url.hostname or "").lower() == "accounts.google.com"
        and re.search(r"/signin/accountchooser(?:/|$)", path, re.I)
        and not has_sign_out_control
    ):
        return True
    if has_signed_out_marker and not has_sign_out_control:
        return True
    return has_sign_in_control and not has_sign_out_control and (has_password_field or bool(visible_controls))


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

            # The action result arrives with the next context. Remember a
            # successful first click in a logout flow as an open-menu attempt,
            # even when the site's menu button is labeled only "Me" or an icon.
            previous_result = context.previous_action_result
            if (
                _LOGOUT_GOAL.search(session.goal)
                and session.logout_menu_target_id
                and not session.last_action_was_logout
                and previous_result
                and previous_result.success
                and previous_result.action_type == "click"
                and previous_result.target_element_id == session.logout_menu_target_id
            ):
                session.logout_menu_open = True

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
            ) or _first_link_action(
                session.goal,
                context,
                session.pending_first_link
                and bool(context.previous_action_result and context.previous_action_result.success),
                session.first_link_wait_count,
            ) or _website_navigation_action(
                session.goal,
                context,
            ) or _logout_completion_action(
                session.goal,
                context,
                session.last_action_was_logout,
            ) or _logout_already_complete_action(
                session.goal,
                context,
            ) or _linkedin_logout_navigation_action(
                session.goal,
                context,
                session.logout_navigation_started,
            ) or _login_completion_action(
                session.goal,
                context,
                session.last_action_was_login,
                session.login_flow_started,
            ) or _google_account_chooser_action(
                session.goal,
                context,
            ) or _login_credential_input_action(
                session.goal,
                context,
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
            current_host = (urlsplit(context.sanitized_schema.url).hostname or "").lower()
            on_linkedin = current_host == "linkedin.com" or current_host.endswith(".linkedin.com")
            if _LOGOUT_GOAL.search(session.goal) and not on_linkedin:
                menu_was_open_after_success = bool(
                    session.logout_menu_open
                    and context.previous_action_result
                    and context.previous_action_result.success
                )
                logout_action = _logout_fallback(
                    session.goal,
                    context,
                    allow_profile_menu=not (
                        session.logout_menu_open
                        and context.previous_action_result
                        and context.previous_action_result.success
                    ),
                )
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

                # Never toggle the same account menu closed by clicking it a
                # second time while looking for a logout item. Let the refreshed
                # DOM/screenshot reach the model instead.
                if (
                    menu_was_open_after_success
                    and (
                        action.action_type == "fail"
                        or (
                            action.action_type == "click"
                            and action.target == session.logout_menu_target_id
                            and not _action_targets_logout(action, context)
                        )
                    )
                ):
                    if session.logout_menu_wait_count == 0:
                        session.logout_menu_wait_count += 1
                        action = ActionObject(
                            action_type="wait",
                            value="1000",
                            reasoning="Wait for the opened account menu to finish rendering before looking for sign out.",
                        )
                    else:
                        action = ActionObject(action_type="fail", reasoning=(
                            "The account menu opened, but no logout control appeared after waiting for it to render. "
                            "The page snapshot does not expose a safe sign-out target."
                        ))

            if action.action_type == "fail":
                fallback = (
                    _search_fallback(session.goal, context)
                    or _logout_fallback(
                        session.goal,
                        context,
                        allow_profile_menu=not (
                            session.logout_menu_open
                            and context.previous_action_result
                            and context.previous_action_result.success
                        )
                        if _LOGOUT_GOAL.search(session.goal)
                        else True,
                    )
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
            if session.last_action_was_search and _FIRST_LINK_GOAL.search(session.goal):
                session.pending_first_link = True
                session.first_link_wait_count = 0
            session.last_action_was_external_link = _action_targets_external_link(action, context)
            if session.last_action_was_external_link:
                session.pending_first_link = False
                session.first_link_wait_count = 0
            elif session.pending_first_link and action.action_type == "wait":
                session.first_link_wait_count += 1
            if action.action_type == "navigate":
                session.expected_navigation_host = urlsplit(action.value or "").hostname
            session.last_action_was_logout = _action_targets_logout(action, context)
            session.last_action_was_profile_menu = _action_targets_profile_menu(action, context)
            if session.last_action_was_profile_menu:
                session.logout_menu_open = True
            if _LOGOUT_GOAL.search(session.goal) and action.action_type == "click":
                if session.last_action_was_logout:
                    session.logout_menu_open = False
                    session.logout_menu_target_id = None
                    session.logout_menu_wait_count = 0
                else:
                    session.logout_menu_target_id = action.target
                    session.logout_menu_wait_count = 0
            elif session.last_action_was_logout:
                session.logout_menu_open = False
            session.last_action_was_login = _action_targets_login_control(action, context)
            if _LOGIN_GOAL.search(session.goal) and action.action_type in {"click", "type", "navigate"}:
                session.login_flow_started = True
            if (
                _LOGOUT_GOAL.search(session.goal)
                and action.action_type == "navigate"
                and on_linkedin
            ):
                session.logout_navigation_started = True

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
