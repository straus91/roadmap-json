"""ROADMAP card creator API — a plain ASGI app (FastAPI). Nothing here is specific to a host:
it runs under `docker compose up`, on ECS/App Runner, or behind Mangum on Lambda unchanged.

    GET  /api/health                 status, active model, schema source, budget
    GET  /api/schemas/{card_type}    the ATLAS JSON Schema in force (the frontend uses the same one)
    POST /api/validate               card JSON -> list of problems (the authority on validity)
    POST /api/normalize              card JSON -> the same card tidied to fit the schema
    POST /api/extract                PDF or text -> normalised, validated card (waits for it)
    POST /api/jobs                   the same, as a job: answers at once with a ticket
    GET  /api/jobs/{id}              running | done (with the card) | failed (with the reason)
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .budget import Ledger
from .config import load_settings
from .extraction import extract_card, read_pdf
from .normalize import normalize
from .providers import LLMProvider, ProviderError, get_provider
from .schemas import (CARD_TYPES, UnknownCardType, check_card_type, detect_card_type,
                      load_schema, schema_status, start_background_sync)
from .validation import validate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("roadmap")
settings = load_settings()
ledger = Ledger(settings.data_dir / "usage.json", settings.monthly_budget_usd,
                settings.daily_limit_per_visitor)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.schema_sync_hours > 0:
        start_background_sync(settings.schema_sync_hours)  # ATLAS's published schema is the authority
    yield


app = FastAPI(title="ROADMAP Card Creator API", version=__version__, lifespan=lifespan,
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


def card_type_of(card: Any, card_type: str | None) -> str:
    kind = check_card_type(card_type) if card_type else detect_card_type(card)
    if kind is None:
        raise HTTPException(400, 'Cannot tell whether this is a dataset or a model card: it has '
                                 'neither a "Dataset" nor a "Model" section. Add ?card_type=dataset '
                                 'or ?card_type=model.')
    return kind


def usage_for_visitors() -> dict[str, Any]:
    """What the public page may know about spending: by default only whether reading papers is
    paused. The paper count and dollar figures are the owner's business (SHOW_USAGE=true shows them)."""
    summary = ledger.summary()
    return summary if settings.show_usage else {"paused": summary["paused"]}


@app.get("/api/health")
def health() -> dict[str, Any]:
    try:
        configured = provider().is_configured()
    except ProviderError:
        configured = False
    return {"status": "ok", "version": __version__, "provider": settings.llm_provider,
            "model": settings.llm_model, "configured": configured,
            "pdf_mode": settings.pdf_mode, "max_upload_mb": settings.max_upload_mb,
            "max_pdf_pages": settings.max_pdf_pages, "card_types": list(CARD_TYPES),
            "schemas": schema_status(), "budget": usage_for_visitors()}


@app.get("/api/schemas/{card_type}")
def get_schema(card_type: str) -> dict[str, Any]:
    return load_schema(check_card_type(card_type))


@app.post("/api/validate")
def validate_card(card: Any = Body(...), card_type: str | None = None) -> dict[str, Any]:
    """Body: the card JSON itself. The card type is read from the card unless ?card_type= is given."""
    kind = card_type_of(card, card_type)
    errors = validate(card, kind)
    return {"card_type": kind, "valid": not errors, "errors": errors}


@app.post("/api/normalize")
def normalize_card(card: Any = Body(...), card_type: str | None = None) -> dict[str, Any]:
    """Tidy a card to fit the schema: fix field names and value formats where that is safe,
    remove what the schema does not allow, and report every change. Costs nothing (no model)."""
    kind = card_type_of(card, card_type)
    tidy, warnings = normalize(card, kind)
    errors = validate(tidy, kind)
    return {"card_type": kind, "card": tidy, "warnings": warnings,
            "valid": not errors, "errors": errors}


def _accept(request: Request, card_type: str, file: UploadFile | None,
            text: str | None) -> tuple[str, str, bytes | None, str | None]:
    """Everything that can be refused before any money is spent: budget, size, file type."""
    kind = check_card_type(card_type)
    visitor = request.client.host if request.client else "unknown"
    ledger.check(visitor)
    pdf: bytes | None = None
    if file is not None:
        pdf = file.file.read(settings.max_upload_bytes + 1)
        if len(pdf) > settings.max_upload_bytes:
            raise HTTPException(413, f"That file is larger than {settings.max_upload_mb} MB.")
        if not pdf:
            raise HTTPException(400, "The uploaded file is empty.")
        read_pdf(pdf, settings.max_pdf_pages)        # not a PDF, damaged, locked or too long
    elif not (text or "").strip():
        raise HTTPException(400, "Upload a PDF or paste the document text.")
    return kind, visitor, pdf, text


def _read_paper(kind: str, visitor: str, pdf: bytes | None, text: str | None) -> dict[str, Any]:
    result = extract_card(provider(), kind, pdf=pdf, text=text, pdf_mode=settings.pdf_mode,
                          max_pages=settings.max_pdf_pages)
    cost = settings.cost_usd(result.usage)
    ledger.record(visitor, cost)
    log.info("extract %s: valid=%s errors=%d repaired=%s cost=$%.4f usage=%s", kind, result.valid,
             len(result.errors), result.repaired, cost, result.usage)
    body = result.to_dict()
    if settings.show_usage:
        body["meta"]["cost_usd"] = cost
        body["meta"]["cost_is_estimate"] = not settings.price_is_known
    return body


@app.post("/api/extract")
def extract(request: Request,
            card_type: str = Form("dataset"),
            file: UploadFile | None = File(None),
            text: str | None = Form(None)) -> dict[str, Any]:
    """Multipart form: `card_type` (dataset | model) and either `file` (a PDF) or `text`.
    Answers when the card is ready (up to a minute or two). Fine for scripts; the web page uses
    /api/jobs instead, because phones and some networks drop a request held open that long."""
    return _read_paper(*_accept(request, card_type, file, text))


# ------------------------------------------------------------------ reading as a job
# The web page hands the paper over, gets a ticket back at once, and asks for the result
# every couple of seconds. A dropped connection, a locked phone or a reloaded page then loses
# nothing: the paper is still being read, and the ticket still fetches the card.
JOB_KEEP_SECONDS = 30 * 60
MAX_JOBS_AT_ONCE = 4
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _work(job_id: str, kind: str, visitor: str, pdf: bytes | None, text: str | None) -> None:
    try:
        outcome: dict[str, Any] = {"status": "done", "result": _read_paper(kind, visitor, pdf, text)}
    except ProviderError as error:
        outcome = {"status": "failed", "detail": error.message}
    except Exception:  # noqa: BLE001 - a job must always end in a state the page can show
        log.exception("job %s failed unexpectedly", job_id)
        outcome = {"status": "failed", "detail": "Something went wrong while reading the paper. "
                                                 "Please try again."}
    with _jobs_lock:
        _jobs[job_id].update(outcome, finished=time.time())


@app.post("/api/jobs", status_code=202)
def start_job(request: Request,
              card_type: str = Form("dataset"),
              file: UploadFile | None = File(None),
              text: str | None = Form(None)) -> dict[str, Any]:
    """Same form as /api/extract. Answers immediately with {"job_id": ...}."""
    kind, visitor, pdf, text = _accept(request, card_type, file, text)
    now = time.time()
    with _jobs_lock:
        for old in [key for key, job in _jobs.items() if now - job["created"] > JOB_KEEP_SECONDS]:
            del _jobs[old]
        if sum(job["status"] == "running" for job in _jobs.values()) >= MAX_JOBS_AT_ONCE:
            raise HTTPException(429, "The server is busy reading other papers. "
                                     "Please try again in a minute.")
        job_id = uuid.uuid4().hex
        _jobs[job_id] = {"status": "running", "created": now}
    threading.Thread(target=_work, args=(job_id, kind, visitor, pdf, text),
                     name=f"job-{job_id[:8]}", daemon=True).start()
    return {"job_id": job_id, "status": "running"}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str) -> dict[str, Any]:
    """{"status": "running" | "done" | "failed", "result"?: the card, "detail"?: what went wrong}"""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "That paper is no longer on the server (it may have "
                                     "restarted, or too much time has passed). Please send it again.")
        return {key: job[key] for key in ("status", "result", "detail") if key in job}


# Serve the built frontend from the same container when it is present (single-image deploys).
if settings.static_dir.is_dir():
    app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="frontend")
