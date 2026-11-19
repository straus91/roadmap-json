"""The ATLAS JSON Schemas are the single source of truth for card shape.

Everything else (prompt, normalizer, validator, and the frontend via
GET /api/schemas/{card_type}) reads the schema from here.

Authority: the schema ATLAS itself publishes at the URL every card carries in "$schema"
(https://atlas.rsna.org/schemas/2025-11/dataset.json). A copy is bundled in `schemas/` so the
app always works; `refresh_schemas()` re-reads the published one (at start-up and daily) and
switches to it when it is a sane schema for the same card type. If ATLAS is unreachable or
returns something unexpected, the last good copy stays in use.
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

log = logging.getLogger("roadmap.schemas")

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "schemas"
CACHE_DIR = Path(os.environ.get("DATA_DIR") or tempfile.gettempdir()) / "atlas-schemas"

CARD_TYPES = ("dataset", "model")

_lock = threading.Lock()
_schemas: dict[str, dict[str, Any]] = {}
_status: dict[str, dict[str, Any]] = {}


class UnknownCardType(ValueError):
    pass


def check_card_type(card_type: str) -> str:
    card_type = (card_type or "").strip().lower()
    if card_type not in CARD_TYPES:
        raise UnknownCardType(f"card_type must be one of {', '.join(CARD_TYPES)}")
    return card_type


def root_key(card_type: str) -> str:
    """'dataset' -> 'Dataset', 'model' -> 'Model'."""
    return check_card_type(card_type).capitalize()


def _bundled(card_type: str) -> dict[str, Any]:
    return json.loads((SCHEMA_DIR / f"{card_type}.json").read_text(encoding="utf-8"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ensure_loaded(card_type: str) -> None:
    if card_type in _schemas:
        return
    schema, source = _bundled(card_type), "bundled"
    cached = CACHE_DIR / f"{card_type}.json"
    if cached.is_file():                       # a copy fetched from ATLAS on an earlier run
        try:
            candidate = json.loads(cached.read_text(encoding="utf-8"))
            if acceptable(candidate, card_type, schema) is None:
                schema, source = candidate, "atlas (saved copy)"
        except (OSError, ValueError):
            pass
    _schemas[card_type] = schema
    _status[card_type] = {"source": source, "url": schema["properties"]["$schema"]["const"],
                          "checked_at": None, "last_error": None}


def load_schema(card_type: str) -> dict[str, Any]:
    """The schema currently in force for this card type."""
    card_type = check_card_type(card_type)
    with _lock:
        _ensure_loaded(card_type)
        return _schemas[card_type]


def schema_status() -> dict[str, dict[str, Any]]:
    with _lock:
        for card_type in CARD_TYPES:
            _ensure_loaded(card_type)
        return {t: dict(_status[t]) for t in CARD_TYPES}


def schema_url(card_type: str) -> str:
    """The exact `$schema` value a card must carry (a `const` in the schema)."""
    return load_schema(card_type)["properties"]["$schema"]["const"]


def acceptable(candidate: Any, card_type: str, reference: dict[str, Any]) -> str | None:
    """Why a freshly fetched schema must NOT replace the one in use (None = it may).

    It has to be a well-formed draft 2020-12 schema describing the same card type at the same
    published address, with the same root contract: exactly "$schema" + "Dataset"/"Model".
    """
    root = root_key(card_type)
    if not isinstance(candidate, dict):
        return "not a JSON object"
    try:
        Draft202012Validator.check_schema(candidate)
    except SchemaError as error:
        return f"not a valid JSON Schema ({error.message[:80]})"
    props = candidate.get("properties")
    if not isinstance(props, dict) or root not in props or "$schema" not in props:
        return f'does not describe a "{root}" card'
    if props["$schema"].get("const") != reference["properties"]["$schema"]["const"]:
        return "is for a different schema version"
    if set(candidate.get("required", [])) != {"$schema", root}:
        return 'no longer requires exactly "$schema" and the card body'
    if candidate.get("additionalProperties") is not False:
        return "no longer forbids extra root properties"
    return None


def _download(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "roadmap-card-creator"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def refresh_schemas(fetch: Callable[[str], Any] = _download) -> dict[str, dict[str, Any]]:
    """Re-read the schemas ATLAS publishes and adopt them when acceptable. Never raises."""
    for card_type in CARD_TYPES:
        current = load_schema(card_type)
        url = current["properties"]["$schema"]["const"]
        try:
            candidate = fetch(url)
            problem = acceptable(candidate, card_type, current)
        except Exception as error:  # network, TLS, bad JSON: keep what we have
            candidate, problem = None, f"could not be fetched ({type(error).__name__})"
        with _lock:
            status = _status[card_type]
            status["checked_at"] = _now()
            status["last_error"] = problem
            if problem is None:
                if candidate != current:
                    log.warning("ATLAS %s schema changed; now using the published version", card_type)
                _schemas[card_type] = candidate
                status["source"] = "atlas"
        if problem is None:
            try:
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                (CACHE_DIR / f"{card_type}.json").write_text(
                    json.dumps(candidate, ensure_ascii=False), encoding="utf-8")
            except OSError:
                pass
        else:
            log.warning("ATLAS %s schema not adopted: it %s", card_type, problem)
    return schema_status()


def start_background_sync(hours: float) -> None:
    """Refresh now and then every `hours` (daemon thread; dies with the process)."""
    def loop() -> None:
        while True:
            refresh_schemas()
            stop.wait(max(hours, 0.25) * 3600)
    stop = threading.Event()
    threading.Thread(target=loop, name="atlas-schema-sync", daemon=True).start()


def reset_for_tests() -> None:
    with _lock:
        _schemas.clear()
        _status.clear()


def resolve(node: Any, schema: dict[str, Any]) -> Any:
    """Follow local `$ref`s. Sibling keywords next to the $ref (e.g. description) are kept."""
    seen = 0
    while isinstance(node, dict) and "$ref" in node and seen < 16:
        target = schema.get("$defs", {}).get(node["$ref"].replace("#/$defs/", ""), {})
        node = {**target, **{k: v for k, v in node.items() if k != "$ref"}}
        seen += 1
    return node


def detect_card_type(card: Any) -> str | None:
    """Work out whether a card is a dataset or a model card from its own content."""
    if not isinstance(card, dict):
        return None
    for card_type in CARD_TYPES:
        if root_key(card_type) in card:
            return card_type
    declared = str(card.get("$schema", "")).lower()
    for card_type in CARD_TYPES:
        if declared.endswith(f"{card_type}.json"):
            return card_type
    return None
