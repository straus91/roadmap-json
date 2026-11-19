"""Turn whatever JSON the model produced into a schema-shaped card.

This is where the v1 "flat JSON" bug is fixed by construction: the root object is always
rebuilt here as exactly {"$schema": <const from schema>, "Dataset" | "Model": {...}}, and
the body is walked against the schema, so a property the schema does not define can never
reach the validator or the user.

Ported and generalised from RSNA_ATLAS_MULTIMODAL/extract_cards.py (normalize +
prune_to_schema + _canon_modalities), which was dataset-only; this version is driven by
the schema, so it serves dataset and model cards alike. Everything it changes or drops is
reported back as a warning so the reviewer can see it.
"""
from __future__ import annotations

import re
from typing import Any

from jsonschema import Draft202012Validator

from .schemas import load_schema, resolve, root_key, schema_url

_DROP = object()  # sentinel: "remove this value from its parent"


# --------------------------------------------------------------------------- helpers
def _squash(key: str) -> str:
    """'burned_in_phi', 'Burned-in PHI', 'burnedInPhi' all become 'burnedinphi'."""
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _where(path: list[Any]) -> str:
    return " › ".join(f"item {p + 1}" if isinstance(p, int) else str(p) for p in path) or "card"


def _short(value: Any) -> str:
    text = value if isinstance(value, str) else repr(value)
    return text if len(text) <= 60 else text[:57] + "..."


# --------------------------------------------------------------------- enum matching
def _canon_modality(value: str) -> str | None:
    """Map free text ('CT', 'MRI', 'PET/CT', 'chest x-ray') to the RadLex-coded enum value."""
    low = " " + re.sub(r"[/\-]", " ", value.lower()) + " "
    pet = bool(re.search(r"\bpet\b", low)) or "positron" in low or "fdg" in low
    ct = bool(re.search(r"\bcta?\b", low)) or "computed tomog" in low or "cat scan" in low
    mr = "magnetic resonance" in low or bool(re.search(r"\bmri?\b", low))
    us = any(k in low for k in ("ultrasound", "ultrasonogr", "sonogr", "doppler", "echocardiog")) \
        or bool(re.search(r"\bus\b", low))
    rules = [
        (pet and ct, "PET-CT (RID10341)"),
        (pet and mr, "PET-MR (RID10342)"),
        ("spect" in low and ct, "SPECT-CT (RID49583)"),
        ("spect" in low or "single photon" in low,
         "Single photon emission computed tomography (RID10334)"),
        (pet, "Positron emission tomography (RID10337)"),
        ("nuclear medicine" in low or "scintigra" in low, "Nuclear medicine imaging (RID10330)"),
        ("functional magnetic" in low or "fmri" in low,
         "Functional magnetic resonance imaging (RID10317)"),
        ("angiog" in low and mr, "Magnetic resonance angiography (RID10319)"),
        ("spectros" in low and mr, "Magnetic resonance spectroscopy (RID10315)"),
        (mr, "Magnetic resonance imaging (RID10312)"),
        ("mammogra" in low, "Mammography (RID10357)"),
        ("tomosynth" in low, "Tomosynthesis (RID10359)"),
        ("fluorosc" in low, "Fluoroscopy (RID10361)"),
        (us, "Ultrasound (RID10326)"),
        ("digital radiog" in low, "Digital radiography (RID10351)"),
        ("computed radiog" in low, "Computed radiography (RID10349)"),
        (ct, "Computed tomography (RID10321)"),
        ("radiog" in low or "x ray" in low or "xray" in low or "plain film" in low,
         "Projection radiography (RID10345)"),
    ]
    return next((target for hit, target in rules if hit), None)


# ordered: multi-word aliases before the bare 'test'
_PARTITION_ALIASES = [("train", "Training"), ("valid", "Validation"), ("optimi", "Optimization"),
                      ("tuning", "Tuning"), ("hold", "Hold-out"),
                      ("internal test", "Internal testing"), ("external test", "External testing"),
                      ("develop", "Development"), ("test", "Test")]
_SEX_ALIASES = {"f": "Female", "female": "Female", "women": "Female", "woman": "Female",
                "m": "Male", "male": "Male", "men": "Male", "man": "Male"}
_YES_NO = {"yes": "Yes", "true": "Yes", "no": "No", "false": "No", "none": "No"}
_AUROC = "area under the receiver operating characteristic curve"
_METRIC_ALIASES = {
    "auc": _AUROC, "auroc": _AUROC, "aucroc": _AUROC, "rocauc": _AUROC,
    "auprc": "area under the precision-recall curve", "prauc": "area under the precision-recall curve",
    "dice": "Dice similarity coefficient", "dsc": "Dice similarity coefficient",
    "dicescore": "Dice similarity coefficient", "dicecoefficient": "Dice similarity coefficient",
    "iou": "intersection over union", "jaccard": "intersection over union",
    "jaccardindex": "intersection over union", "miou": "mean intersection over union",
    "hd95": "95th percentile Hausdorff distance", "hd": "Hausdorff distance",
    "assd": "average symmetric surface distance", "nsd": "normalized surface distance",
    "ppv": "positive predictive value", "npv": "negative predictive value",
    "f1": "F1 score", "f1score": "F1 score", "fscore": "F1 score",
    "mae": "mean absolute error", "mse": "mean squared error", "rmse": "root mean squared error",
    "map": "mean average precision", "ap": "average precision",
    "kappa": "Cohen's kappa", "cohenskappa": "Cohen's kappa",
    "icc": "intraclass correlation coefficient", "mcc": "Matthews correlation coefficient",
    "psnr": "peak signal-to-noise ratio", "ssim": "structural similarity index measure",
    "snr": "signal-to-noise ratio", "cnr": "contrast-to-noise ratio",
    "tpr": "true positive rate", "tnr": "true negative rate", "fpr": "false positive rate",
    "cindex": "concordance index", "ece": "expected calibration error",
    "r2": "R-squared", "rsquared": "R-squared", "bleu": "BLEU", "rouge": "ROUGE",
    "rougel": "ROUGE-L", "meteor": "METEOR", "bertscore": "BERTScore",
}


def _match_enum(value: Any, options: list[Any]) -> Any:
    """Return the enum option `value` means, or _DROP when it cannot be mapped."""
    if value in options:
        return value
    if isinstance(value, bool):
        value = "Yes" if value else "No"
    if not isinstance(value, str):
        return _DROP
    text = value.strip()
    strings = [o for o in options if isinstance(o, str)]
    by_lower = {o.lower(): o for o in strings}
    if text.lower() in by_lower:                                   # case differences ("nifti")
        return by_lower[text.lower()]
    coded = {o.split(" (RID")[0].strip().lower(): o for o in strings if " (RID" in o}
    if coded:                                                      # RadLex-coded list: modalities
        base = re.sub(r"\s*\(.*?\)\s*$", "", text).strip().lower()
        if base in coded:
            return coded[base]
        target = _canon_modality(text)
        return target if target in options else _DROP
    if "Training" in options:                                      # partition names
        low = text.lower()
        hit = next((target for alias, target in _PARTITION_ALIASES if alias in low), None)
        if hit in options:
            return hit
        return "Other" if "Other" in options else _DROP
    if "Female" in options and text.lower() in _SEX_ALIASES:
        return _SEX_ALIASES[text.lower()]
    if "Yes" in options and "No" in options and text.lower() in _YES_NO:
        return _YES_NO[text.lower()]
    if text.lower() + "s" in by_lower:                             # "year" -> "years"
        return by_lower[text.lower() + "s"]
    if "accuracy" in options and "other" in options:               # performance metrics
        alias = _METRIC_ALIASES.get(re.sub(r"[^a-z0-9]", "", text.lower()))
        return alias if alias in options else "other"
    if "DICOM" in options and "Other" in options:                  # file formats
        return "Other"
    return _DROP


# ------------------------------------------------------------------------ the walker
class _Normalizer:
    def __init__(self, schema: dict[str, Any]):
        self.schema = schema
        self.warnings: list[str] = []

    def warn(self, path: list[Any], message: str) -> None:
        self.warnings.append(f"{_where(path)}: {message}")

    def fit(self, value: Any, node: Any, path: list[Any]) -> Any:
        """Coerce `value` towards `node`; return _DROP when it cannot belong in the card."""
        node = resolve(node, self.schema)
        if not isinstance(node, dict):
            return value
        if isinstance(value, str):
            value = value.strip()
        if _is_empty(value):
            return _DROP                                           # silently: "no data"

        if "const" in node:
            return node["const"]
        if "enum" in node:
            matched = _match_enum(value, node["enum"])
            if matched is _DROP:
                self.warn(path, f'removed "{_short(value)}" (not one of the allowed values)')
            elif matched != value:
                self.warn(path, f'changed "{_short(value)}" to "{matched}"')
            return matched
        if "anyOf" in node or "oneOf" in node:
            return self.fit_any(value, node.get("anyOf") or node.get("oneOf"), path)

        kind = node.get("type")
        if kind == "object" or (kind is None and "properties" in node):
            return self.fit_object(value, node, path)
        if kind == "array":
            return self.fit_array(value, node, path)
        if kind == "string":
            if isinstance(value, bool) or isinstance(value, (dict, list)):
                self.warn(path, "removed (expected text)")
                return _DROP
            return value if isinstance(value, str) else str(value)
        if kind == "integer":
            return self.fit_integer(value, path)
        if kind == "number":
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return value
            try:
                return float(str(value).replace(",", ""))
            except ValueError:
                self.warn(path, f'removed "{_short(value)}" (expected a number)')
                return _DROP
        if kind == "boolean":
            if isinstance(value, bool):
                return value
            text = str(value).strip().lower()
            if text in ("yes", "true"):
                return True
            if text in ("no", "false"):
                return False
            self.warn(path, f'removed "{_short(value)}" (expected true or false)')
            return _DROP
        return value

    def fit_integer(self, value: Any, path: list[Any]) -> Any:
        if isinstance(value, bool):
            self.warn(path, "removed (expected a whole number)")
            return _DROP
        if isinstance(value, int):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, str) and re.fullmatch(r"-?\d{1,3}(,\d{3})+|-?\d+", value.strip()):
            return int(value.replace(",", ""))                     # "12,611" -> 12611
        self.warn(path, f'removed "{_short(value)}" (expected a whole number)')
        return _DROP

    def fit_any(self, value: Any, options: list[Any], path: list[Any]) -> Any:
        """e.g. Date = ISO date string | integer year. Keep the value if any branch accepts it,
        otherwise take the first branch that accepts a coerced form ("2024" -> 2024)."""
        resolved = [resolve(o, self.schema) for o in options]
        for option in resolved:
            if self._valid(value, option):
                return value
        for option in resolved:
            quiet = _Normalizer(self.schema)
            candidate = quiet.fit(value, option, path)
            if candidate is not _DROP and self._valid(candidate, option):
                return candidate
        self.warn(path, f'removed "{_short(value)}" (not in an accepted format)')
        return _DROP

    def _valid(self, value: Any, node: dict[str, Any]) -> bool:
        probe = {**node, "$defs": self.schema.get("$defs", {})}
        return Draft202012Validator(
            probe, format_checker=Draft202012Validator.FORMAT_CHECKER).is_valid(value)

    def fit_object(self, value: Any, node: dict[str, Any], path: list[Any]) -> Any:
        props: dict[str, Any] = node.get("properties", {})
        if isinstance(value, str) and "Name" in props:             # "Jane Doe" -> {"Name": "Jane Doe"}
            value = {"Name": value}
        if not isinstance(value, dict):
            self.warn(path, "removed (expected a group of fields)")
            return _DROP
        closed = node.get("additionalProperties") is False
        by_squash = {_squash(name): name for name in props}
        out: dict[str, Any] = {}
        for key, item in value.items():
            name = key if key in props else by_squash.get(_squash(key))
            if name is None:
                if closed:
                    if not _is_empty(item):
                        self.warn(path, f'removed unknown field "{key}" (not in the ATLAS schema)')
                else:
                    out[key] = item
                continue
            if name in out:                                        # e.g. "File format" and "file_format"
                if not _is_empty(item):
                    self.warn(path, f'removed field "{key}" (the card already has "{name}")')
                continue
            fitted = self.fit(item, props[name], path + [name])
            if fitted is not _DROP:
                out[name] = fitted
                if name != key:
                    self.warn(path, f'renamed field "{key}" to "{name}"')
        return out if out else _DROP

    def fit_array(self, value: Any, node: dict[str, Any], path: list[Any]) -> Any:
        if not isinstance(value, list):
            value = [value]                                        # "CT" -> ["CT"]
        prefix = node.get("prefixItems")
        items = node.get("items")
        out = []
        for index, item in enumerate(value):
            if prefix and index < len(prefix):
                sub = prefix[index]
            elif isinstance(items, dict):
                sub = items
            else:
                out.append(item)
                continue
            fitted = self.fit(item, sub, path + [index])
            if fitted is not _DROP:
                out.append(fitted)
            elif prefix:                                           # tuples (Age range bound) lose
                self.warn(path, "removed (incomplete value)")      # meaning if an element goes
                return _DROP
        if node.get("uniqueItems") or (isinstance(items, dict) and "enum" in resolve(items, self.schema)):
            out = [item for i, item in enumerate(out) if item not in out[:i]]
        if "maxItems" in node and node.get("minItems") == node["maxItems"] and len(out) != node["maxItems"]:
            self.warn(path, "removed (incomplete value)")          # fixed-length tuple
            return _DROP
        return out if out else _DROP


# ------------------------------------------------------------------------ public API
def find_body(raw: Any, card_type: str) -> dict[str, Any]:
    """Locate the card body in whatever the model returned.

    Accepts the correct shape ({"Dataset": {...}}), a mis-cased root ("dataset"), or a
    bare body with no wrapper at all (the v1 failure mode). Root-level strays such as
    "$schema" are discarded — the caller rebuilds the root.
    """
    root = root_key(card_type)
    if not isinstance(raw, dict):
        return {}
    for key, value in raw.items():
        if _squash(key) == _squash(root) and isinstance(value, dict):
            return value
    return {k: v for k, v in raw.items() if k != "$schema"}


def normalize(raw: Any, card_type: str, *, from_model: bool = False) -> tuple[dict[str, Any], list[str]]:
    """Return (card, warnings). The card's root is always exactly {"$schema", <Root>}.

    `from_model` is for a card a language model has just written: only then are index codes
    that merely repeat the schema's examples removed. A card a person wrote or edited keeps
    its codes (RID58 is a schema example and also the right code for a liver dataset)."""
    schema = load_schema(card_type)
    root = root_key(card_type)
    walker = _Normalizer(schema)
    body = walker.fit(find_body(raw, card_type), schema["properties"][root], [root])
    if body is _DROP:
        body = {}
    if from_model:
        _drop_example_codes(body, schema, walker)
    return {"$schema": schema_url(card_type), root: body}, walker.warnings


def _drop_example_codes(body: dict[str, Any], schema: dict[str, Any], walker: _Normalizer) -> None:
    """Models sometimes echo the schema's example codes (RID58, 10200004) as if they were
    findings. If *every* RadLex / SNOMED code is one of the schema's examples, drop the list."""
    indexing = body.get("Indexing")
    if not isinstance(indexing, dict):
        return
    props = schema.get("$defs", {}).get("Indexing", {}).get("properties", {})
    for field in ("RadLex", "SNOMED"):
        examples = props.get(field, {}).get("items", {}).get("examples") or []
        codes = indexing.get(field)
        if codes and examples and all(code in examples for code in codes):
            del indexing[field]
            walker.warn(["Indexing", field],
                        "removed (the codes matched the schema's examples, so they were "
                        "probably not taken from the document)")
    if not indexing:
        body.pop("Indexing", None)
