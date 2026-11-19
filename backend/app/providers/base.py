"""The one interface every model provider implements.

A provider turns (system prompt, user prompt, optional PDF) into text. It knows nothing
about cards or schemas: parsing, normalising, validating and repairing happen once, in
app/extraction.py, for every provider alike. Adding a provider means adding one file with
one class and registering it in providers/__init__.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class Completion:
    text: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)


class ProviderError(Exception):
    """A failure the user should see, with the HTTP status the API should answer with."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


class LLMProvider(Protocol):
    name: str
    model: str
    reads_pdf: bool  # True when the provider accepts the PDF file itself

    def is_configured(self) -> bool:
        """Whether the credentials this provider needs are present."""
        ...

    def complete(self, system: str, user: str, pdf: bytes | None = None) -> Completion:
        """Run one request and return the model's text. Raise ProviderError on failure."""
        ...
