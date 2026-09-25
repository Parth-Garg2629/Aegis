"""
base.py — VLM Provider Abstract Base Class
===========================================
Defines the formal interface for all VLM providers.
Providers receive ONLY sanitized context and must return an ActionObject.
"""

from abc import ABC, abstractmethod
from typing import List, Optional

from aegis_server.protocol import ContextUpdatePayload, ActionObject
from aegis_server.session import ActionHistoryItem


class VLMProvider(ABC):
    """
    Abstract base class for all VLM providers in AEGIS.
    All providers must implement generate_action.
    """

    @abstractmethod
    def generate_action(
        self,
        context: ContextUpdatePayload,
        goal: str,
        action_history: Optional[List[ActionHistoryItem]] = None,
    ) -> ActionObject:
        """
        Generate the next action based on the current context, goal, and history.
        
        Args:
            context: The sanitized context payload (schema, screenshot).
            goal: The user's goal.
            action_history: The history of the last N actions.
            
        Returns:
            ActionObject: The chosen action.
        """
        pass
