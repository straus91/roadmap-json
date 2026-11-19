"""Extraction prompts.

Ported from the v1 browser tool (`js/gemini-client.js` -> createExtractionPrompt) and its
Python port in RSNA_ATLAS_MULTIMODAL/roadmap_prompt.py, with two deliberate changes:

* The model is shown the real ATLAS JSON Schema instead of a generated example object.
  v1's example dropped the constraints (enums, lengths, patterns) and its hand-written
  rules had drifted from the schema ("$schema": "dataset.json", "CDE" vs "CDEs",
  content codes that are not in the enum). Deriving the prompt from the schema file means
  the extractor and the validator can no longer disagree.
* The system prompt is identical for every request of a card type, so providers that
  support prompt caching can cache it.
"""
from __future__ import annotations

import json
import re

from .schemas import load_schema, root_key, schema_url

# Meanings of the RSNA 2-letter content codes (the schema enum carries only the codes).
CONTENT_CODES = {
    "BR": "breast", "BQ": "biomarkers / quantitative imaging", "CA": "cardiac", "CH": "chest",
    "CT": "computed tomography", "ED": "education", "ER": "emergency radiology",
    "GI": "gastrointestinal", "GU": "genitourinary", "HN": "head and neck", "HP": "health policy",
    "IN": "informatics", "IR": "interventional", "LM": "leadership and management",
    "MI": "molecular imaging", "MK": "musculoskeletal", "MR": "magnetic resonance",
    "NM": "nuclear medicine", "NR": "neuroradiology", "OB": "obstetric / gynecologic",
    "OI": "oncologic imaging", "OT": "other", "PD": "pediatric", "PH": "physics",
    "PR": "professionalism", "SQ": "safety and quality", "RO": "radiation oncology",
    "RS": "research and statistical methods", "US": "ultrasound", "VA": "vascular",
}

_COMMON_GUIDANCE = """\
- Record only what the document states. When the document does not support a field, leave the \
field out; do not guess, and do not emit empty strings, empty arrays or empty objects. The \
reviewer trusts a missing field more than an invented one. This matters most for codes \
(RadLex RID, SNOMED CT, LOINC, RadLex Playbook RPID, RadElement CDE): include one only when \
that exact code is printed in the document.
- "Name" and "Link" are required. For "Link" use the most specific URL for the {noun} itself \
(its landing page, repository or download site); if the document gives none, use the \
publication's DOI as https://doi.org/<doi>.
- Fields with an enumerated list take one of the listed values verbatim. Map what the document \
says to the closest listed value (a "CT scan" is "Computed tomography (RID10321)"); if nothing \
listed fits, leave it out.
- Dates are either a full ISO date string ("2024-03-15") or an integer year (2024, not "2024").
- "Indexing" → "Content": every RSNA content code that applies ({content_codes}).
- "Indexing" → "Keywords": all of the document's keywords plus the main concepts, each one a \
single short concept ("Supervised learning", "Machine learning" rather than "Supervised \
learning type of machine learning").
- "Descriptors" → "Authors": every author, in order, with affiliation in "Address" and email / \
ORCID when given.
- "Descriptors" → "References": the publication(s) that describe this {noun} itself, which is \
normally the document you are reading. Do not copy the document's bibliography.
- Keep numbers exactly as reported; do not round or summarise them."""

_TYPE_GUIDANCE = {
    "dataset": """\
- "Partitions": one entry per split the document reports (training, validation, test, ...), \
with the counts in "Total". When the document breaks a split down (by sex, age group, \
diagnosis, scanner, ...), add one "Subsets" entry per group.
- "Age range" is [[low, unit], [high, unit]] with integer values, e.g. [[18, "years"], \
[90, "years"]]. When only a mean or median age is reported, put that sentence in "Comments" \
and leave "Age range" out.""",
    "model": """\
- "Model performance" → "Metrics": the metrics the document reports, using the schema's \
names (AUC is "area under the receiver operating characteristic curve"; use "other" for a \
metric that has no listed equivalent). Put the actual values, confidence intervals and the \
data they were measured on in "Model performance" → "Comments".
- "Model properties" → "Use" and "User": short phrases of 4 to 64 characters each, such as \
"Image segmentation" or "Diagnostic radiologist".""",
}


def build_system_prompt(card_type: str) -> str:
    schema = load_schema(card_type)
    root = root_key(card_type)
    noun = card_type
    codes = ", ".join(f"{code} {meaning}" for code, meaning in CONTENT_CODES.items()
                      if code in _content_enum(schema))
    guidance = _COMMON_GUIDANCE.format(noun=noun, content_codes=codes) + "\n" + _TYPE_GUIDANCE[card_type]
    return f"""\
You turn a medical-imaging AI publication into a ROADMAP / RSNA ATLAS {noun} card: a JSON \
document describing the {noun} that the publication presents, so that it can be listed in the \
ATLAS catalogue. A radiologist reviews and edits your card afterwards, and the card is checked \
against the JSON Schema below before they see it.

Output format: reply with one JSON object and nothing else (no Markdown fence, no commentary). \
Its root has exactly two properties:

{{"$schema": "{schema_url(card_type)}", "{root}": {{ ... }}}}

Everything about the {noun} goes inside "{root}", using the property names exactly as the \
schema spells them (capitalised, with spaces, e.g. "File format", "Burned-in PHI").

Guidance:
{guidance}

JSON Schema for the card:
{json.dumps(schema, indent=1, ensure_ascii=False)}"""


def build_user_prompt(card_type: str, document_text: str | None = None) -> str:
    ask = f"Create the ROADMAP {card_type} card for this document."
    if document_text is None:
        return ask
    return f"<document>\n{document_text}\n</document>\n\n{ask}"


def build_repair_prompt(card_type: str, previous: str, problems: list[str],
                        document_text: str | None = None) -> str:
    listed = "\n".join(f"- {p}" for p in problems)
    ask = (
        f"A first attempt at the ROADMAP {card_type} card for this document did not pass "
        f"validation.\n\nFirst attempt:\n{previous}\n\nProblems found:\n{listed}\n\n"
        "Reply with the complete corrected card as one JSON object. Fix the listed problems "
        "using the document, keep everything that was already correct, and leave out any "
        "field you cannot make valid from what the document says."
    )
    if document_text is None:
        return ask
    return f"<document>\n{document_text}\n</document>\n\n{ask}"


def remove_references(text: str) -> str:
    """Cut a trailing bibliography from extracted text (text mode only) — it is long, costs
    tokens and is never extracted. Only cuts when the heading is in the last 60% of the text."""
    matches = list(re.finditer(r"\n\s*(references|bibliography|literature cited|works cited)\s*\n",
                               text, flags=re.I))
    if matches and matches[-1].start() > len(text) * 0.4:
        return text[: matches[-1].start()]
    return text


def _content_enum(schema: dict) -> list[str]:
    try:
        return schema["$defs"]["Indexing"]["properties"]["Content"]["items"]["enum"]
    except KeyError:
        return list(CONTENT_CODES)
