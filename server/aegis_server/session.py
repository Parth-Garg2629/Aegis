"""
AEGIS Session Manager
Source of Truth: docs/API_SPEC.md §3, docs/DATABASE_SCHEMA.md §6
Manages active in-memory browser agent sessions during execution.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional
import uuid

from aegis_server.protocol import ClientMetadata, ContextUpdatePayload, ActionObject


class Session:
    def __init__(self, session_id: str, goal: str, client_metadata: ClientMetadata, max_steps: int = 30):
        self.session_id = session_id
        self.goal = goal
        self.client_metadata = client_metadata
        self.max_steps = max_steps
        self.current_step = 1
        self.is_active = True
        self.created_at = datetime.now(timezone.utc).isoformat()
        self.context_history: List[ContextUpdatePayload] = []
        self.action_history: List[ActionObject] = []

    def record_step(self, context: ContextUpdatePayload, action: ActionObject) -> None:
        self.context_history.append(context)
        self.action_history.append(action)
        self.current_step = context.step_number + 1

    def terminate(self) -> None:
        self.is_active = False


class SessionManager:
    def __init__(self):
        self._sessions: Dict[str, Session] = {}

    def create_session(self, goal: str, client_metadata: ClientMetadata, server_max_steps: int = 30) -> Session:
        session_id = str(uuid.uuid4())
        max_steps = min(client_metadata.max_steps, server_max_steps)
        session = Session(session_id, goal, client_metadata, max_steps=max_steps)
        self._sessions[session_id] = session
        return session

    def get_session(self, session_id: str) -> Optional[Session]:
        return self._sessions.get(session_id)

    def remove_session(self, session_id: str) -> Optional[Session]:
        return self._sessions.pop(session_id, None)


session_manager = SessionManager()
