"""
cloud.py — Cloud VLM Provider (E3 Stub)
=======================================
Stub for future cloud provider integrations (OpenAI compatible).
Key is expected via VLM_API_KEY environment variable.
"""

import os
from typing import List, Optional

from aegis_server.protocol import ActionObject, ContextUpdatePayload
from aegis_server.providers.base import VLMProvider
from aegis_server.session import ActionHistoryItem


class CloudProvider(VLMProvider):
    def __init__(self):
        self.api_key = os.environ.get("VLM_API_KEY", "")
        if not self.api_key:
            raise ValueError("VLM_API_KEY environment variable must be set for cloud provider.")

    def generate_action(
        self,
        context: ContextUpdatePayload,
        goal: str,
        action_history: Optional[List[ActionHistoryItem]] = None,
    ) -> ActionObject:
        
        raise NotImplementedError("Cloud provider is not yet fully implemented.")


cloud_provider = None
try:
    cloud_provider = CloudProvider()
except ValueError:
    pass
