"""Performance results as numbers the library can show in a column.

A 2025-11 model card keeps its results as one paragraph of free text ("Model performance ›
Comments"), so "Dice 0.943" cannot be shown, filtered or compared without reading that text.
This module has a language model read each paragraph ONCE and list the results it states, then
checks every value against the text: a number that does not appear in the paragraph exactly
as returned is thrown away. Nothing is calculated, converted or rounded.

The readings are kept by a fingerprint of the paragraph, so a card whose text changes simply
loses its reading until it is read again; a stale number is never shown. They are data for the
library only. They are never written into a card.

    python -m app.results            read every model card in the library that has no reading yet
    python -m app.results --dry-run  say how many there are, read nothing (costs nothing)
    python -m app.results --limit 5  read only five, to look at the result first

Two files hold readings: the one shipped with the app (app/data/metric_results.json) and, for
readings made on a running server, DATA_DIR/atlas-library/metric_results.json.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

log = logging.getLogger("roadmap.results")

SHIPPED = Path(__file__).resolve().parent / "data" / "metric_results.json"
MAX_RESULTS = 24          # per card; a paper listing 100 structures is summarised by its overall rows
_lock = threading.Lock()
_readings: dict[str, list[dict[str, str]]] = {}
_local: Path | None = None

SYSTEM = """You list the performance results stated in a short text about a medical imaging AI model.

Reply with JSON only: {"results": [{"set": "...", "metric": "...", "value": "...", "detail": "..."}]}

One entry for each number the text reports for a performance metric, in the order of the text.

- "value": the number exactly as printed, with its % sign or unit if it has one ("0.943", "91.1%",
  "2.3 mm"). Never calculate, convert, round or average. If the text gives a mean with a spread,
  the value is the mean.
- "detail": what the text attaches to that number: a confidence interval, a range, a standard
  deviation, a P value ("95% CI: 0.938, 0.947", "range 0.95-0.97", "SD 0.08"). Empty if none.
- "set": what the number was measured on, in the text's own words and short, with the sample size
  if stated, and the subgroup, class or structure when the number is specific to one
  ("Internal test set (n = 65 patients)", "External test set, malignant vs benign"). If the text
  does not say, use "Not stated".
- "metric": if the metric is one of the names in the list given with the text, use that name
  exactly (AUC is "area under the receiver operating characteristic curve", DSC is "Dice
  similarity coefficient"). Otherwise use the text's own name for it.

Leave out: numbers that are not results (sample sizes, dates, thresholds, hardware, training
settings) and results of other models or human readers unless the text is about them.
At most 24 entries: when the text lists the same metric for many structures or classes, keep the
overall or mean rows and drop the per-structure ones.
If the text states no numeric result, reply {"results": []}."""


def fingerprint(text: str) -> str:
    """Identifies a performance paragraph. Any change to the words gives a different one."""
    return hashlib.sha256(re.sub(r"\s+", " ", text).strip().encode("utf-8")).hexdigest()[:20]


def _plain(text: str) -> str:
    """For comparing a value with the text: every kind of dash and space counts as the same."""
    text = re.sub(r"[‐-―−]", "-", text)
    return re.sub(r"\s+", "", text).lower()


def keep_only_what_the_text_says(results: Any, text: str) -> tuple[list[dict[str, str]], int]:
    """(results whose value appears in the text exactly, how many were thrown away)."""
    source = _plain(text)
    kept: list[dict[str, str]] = []
    dropped = 0
    for item in results if isinstance(results, list) else []:
        if not isinstance(item, dict):
            dropped += 1
            continue
        row = {key: re.sub(r"\s+", " ", str(item.get(key) or "")).strip() for key in ("set", "metric", "value", "detail")}
        value = _plain(row["value"])
        if not row["metric"] or not re.search(r"\d", value) or value not in source:
            dropped += 1
            continue
        kept.append(row)
    return kept[:MAX_RESULTS], dropped + max(0, len(kept) - MAX_RESULTS)


def read_results(provider: Any, metrics: list[str], text: str) -> tuple[list[dict[str, str]], int, dict[str, int]]:
    """Ask the model once. Returns (checked results, how many were thrown away, token usage)."""
    from .extraction import parse_json
    listed = "\n".join(f"- {metric}" for metric in metrics) or "(none listed)"
    completion = provider.complete(SYSTEM, f"Metric names used by this card:\n{listed}\n\nText:\n{text}")
    parsed = parse_json(completion.text) or {}
    kept, dropped = keep_only_what_the_text_says(parsed.get("results"), text)
    return kept, dropped, completion.usage


# ------------------------------------------------------------------ the readings kept
def _load(path: Path) -> dict[str, list[dict[str, str]]]:
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        return {key: rows for key, rows in saved.get("readings", {}).items() if isinstance(rows, list)}
    except (OSError, ValueError, AttributeError):
        return {}


def configure(data_dir: Path | None) -> None:
    """Load the readings shipped with the app, then any made on this server."""
    global _local
    _local = data_dir / "atlas-library" / "metric_results.json" if data_dir else None
    with _lock:
        _readings.clear()
        _readings.update(_load(SHIPPED))
        if _local is not None:
            _readings.update(_load(_local))


def results_for(text: str) -> list[dict[str, str]] | None:
    """The reading of this paragraph, or None if it has not been read (or has changed since)."""
    with _lock:
        return _readings.get(fingerprint(text))


def _save(path: Path, readings: dict[str, list[dict[str, str]]], model: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    note = ("Performance results read from model cards' free text by a language model, each value "
            "checked to appear in the text. Keyed by a fingerprint of the text. See app/results.py.")
    path.write_text(json.dumps({"about": note, "read_by": model, "readings": dict(sorted(readings.items()))},
                               ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    from . import library
    from .config import load_settings
    from .providers import get_provider

    logging.basicConfig(level=logging.WARNING)
    settings = load_settings()
    configure(settings.data_dir)
    library.configure(settings.data_dir)
    if library.library_index()["count"] == 0:
        print("Reading the cards from ATLAS first…")
        library.refresh_library()
    with library._lock:  # noqa: SLF001 - this tool is part of the same package
        records = dict(library._records)  # noqa: SLF001
    todo: dict[str, tuple[list[str], str, str]] = {}
    models = with_text = 0
    for record in records.values():
        body = record.get("card", {}).get("Model")
        if not isinstance(body, dict):
            continue
        models += 1
        performance = body.get("Model performance") or {}
        text = performance.get("Comments") if isinstance(performance, dict) else None
        if not isinstance(text, str) or not text.strip():
            continue
        with_text += 1
        if results_for(text) is None:
            metrics = [m for m in performance.get("Metrics") or [] if isinstance(m, str)]
            todo[fingerprint(text)] = (metrics, text, str(body.get("Name") or ""))
    print(f"{models} model cards, {with_text} with performance text, {len(todo)} not read yet.")
    if "--dry-run" in argv or not todo:
        return 0
    if "--limit" in argv:                 # read only the first few, to look at the result first
        todo = dict(list(todo.items())[:int(argv[argv.index("--limit") + 1])])
    provider = get_provider(settings)
    if not provider.is_configured():
        print("No API key is configured, so nothing was read.")
        return 1

    usage = {"input_tokens": 0, "output_tokens": 0}
    fresh: dict[str, list[dict[str, str]]] = {}
    thrown = failed = 0

    def one(item: tuple[str, tuple[list[str], str, str]]) -> None:
        nonlocal thrown, failed
        key, (metrics, text, name) = item
        try:
            kept, dropped, used = read_results(provider, metrics, text)
        except Exception as error:  # noqa: BLE001 - one failure must not lose the rest
            with _lock:
                failed += 1
            print(f"  could not read: {name[:60]} ({type(error).__name__})")
            return
        with _lock:
            fresh[key] = kept
            thrown += dropped
            for part in usage:
                usage[part] += used.get(part, 0)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(one, todo.items()))

    with _lock:
        _readings.update(fresh)
        everything = dict(_readings)
    try:
        _save(SHIPPED, everything, settings.llm_model)
        where = str(SHIPPED)
    except OSError:                       # a running server cannot write into the app itself
        assert _local is not None
        _save(_local, everything, settings.llm_model)
        where = str(_local)
    values = sum(len(rows) for rows in fresh.values())
    print(f"Read {len(fresh)} texts: {values} results kept, {thrown} thrown away because the number "
          f"was not in the text, {sum(1 for rows in fresh.values() if not rows)} texts with no numeric result, "
          f"{failed} could not be read.")
    print(f"Cost: about US$ {settings.cost_usd(usage):.2f} ({usage['input_tokens']:,} tokens in, "
          f"{usage['output_tokens']:,} out). Saved to {where}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
