import os
from typing import Optional, Tuple
from aegis_server.protocol import ActionObject, ContextUpdatePayload
from aegis_server.providers.mock import MockVLMProvider, mock_vlm_provider
from aegis_server.providers.ollama import ollama_vlm_provider
from aegis_server.session import Session
from aegis_server.slog import slog


class AgentOrchestrator:
    def __init__(self, provider: Optional[MockVLMProvider] = None):
        if provider is None:
            provider_type = os.getenv("VLM_PROVIDER", "mock").lower()
            if provider_type == "ollama":
                self.provider = ollama_vlm_provider
            else:
                self.provider = mock_vlm_provider
        else:
            self.provider = provider

    def decide_next_action(self, session: Session, context: ContextUpdatePayload) -> Tuple[ActionObject, int]:
        slog.info(
            module="ORCHESTRATOR",
            event="PROCESSING_CONTEXT_UPDATE",
            session_id=session.session_id,
            step_number=context.step_number,
        )

        action = self.provider.generate_action(context, goal=session.goal)

        session.record_step(context, action)

        slog.info(
            module="ORCHESTRATOR",
            event="ACTION_DECIDED",
            session_id=session.session_id,
            step_number=context.step_number,
            action_type=action.action_type,
        )

        return action, context.step_number


orchestrator = AgentOrchestrator()
