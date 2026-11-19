"""ROADMAP card creator API — a plain ASGI app (FastAPI). Nothing here is specific to a host:
it runs under `docker compose up`, on ECS/App Runner, or behind Mangum on Lambda unchanged.

    GET  /api/health                 status + which model provider is active
    GET  /api/schemas/{card_type}    the ATLAS JSON Schema (the frontend validates against the same file)
    POST /api/validate               card JSON -> list of problems
    POST /api/extract                PDF or text -> normalised, validated card
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .config import load_settings
from .extraction import extract_card
from .providers import LLMProvider, ProviderError, get_provider
from .schemas import CARD_TYPES, UnknownCardType, check_card_type, detect_card_type, load_schema
from .validation import validate

log = logging.getLogger("roadmap")
settings = load_settings()

app = FastAPI(title="ROADMAP Card Creator API", version=__version__,
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)

if settings.cors_origins:  # only needed when the frontend dev server runs on another port
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                       allow_methods=["*"], allow_headers=["*"])

_provider: LLMProvider | None = None


def provider() -> LLMProvider:
    global _provider
    if _provider is None:
        _provider = get_provider(settings)
    return _provider


@app.exception_handler(ProviderError)
async def provider_error(_, error: ProviderError) -> JSONResponse:
    return JSONResponse(status_code=error.status, content={"detail": error.message})


@app.exception_handler(UnknownCardType)
async def unknown_card_type(_, error: UnknownCardType) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(error)})


@app.get("/api/health")
def health() -> dict[str, Any]:
    try:
        configured = provider().is_configured()
    except ProviderError:
        configured = False
    return {"status": "ok", "version": __version__, "provider": settings.llm_provider,
            "model": settings.llm_model, "configured": configured,
            "pdf_mode": settings.pdf_mode, "max_upload_mb": settings.max_upload_mb,
            "card_types": list(CARD_TYPES)}


@app.get("/api/schemas/{card_type}")
def get_schema(card_type: str) -> dict[str, Any]:
    return load_schema(check_card_type(card_type))


@app.post("/api/validate")
def validate_card(card: Any = Body(...), card_type: str | None = None) -> dict[str, Any]:
    """Body: the card JSON itself. The card type is read from the card unless ?card_type= is given."""
    kind = check_card_type(card_type) if card_type else detect_card_type(card)
    if kind is None:
        raise HTTPException(400, 'Cannot tell whether this is a dataset or a model card: it has '
                                 'neither a "Dataset" nor a "Model" section. Add ?card_type=dataset '
                                 'or ?card_type=model.')
    errors = validate(card, kind)
    return {"card_type": kind, "valid": not errors, "errors": errors}


@app.post("/api/extract")
def extract(card_type: str = Form("dataset"),
            file: UploadFile | None = File(None),
            text: str | None = Form(None)) -> dict[str, Any]:
    """Multipart form: `card_type` (dataset | model) and either `file` (a PDF) or `text`."""
    kind = check_card_type(card_type)
    pdf: bytes | None = None
    if file is not None:
        pdf = file.file.read(settings.max_upload_bytes + 1)
        if len(pdf) > settings.max_upload_bytes:
            raise HTTPException(413, f"That file is larger than {settings.max_upload_mb} MB.")
        if not pdf:
            raise HTTPException(400, "The uploaded file is empty.")
    result = extract_card(provider(), kind, pdf=pdf, text=text, pdf_mode=settings.pdf_mode)
    log.info("extract %s: valid=%s errors=%d repaired=%s usage=%s", kind, result.valid,
             len(result.errors), result.repaired, result.usage)
    return result.to_dict()


# Serve the built frontend from the same container when it is present (single-image deploys).
if settings.static_dir.is_dir():
    app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="frontend")
