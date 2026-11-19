"""The library: every card ATLAS publishes, with the facts people search and filter by.

ATLAS has no export or public API for its cards, so they are read from its public pages: the
site index lists the card pages, and each page carries the complete card. `refresh_library()`
does that at start-up and then daily, and keeps the result in DATA_DIR. If ATLAS is unreachable
or changes its pages, the last good copy stays in use. Nothing here is stored in the repository.

For every card `summarize()` works out a small record (type, modality, subspecialty, task,
size, year, ...) that the library page filters and the overview counts. Everything in it is
taken from the card itself; nothing is guessed.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from . import results as readings

log = logging.getLogger("roadmap.library")

ATLAS = "https://atlas.rsna.org"
AGENT = "Mozilla/5.0 (compatible; roadmap-card-creator library sync)"

# RSNA's two-letter content codes. Four of them name a modality rather than a subspecialty.
CONTENT_CODES = {
    "BR": "Breast", "BQ": "Biomarkers and quantitative imaging", "CA": "Cardiac", "CH": "Chest",
    "CT": "Computed tomography", "ED": "Education", "ER": "Emergency radiology",
    "GI": "Gastrointestinal", "GU": "Genitourinary", "HN": "Head and neck", "HP": "Health policy",
    "IN": "Informatics", "IR": "Interventional", "LM": "Leadership and management",
    "MI": "Molecular imaging", "MK": "Musculoskeletal", "MR": "Magnetic resonance imaging",
    "NM": "Nuclear medicine", "NR": "Neuroradiology", "OB": "Obstetric and gynecologic",
    "OI": "Oncologic imaging", "OT": "Other", "PD": "Pediatric", "PH": "Physics and basic science",
    "PR": "Professionalism", "SQ": "Safety and quality", "RO": "Radiation oncology",
    "RS": "Research and statistical methods", "US": "Ultrasound", "VA": "Vascular",
}
MODALITY_CODES = {"CT": "CT", "MR": "MRI", "NM": "Nuclear medicine", "US": "Ultrasound"}
SHORT_MODALITY = {
    "Magnetic resonance imaging": "MRI", "Computed tomography": "CT",
    "Projection radiography": "Radiography", "Digital radiography": "Radiography",
    "Computed radiography": "Radiography", "Positron emission tomography": "PET",
    "Single photon emission computed tomography": "SPECT", "Optical coherence tomography": "OCT",
    "Dual energy xray absorptiometry": "DXA",
}


def modality_families(name: str) -> list[str]:
    """The modality a reader would filter by. Cards may name a technique (B-mode ultrasound,
    diffusion tensor imaging); the library groups those under the modality they belong to."""
    plain = re.sub(r"\s*\(RID\d+\)\s*$", "", name).strip()
    low = plain.lower()
    if plain in SHORT_MODALITY:
        return [SHORT_MODALITY[plain]]
    if low in ("pet-ct", "pet/ct"):
        return ["PET", "CT"]
    if low in ("pet-mr", "pet/mr", "pet-mri"):
        return ["PET", "MRI"]
    if "ultrasound" in low or "doppler" in low:
        return ["Ultrasound"]
    if "magnetic resonance" in low or "diffusion tensor" in low or low.endswith(" mri"):
        return ["MRI"]
    if low.endswith(" ct") or "computed tomography" in low:
        return ["SPECT"] if "single photon" in low else ["CT"]
    if low.startswith("nuclear medicine"):
        return ["Nuclear medicine"]
    return [plain] if plain else []


def _sentence_case(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text[:1].upper() + text[1:].lower() if text and not text.isupper() else text


COUNTS = ("Patient", "Exam", "Series", "Image", "Site")       # "<x> count" fields of a partition
SPLITS = {"Training", "Optimization", "Validation", "Internal testing", "External testing",
          "Tuning", "Hold-out", "Development", "Test"}        # partitions that add up to a whole
_PLACEHOLDER = "RSNA ATLAS is a hub"                            # ATLAS's text for "no description"


# ------------------------------------------------------------------ reading ATLAS
def _download(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read().decode("utf-8", errors="replace")


def card_pages(sitemap: str) -> list[str]:
    return sorted(set(re.findall(r"<loc>(https://atlas\.rsna\.org/cards/[0-9a-f-]{36})</loc>", sitemap)))


def read_page(page: str) -> dict[str, Any] | None:
    """The card inside an ATLAS card page, with ATLAS's own title and description for it."""
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)</script>', page, flags=re.S)
    try:
        blob = "".join(json.loads('"' + chunk + '"') for chunk in chunks)
    except ValueError:
        return None
    found: list[dict[str, Any]] = []
    for match in re.finditer(r'\{"\$schema":', blob):
        try:
            value, _ = json.JSONDecoder().raw_decode(blob, match.start())
        except ValueError:
            continue
        if isinstance(value, dict) and ("Dataset" in value or "Model" in value):
            found.append(value)
    if not found:
        return None
    card = max(found, key=lambda value: len(json.dumps(value)))
    title = re.search(r"<title>(.*?)</title>", page, flags=re.S)
    description = re.search(r'<meta name="description" content="(.*?)"', page, flags=re.S)
    return {"card": card,
            "title": _unescape(title.group(1)).replace(" - RSNA ATLAS AI Data Cards", "").strip() if title else "",
            "description": _unescape(description.group(1)).strip() if description else ""}


def _unescape(text: str) -> str:
    import html
    return html.unescape(text)


# ------------------------------------------------------------------ one card -> its facts
def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _years(bound: Any) -> float | None:
    """An age bound such as [18, "years"] in years."""
    if not (isinstance(bound, list) and len(bound) == 2 and isinstance(bound[0], (int, float))):
        return None
    return bound[0] / {"days": 365.25, "months": 12, "years": 1}.get(bound[1], 1)


def _sizes(partitions: list[Any]) -> dict[str, int]:
    """How big the dataset is, per kind of count. Cards record counts per partition and have no
    total, and some list the whole dataset as one partition next to its splits. So the size is
    the larger of: the biggest single partition, or the training/validation/test splits added up."""
    sizes: dict[str, int] = {}
    for kind in COUNTS:
        largest = split_sum = 0
        for partition in partitions:
            total = _dict(_dict(partition).get("Total"))
            value = total.get(f"{kind} count")
            if isinstance(value, int) and not isinstance(value, bool) and value > 0:
                largest = max(largest, value)
                if _dict(partition).get("Partition") in SPLITS:
                    split_sum += value
        if max(largest, split_sum):
            sizes[kind.lower()] = max(largest, split_sum)
    return sizes


def _population(partitions: list[Any], content: list[str]) -> tuple[str, list[float] | None]:
    """Pediatric / Adult / Mixed when the card gives ages; otherwise the Pediatric content code."""
    low: float | None = None
    high: float | None = None
    for partition in partitions:
        groups = [_dict(_dict(partition).get("Total"))] + [_dict(s) for s in _list(_dict(partition).get("Subsets"))]
        for group in groups:
            bounds = group.get("Age range")
            if isinstance(bounds, list) and len(bounds) == 2:
                first, last = _years(bounds[0]), _years(bounds[1])
                if first is not None and last is not None:
                    low = first if low is None else min(low, first)
                    high = last if high is None else max(high, last)
    if low is not None and high is not None:
        ages = [round(low, 1), round(high, 1)]
        if high <= 18:
            return "Pediatric", ages
        if low >= 18:
            return "Adult", ages
        return "Children and adults", ages
    return ("Pediatric", None) if "PD" in content else ("Not stated", None)


def _first_sentences(text: str, limit: int = 240) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    stop = max(cut.rfind(". "), cut.rfind("; "))
    return cut[:stop + 1] if stop > 80 else cut.rsplit(" ", 1)[0] + "…"


def summarize(card_id: str, record: dict[str, Any]) -> dict[str, Any]:
    card = _dict(record.get("card"))
    kind = "dataset" if "Dataset" in card else "model"
    body = _dict(card.get("Dataset" if kind == "dataset" else "Model"))
    descriptors, indexing, imaging = (_dict(body.get(key)) for key in ("Descriptors", "Indexing", "Imaging"))
    properties = _dict(body.get("Dataset properties" if kind == "dataset" else "Model properties"))
    performance = _dict(body.get("Model performance"))
    partitions = _list(body.get("Partitions"))

    name = _text(body.get("Name"))
    title = _text(record.get("title")) or name
    description = _text(record.get("description"))
    if description.startswith(_PLACEHOLDER) or description.lower() == title.lower():
        description = ""                                   # ATLAS has no description of its own
    summary = description or _first_sentences(
        _text(descriptors.get("Comments")) or _text(properties.get("Motivation"))
        or _text(properties.get("Clinical benefit")) or _text(properties.get("Indications for use")))

    content = [code for code in _list(indexing.get("Content")) if isinstance(code, str)]
    modalities: list[str] = []
    for entry in _list(imaging.get("Modalities")):
        for family in modality_families(_text(entry)):
            if family not in modalities:
                modalities.append(family)
    for code in content:                                   # e.g. a PET/CT + MRI set filed under CT only
        short = MODALITY_CODES.get(code)
        if short and short not in modalities:
            modalities.append(short)
    subspecialties = [CONTENT_CODES[code] for code in content if code in CONTENT_CODES and code not in MODALITY_CODES]

    published = _dict(descriptors.get("Date")).get("Published")
    year_match = re.match(r"(\d{4})", str(published)) if published else None
    license_text = _text(_dict(descriptors.get("License")).get("Text"))
    organizations = [_text(_dict(org).get("Name")) for org in _list(descriptors.get("Organizations"))]
    authors = [_text(_dict(person).get("Name")) for person in _list(descriptors.get("Authors"))]
    keywords = [word for word in _list(indexing.get("Keywords")) if isinstance(word, str)]
    procedures = [_text(_dict(procedure).get("Name")) for procedure in _list(imaging.get("Procedures"))]
    population, ages = _population(partitions, content)
    tasks = [task for task in _list(properties.get("Use")) if isinstance(task, str)]
    if not tasks:                                          # older cards: {"Intended": [...]}
        tasks = [task for task in _list(_dict(properties.get("Use")).get("Intended")) if isinstance(task, str)]
    tasks = list(dict.fromkeys(_sentence_case(task) for task in tasks if len(task) <= 48))
    metrics = [metric for metric in _list(performance.get("Metrics")) if isinstance(metric, str)]
    # Result values, read once from the performance text by a language model and checked against
    # it (see results.py). None = this text has not been read.
    read = readings.results_for(_text(performance.get("Comments"))) if _text(performance.get("Comments")) else None

    haystack = " ".join([title, name, summary, *keywords, *authors, *organizations, *procedures,
                         *modalities, *subspecialties, *tasks, *content,
                         *[str(code) for code in _list(indexing.get("RadLex"))]]).lower()
    return {
        "id": card_id, "type": kind, "title": title, "name": name, "summary": summary,
        "has_atlas_description": bool(description),
        "atlas_url": f"{ATLAS}/cards/{card_id}", "link": _text(body.get("Link")),
        "modalities": modalities, "subspecialties": subspecialties, "content_codes": content,
        "tasks": tasks, "metrics": metrics, "population": population, "ages": ages,
        "year": int(year_match.group(1)) if year_match else None,
        "license": license_text, "organizations": [org for org in organizations if org],
        "sizes": _sizes(partitions), "formats": [f for f in _list(imaging.get("File format")) if isinstance(f, str)],
        "architecture": _first_sentences(_text(properties.get("Architecture")), 90),
        "has_performance": bool(_text(performance.get("Comments"))),
        "results": read or [], "results_read": read is not None,
        "search": re.sub(r"\s+", " ", haystack),
    }


# ------------------------------------------------------------------ the copy kept on the server
_lock = threading.Lock()
_records: dict[str, dict[str, Any]] = {}       # card id -> {"card", "title", "description"}
_index: list[dict[str, Any]] = []
_state: dict[str, Any] = {"synced_at": None, "last_error": None, "syncing": False}
_store: Path | None = None


def configure(data_dir: Path) -> None:
    """Where the copy lives. Loads the last saved copy, if there is one."""
    global _store
    _store = data_dir / "atlas-library" / "cards.json"
    readings.configure(data_dir)
    try:
        saved = json.loads(_store.read_text(encoding="utf-8"))
        _adopt(saved["records"], saved.get("synced_at"))
    except (OSError, ValueError, KeyError, TypeError):
        pass


def _adopt(records: dict[str, dict[str, Any]], synced_at: str | None) -> None:
    index = [summarize(card_id, record) for card_id, record in records.items()]
    index.sort(key=lambda row: row["title"].lower())
    with _lock:
        _records.clear()
        _records.update(records)
        _index[:] = index
        _state["synced_at"] = synced_at


def refresh_library(fetch: Callable[[str], str] = _download, pause: float = 0.3) -> int:
    """Re-read every published card from ATLAS. Never raises; returns how many cards are held."""
    with _lock:
        if _state["syncing"]:
            return len(_index)
        _state["syncing"] = True
    try:
        pages = card_pages(fetch(f"{ATLAS}/sitemap.xml"))
        if not pages:
            raise ValueError("ATLAS's site index lists no card pages")

        def one(url: str) -> tuple[str, dict[str, Any] | None]:
            card_id = url.rsplit("/", 1)[-1]
            try:
                record = read_page(fetch(url))
            except Exception:  # noqa: BLE001 - one unreadable page must not lose the others
                record = None
            if pause:
                time.sleep(pause)
            return card_id, record

        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(one, pages))
        with _lock:
            previous = dict(_records)
        records: dict[str, dict[str, Any]] = {}
        missed = 0
        for card_id, record in results:
            if record is None:
                missed += 1
                record = previous.get(card_id)     # keep the copy we had of a page that failed today
            if record is not None:
                records[card_id] = record
        if missed > len(pages) / 2:
            raise ValueError(f"only {len(pages) - missed} of {len(pages)} card pages could be read")
        synced_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        _adopt(records, synced_at)
        with _lock:
            _state["last_error"] = None
        if _store is not None:
            try:
                _store.parent.mkdir(parents=True, exist_ok=True)
                temporary = _store.with_suffix(".tmp")
                temporary.write_text(json.dumps({"synced_at": synced_at, "records": records}, ensure_ascii=False),
                                     encoding="utf-8")
                temporary.replace(_store)
            except OSError as error:
                log.warning("could not save the library copy: %s", error)
        log.info("library: %d cards read from ATLAS (%d pages could not be read)", len(records), missed)
    except Exception as error:  # noqa: BLE001 - network, a redesigned page: keep what we have
        log.warning("library: could not be refreshed from ATLAS (%s: %s)", type(error).__name__, error)
        with _lock:
            _state["last_error"] = f"{type(error).__name__}: {error}"
    finally:
        with _lock:
            _state["syncing"] = False
    return len(_index)


def start_background_sync(hours: float) -> None:
    """Refresh now if the copy is missing or older than `hours`, then every `hours`."""
    def age_hours() -> float:
        with _lock:
            synced_at = _state["synced_at"]
        if not synced_at:
            return float("inf")
        return (datetime.now(timezone.utc) - datetime.fromisoformat(synced_at)).total_seconds() / 3600

    def loop() -> None:
        while True:
            if age_hours() >= hours:
                refresh_library()
            stop.wait(max(min(hours, 1.0), 0.25) * 3600)
    stop = threading.Event()
    threading.Thread(target=loop, name="atlas-library-sync", daemon=True).start()


def library_index() -> dict[str, Any]:
    with _lock:
        return {"cards": list(_index), "count": len(_index), "source": ATLAS, **_state}


def library_card(card_id: str) -> dict[str, Any] | None:
    with _lock:
        record = _records.get(card_id)
        facts = next((row for row in _index if row["id"] == card_id), None)
    return None if record is None else {**record, "facts": facts}


def reset_for_tests() -> None:
    global _store
    with _lock:
        _records.clear()
        _index.clear()
        _state.update(synced_at=None, last_error=None, syncing=False)
    _store = None
