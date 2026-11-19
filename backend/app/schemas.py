"""The ATLAS JSON Schemas are the single source of truth for card shape.

Everything else (prompt, normalizer, validator, and the frontend via
GET /api/schemas/{card_type}) reads the schema from here.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

SCHEMA_DIR = Path(__file__).resolve().parent.parent / "schemas"

CARD_TYPES = ("dataset", "model")


class UnknownCardType(ValueError):
    pass


def check_card_type(card_type: str) -> str:
    card_type = (card_type or "").strip().lower()
    if card_type not in CARD_TYPES:
        raise UnknownCardType(f"card_type must be one of {', '.join(CARD_TYPES)}")
    return card_type


@lru_cache(maxsize=None)
def load_schema(card_type: str) -> dict[str, Any]:
    card_type = check_card_type(card_type)
    return json.loads((SCHEMA_DIR / f"{card_type}.json").read_text(encoding="utf-8"))


def root_key(card_type: str) -> str:
    """'dataset' -> 'Dataset', 'model' -> 'Model'."""
    return check_card_type(card_type).capitalize()


def schema_url(card_type: str) -> str:
    """The exact `$schema` value a card must carry (a `const` in the schema)."""
    return load_schema(card_type)["properties"]["$schema"]["const"]


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
