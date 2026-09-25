"""
__init__.py — VLM Provider Factory
==================================
Exports VLMProvider and a factory function to retrieve the configured provider.
Configuration via VLM_PROVIDER env var: "mock" (default), "ollama", "cloud".
"""

import os

from aegis_server.providers.base import VLMProvider
from aegis_server.providers.mock import mock_vlm_provider
from aegis_server.providers.ollama import ollama_vlm_provider
from aegis_server.providers.cloud import cloud_provider
from aegis_server.slog import slog


def get_configured_provider() -> VLMProvider:
    """
    Returns the VLM provider configured via the VLM_PROVIDER environment variable.
    Defaults to 'mock' if not set or invalid.
    """
    provider_name = os.environ.get("VLM_PROVIDER", "mock").lower().strip()

    if provider_name == "ollama":
        slog.info(module="PROVIDER_FACTORY", event="PROVIDER_SELECTED", provider="ollama")
        return ollama_vlm_provider
    elif provider_name == "cloud":
        if cloud_provider is None:
            slog.error(module="PROVIDER_FACTORY", event="CLOUD_PROVIDER_INIT_FAILED", reason="Missing VLM_API_KEY")
            return mock_vlm_provider
        slog.info(module="PROVIDER_FACTORY", event="PROVIDER_SELECTED", provider="cloud")
        return cloud_provider
    else:
        # Default fallback to mock
        slog.info(module="PROVIDER_FACTORY", event="PROVIDER_SELECTED", provider="mock")
        return mock_vlm_provider

__all__ = ["VLMProvider", "get_configured_provider"]
