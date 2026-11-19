"""Document -> schema-valid card. The same pipeline runs for every provider:

    prompt -> model -> parse JSON -> normalize to the schema -> validate
                                   -> (if problems) one repair request -> keep the better card

Mirrors the flow that produced 0-error cards in RSNA_ATLAS_MULTIMODAL/extract_cards.py.
"""
from __future__ import annotations

import io
import json
import re
from dataclasses import dataclass, field
from typing import Any

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from .normalize import normalize
from .prompt import build_repair_prompt, build_system_prompt, build_user_prompt, remove_references
from .providers import LLMProvider, ProviderError
from .schemas import check_card_type
from .validation import as_sentences, validate

MAX_TEXT_CHARS = 1_500_000   # ~375k tokens: far beyond any paper; refuse rather than truncate


@dataclass
class ExtractionResult:
    card: dict[str, Any]
    errors: list[dict[str, Any]]
    warnings: list[str]
    provider: str
    model: str
    repaired: bool = False
    usage: dict[str, int] = field(default_factory=dict)

    @property
    def valid(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "card": self.card,
            "valid": self.valid,
            "errors": self.errors,
            "warnings": self.warnings,
            "meta": {"provider": self.provider, "model": self.model,
                     "repaired": self.repaired, "usage": self.usage},
        }


def parse_json(text: str) -> Any | None:
    """Pull the JSON object out of a model reply, tolerating a Markdown fence or stray prose."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip())
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError:
        return None


def read_pdf(pdf: bytes, max_pages: int = 50) -> PdfReader:
    if not pdf.lstrip()[:5].startswith(b"%PDF-"):
        raise ProviderError("That file is not a PDF.", status=415)
    try:
        reader = PdfReader(io.BytesIO(pdf))
        if reader.is_encrypted:
            raise ProviderError("That PDF is password-protected. Remove the password and "
                                "upload it again.", status=422)
        pages = len(reader.pages)
    except PyPdfError:
        raise ProviderError("That PDF could not be read; it may be damaged.", status=422)
    if pages == 0:
        raise ProviderError("That PDF has no pages.", status=422)
    if pages > max_pages:
        raise ProviderError(f"That PDF has {pages} pages; the limit is {max_pages}.", status=413)
    return reader


def pdf_to_text(reader: PdfReader) -> str:
    text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    if len(text) < 200:
        raise ProviderError("No text could be read from that PDF (it may be a scan). "
                            "Set PDF_MODE=native so the model reads the pages directly.", status=422)
    return text


def extract_card(provider: LLMProvider, card_type: str, *, pdf: bytes | None = None,
                 text: str | None = None, pdf_mode: str = "native",
                 max_pages: int = 50) -> ExtractionResult:
    """The one entry point: a PDF (bytes) or plain text in, a normalised + validated card out."""
    card_type = check_card_type(card_type)
    if pdf is None and not (text or "").strip():
        raise ProviderError("Upload a PDF or paste the document text.", status=400)

    if pdf is not None:
        reader = read_pdf(pdf, max_pages)
        if pdf_mode == "text" or not provider.reads_pdf:
            text, pdf = remove_references(pdf_to_text(reader)), None
    if pdf is None and len(text or "") > MAX_TEXT_CHARS:
        raise ProviderError("That document is too long to process in one request.", status=413)

    system = build_system_prompt(card_type)
    usage: dict[str, int] = {}

    def ask(user_prompt: str):
        completion = provider.complete(system, user_prompt, pdf)
        for key, amount in completion.usage.items():
            usage[key] = usage.get(key, 0) + amount
        raw = parse_json(completion.text)
        card, warnings = normalize(raw if raw is not None else {}, card_type)
        errors = validate(card, card_type)
        return completion, raw, card, warnings, errors

    completion, raw, card, warnings, errors = ask(build_user_prompt(card_type, text))
    repaired = False
    if raw is None or errors:
        problems = as_sentences(errors)
        if raw is None:
            problems.insert(0, "The reply was not a JSON object.")
        previous = json.dumps(card, indent=1, ensure_ascii=False) if raw is not None \
            else completion.text[:20000]
        retry = ask(build_repair_prompt(card_type, previous, problems, text))
        retry_parsed, retry_errors = retry[1] is not None, retry[4]
        if retry_parsed and (raw is None or len(retry_errors) < len(errors)):
            completion, raw, card, warnings, errors = retry
            repaired = True

    return ExtractionResult(card=card, errors=errors, warnings=warnings, provider=provider.name,
                            model=completion.model, repaired=repaired, usage=usage)
