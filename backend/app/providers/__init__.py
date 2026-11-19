"""Model providers. Pick one with the LLM_PROVIDER environment variable."""
from __future__ import annotations

from ..config import Settings
from .base import Completion, LLMProvider, ProviderError

PROVIDERS = ("anthropic", "gemini")


def get_provider(settings: Settings) -> LLMProvider:
    if settings.llm_provider == "anthropic":
        from .anthropic import AnthropicProvider
        return AnthropicProvider(settings.llm_model, settings.llm_effort,
                                 settings.anthropic_fallbacks)
    if settings.llm_provider == "gemini":
        from .gemini import GeminiProvider
        return GeminiProvider(settings.llm_model)
    raise ProviderError(
        f'Unknown LLM_PROVIDER "{settings.llm_provider}". Use one of: {", ".join(PROVIDERS)}.',
        status=503)


__all__ = ["Completion", "LLMProvider", "ProviderError", "PROVIDERS", "get_provider"]
