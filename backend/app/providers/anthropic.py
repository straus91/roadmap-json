"""Anthropic provider (default): Claude Fable 5.2 reading the PDF natively.

Notes on the request shape, all specific to current Claude models:
* The PDF goes in as a `document` block, so tables and figures are read as the authors
  laid them out — no client-side pdf.js, no separate text extractor.
* Both the system prompt (schema + rules) and the PDF carry a cache breakpoint. The repair
  retry re-sends the same prefix, so it is billed at the cached-read rate.
* Fable 5.2 always thinks; `thinking`, `temperature` and forced tool choice are not
  accepted, so depth is controlled with `output_config.effort` only.
* Streaming is used so long extractions cannot hit an HTTP timeout.
* `fallbacks="default"` lets the API re-run a request on another Claude model if Fable's
  safety classifiers decline it (rare for radiology papers, but otherwise a hard failure).
"""
from __future__ import annotations

import base64
import os

import anthropic  # the installed SDK (absolute import; not this module)

from .base import Completion, ProviderError

FALLBACK_BETA = "server-side-fallback-2026-07-01"
MAX_OUTPUT_TOKENS = 32000


class AnthropicProvider:
    name = "anthropic"
    reads_pdf = True

    def __init__(self, model: str, effort: str = "medium", fallbacks: str = "default"):
        self.model = model
        self.effort = effort
        self.fallbacks = fallbacks
        self._client: anthropic.Anthropic | None = None

    def is_configured(self) -> bool:
        return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))

    def _get_client(self) -> anthropic.Anthropic:
        if not self.is_configured():
            raise ProviderError(
                "No Anthropic API key is configured. Add ANTHROPIC_API_KEY to the .env file "
                "and restart.", status=503)
        if self._client is None:
            self._client = anthropic.Anthropic()  # reads the key from the environment
        return self._client

    def complete(self, system: str, user: str, pdf: bytes | None = None) -> Completion:
        client = self._get_client()
        content: list[dict] = []
        if pdf is not None:
            content.append({
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf",
                           "data": base64.standard_b64encode(pdf).decode("ascii")},
                "cache_control": {"type": "ephemeral"},
            })
        content.append({"type": "text", "text": user})

        request = dict(
            model=self.model,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": content}],
            output_config={"effort": self.effort},
        )
        try:
            if self.fallbacks == "default":
                stream = client.beta.messages.stream(
                    betas=[FALLBACK_BETA], fallbacks="default", **request)
            else:
                stream = client.messages.stream(**request)
            with stream as events:
                message = events.get_final_message()
        except anthropic.AuthenticationError:
            raise ProviderError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY "
                                "in the .env file.", status=503)
        except anthropic.PermissionDeniedError as e:
            raise ProviderError(f"This Anthropic API key may not use {self.model}: {e.message}",
                                status=503)
        except anthropic.NotFoundError:
            raise ProviderError(f'Anthropic does not know the model "{self.model}". '
                                "Check LLM_MODEL in the .env file.", status=503)
        except anthropic.RateLimitError:
            raise ProviderError("Anthropic is rate-limiting this key. Wait a minute and try "
                                "again.", status=429)
        except anthropic.BadRequestError as e:
            raise ProviderError(f"Anthropic rejected the request: {e.message}", status=422)
        except anthropic.APIStatusError as e:
            raise ProviderError(f"Anthropic returned an error ({e.status_code}). Try again "
                                "shortly.", status=502)
        except anthropic.APIConnectionError:
            raise ProviderError("Could not reach Anthropic. Check the server's internet "
                                "connection.", status=502)

        if message.stop_reason == "refusal":
            raise ProviderError("The model declined to process this document.", status=422)
        if message.stop_reason == "max_tokens":
            raise ProviderError("The model's answer was cut off before the card was complete. "
                                "Try again, or use a shorter document.", status=502)

        text = "".join(block.text for block in message.content if block.type == "text")
        usage = message.usage
        return Completion(
            text=text,
            model=message.model,  # the model that actually answered (differs after a fallback)
            usage={
                "input_tokens": usage.input_tokens or 0,
                "output_tokens": usage.output_tokens or 0,
                "cache_read_input_tokens": getattr(usage, "cache_read_input_tokens", 0) or 0,
                "cache_creation_input_tokens": getattr(usage, "cache_creation_input_tokens", 0) or 0,
            },
        )
