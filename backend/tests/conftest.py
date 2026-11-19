import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.providers.base import Completion  # noqa: E402


class FakeProvider:
    """Stands in for a model: replies with canned text, records what it was asked."""
    name = "fake"
    model = "fake-1"
    reads_pdf = True

    def __init__(self, *replies: str):
        self.replies = list(replies)
        self.calls: list[dict] = []

    def is_configured(self) -> bool:
        return True

    def complete(self, system, user, pdf=None):
        self.calls.append({"system": system, "user": user, "pdf": pdf})
        return Completion(text=self.replies.pop(0), model=self.model,
                          usage={"input_tokens": 10, "output_tokens": 5})


@pytest.fixture
def fake_provider():
    return FakeProvider


def make_pdf(text: str = "") -> bytes:
    """A minimal one-page PDF (blank unless pypdf can't build text; text mode isn't tested with it)."""
    import io
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()
