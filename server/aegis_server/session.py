"""
session.py — Session state machine and manager (E2)
====================================================
E2 additions:
 - Full SessionState enum (INIT, ACTIVE, WAITING_CONTEXT, INFERRING, DISCONNECTED_GRACE, TERMINATED)
 - ActionHistoryItem dataclass for FIFO window (max 5 items)
 - Privacy: Redacts `[NEEDS_LOCAL_INPUT]` to `[LOCAL_INPUT_PROVIDED]`
 - Enforces valid state transitions
"""

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Deque, Dict, List, Optional
import uuid

from aegis_server.protocol import ClientMetadata, ContextUpdatePayload, ActionObject


class SessionState(str, Enum):
    INIT = "INIT"
    ACTIVE = "ACTIVE"
    WAITING_CONTEXT = "WAITING_CONTEXT"
    INFERRING = "INFERRING"
    DISCONNECTED_GRACE = "DISCONNECTED_GRACE"
    TERMINATED = "TERMINATED"


class StateTransitionError(Exception):
    """Raised when an invalid state transition is attempted."""
    pass


@dataclass
class ActionHistoryItem:
    step_number: int
    action_type: str
    target: Optional[str]
    value: Optional[str]
    reasoning: Optional[str]
    execution_success: Optional[bool] = None
    error_code: Optional[str] = None


class Session:
    def __init__(
        self,
        session_id: str,
        goal: str,
        client_metadata: ClientMetadata,
        max_steps: int = 30,
    ) -> None:
        self.session_id = session_id
        self._goal = goal  # In-memory only; never logged
        self.client_metadata = client_metadata
        self.max_steps = max_steps
        self.current_step = 1
        self.state: SessionState = SessionState.INIT
        self.created_at: str = datetime.now(timezone.utc).isoformat()
        self.disconnect_time: Optional[str] = None

        # FIFO queue for last 5 actions
        self.action_history: Deque[ActionHistoryItem] = deque(maxlen=5)

        # Latest context buffer
        self.latest_context: Optional[ContextUpdatePayload] = None
        
        # Move to ACTIVE after creation
        self._transition(SessionState.ACTIVE)

    def _transition(self, new_state: SessionState) -> None:
        if self.state == new_state:
            return  # Ignore self-transitions

        valid_transitions = {
            SessionState.INIT: [SessionState.ACTIVE],
            SessionState.ACTIVE: [SessionState.WAITING_CONTEXT, SessionState.DISCONNECTED_GRACE, SessionState.TERMINATED],
            SessionState.WAITING_CONTEXT: [SessionState.INFERRING, SessionState.DISCONNECTED_GRACE, SessionState.TERMINATED],
            SessionState.INFERRING: [SessionState.WAITING_CONTEXT, SessionState.DISCONNECTED_GRACE, SessionState.TERMINATED],
            SessionState.DISCONNECTED_GRACE: [SessionState.ACTIVE, SessionState.WAITING_CONTEXT, SessionState.TERMINATED],
            SessionState.TERMINATED: [],
        }
        
        if new_state not in valid_transitions[self.state]:
            raise StateTransitionError(
                f"Invalid transition from {self.state} to {new_state}"
            )
        
        self.state = new_state

    @property
    def goal(self) -> str:
        return self._goal

    @property
    def is_active(self) -> bool:
        return self.state not in (SessionState.TERMINATED, SessionState.DISCONNECTED_GRACE)

    def set_waiting_context(self) -> None:
        self._transition(SessionState.WAITING_CONTEXT)
        
    def set_inferring(self) -> None:
        self._transition(SessionState.INFERRING)

    def update_context(self, context: ContextUpdatePayload) -> None:
        self.latest_context = context

    def record_action(self, action: ActionObject) -> None:
        # Privacy: redact local input value
        safe_value = action.value
        if safe_value == "[NEEDS_LOCAL_INPUT]":
            safe_value = "[LOCAL_INPUT_PROVIDED]"

        item = ActionHistoryItem(
            step_number=self.current_step,
            action_type=action.action_type,
            target=action.target,
            value=safe_value,
            reasoning=action.reasoning,
        )
        self.action_history.append(item)
        self.current_step += 1

    def record_step(self, context: ContextUpdatePayload, action: ActionObject) -> None:
        """Backwards compatibility for Phase A orchestrator."""
        self.update_context(context)
        self.record_action(action)
        
    def update_action_result(self, step_number: int, success: bool, error_code: Optional[str] = None) -> None:
        for item in self.action_history:
            if item.step_number == step_number:
                item.execution_success = success
                item.error_code = error_code
                break

    def mark_disconnected(self) -> None:
        self._transition(SessionState.DISCONNECTED_GRACE)
        self.disconnect_time = datetime.now(timezone.utc).isoformat()

    def resume(self) -> None:
        self._transition(SessionState.WAITING_CONTEXT)
        self.disconnect_time = None

    def terminate(self) -> None:
        self._transition(SessionState.TERMINATED)
        self._goal = ""
        self.action_history.clear()
        self.latest_context = None


class SessionManager:
    def __init__(self) -> None:
        self._sessions: Dict[str, Session] = {}

    def create_session(
        self,
        goal: str,
        client_metadata: ClientMetadata,
        server_max_steps: int = 30,
    ) -> Session:
        session_id = str(uuid.uuid4())
        max_steps = min(client_metadata.max_steps, server_max_steps)
        session = Session(session_id, goal, client_metadata, max_steps=max_steps)
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[Session]:
        return self._sessions.get(session_id)

    def remove_session(self, session_id: str) -> Optional[Session]:
        return self._sessions.pop(session_id, None)

    def cleanup_terminated(self) -> None:
        terminated = [
            sid for sid, s in self._sessions.items()
            if s.state == SessionState.TERMINATED
        ]
        for sid in terminated:
            del self._sessions[sid]

    def cleanup_stale_sessions(self, grace_period_seconds: int = 60) -> None:
        now = datetime.now(timezone.utc)
        stale = []
        for sid, s in self._sessions.items():
            if s.state == SessionState.DISCONNECTED_GRACE and s.disconnect_time:
                dt = datetime.fromisoformat(s.disconnect_time)
                if (now - dt).total_seconds() > grace_period_seconds:
                    stale.append(sid)
        
        for sid in stale:
            self._sessions[sid].terminate()
            del self._sessions[sid]


session_manager = SessionManager()
