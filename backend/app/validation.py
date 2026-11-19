"""Schema validation with error messages that name the offending field.

v1 reported failures as "root: must NOT have additional properties", which told the user
nothing. Every error here carries the path to the field plus a plain-language message.
"""
from __future__ import annotations

from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from .schemas import load_schema

_TYPE_WORDS = {"string": "text", "integer": "a whole number", "number": "a number",
               "boolean": "true or false", "array": "a list", "object": "a group of fields"}


def _validator(card_type: str) -> Draft202012Validator:
    return Draft202012Validator(load_schema(card_type),
                                format_checker=Draft202012Validator.FORMAT_CHECKER)


def _location(path: list[Any]) -> str:
    return " › ".join(f"item {p + 1}" if isinstance(p, int) else str(p) for p in path) or "card"


def _pointer(path: list[Any]) -> str:
    return "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in path)


def _show(value: Any) -> str:
    text = value if isinstance(value, str) else repr(value)
    return text if len(text) <= 50 else text[:47] + "..."


def _example(schema: Any) -> str:
    examples = schema.get("examples") if isinstance(schema, dict) else None
    return f' (for example "{examples[0]}")' if examples else ""


def _entry(path: list[Any], keyword: str, message: str) -> dict[str, Any]:
    return {"path": path, "pointer": _pointer(path), "location": _location(path),
            "keyword": keyword, "message": message}


def _describe(error: ValidationError) -> list[dict[str, Any]]:
    path = list(error.absolute_path)
    keyword = error.validator
    limit = error.validator_value
    value = error.instance
    schema = error.schema

    if keyword == "additionalProperties":
        known = set(schema.get("properties", {}))
        extras = [k for k in value if k not in known] if isinstance(value, dict) else []
        return [_entry(path + [key], keyword,
                       f'"{key}" is not a field in the ATLAS schema; remove or rename it')
                for key in extras]
    if keyword == "required":
        missing = [k for k in limit if not isinstance(value, dict) or k not in value]
        return [_entry(path + [key], keyword, f'"{key}" is required but missing')
                for key in missing]
    if keyword == "enum":
        options = [str(o) for o in limit]
        listed = ", ".join(options) if len(options) <= 12 else \
            ", ".join(options[:8]) + f", ... ({len(options)} options)"
        message = f'"{_show(value)}" is not an allowed value. Allowed: {listed}'
    elif keyword == "const":
        message = f'must be exactly "{limit}"'
    elif keyword == "type":
        wanted = limit if isinstance(limit, list) else [limit]
        message = "must be " + " or ".join(_TYPE_WORDS.get(t, t) for t in wanted) + \
                  f' (got "{_show(value)}")'
    elif keyword == "minLength":
        message = f"is too short ({len(value)} characters; at least {limit} needed)"
    elif keyword == "maxLength":
        message = f"is too long ({len(value)} characters; at most {limit} allowed)"
    elif keyword == "pattern":
        message = f'"{_show(value)}" is not in the expected format{_example(schema)}'
    elif keyword == "format":
        nice = {"uri": "a full web address such as https://example.org",
                "date": "a date written as YYYY-MM-DD", "email": "an email address"}.get(limit, limit)
        message = f'"{_show(value)}" is not {nice}'
    elif keyword in ("minItems", "maxItems"):
        bound = "at least" if keyword == "minItems" else "at most"
        message = f"must have {bound} {limit} item(s) (has {len(value)})"
    elif keyword in ("minProperties", "maxProperties"):
        bound = "at least" if keyword == "minProperties" else "at most"
        message = f"must have {bound} {limit} field(s) filled in"
    elif keyword == "uniqueItems":
        message = "contains the same value more than once"
    elif keyword in ("minimum", "maximum"):
        bound = "at least" if keyword == "minimum" else "at most"
        message = f"must be {bound} {limit} (got {value})"
    elif keyword in ("anyOf", "oneOf"):
        branches = limit if isinstance(limit, list) else []
        if any(isinstance(b, dict) and b.get("format") == "date" for b in branches):
            message = (f'"{_show(value)}" is not a valid date; use YYYY-MM-DD '
                       "or a year as a number (2024)")
        else:
            message = f'"{_show(value)}" is not in an accepted format{_example(schema)}'
    else:
        message = error.message
    return [_entry(path, keyword, message)]


def validate(card: Any, card_type: str) -> list[dict[str, Any]]:
    """Return a list of problems (empty when the card is valid), ordered by position."""
    found: dict[tuple[str, str], dict[str, Any]] = {}
    for error in _validator(card_type).iter_errors(card):
        for entry in _describe(error):                 # the library reports `required` once per
            found.setdefault((entry["pointer"], entry["message"]), entry)  # missing key: dedupe
    return sorted(found.values(), key=lambda e: e["pointer"])


def as_sentences(errors: list[dict[str, Any]]) -> list[str]:
    return [f'{e["location"]}: {e["message"]}' for e in errors]
