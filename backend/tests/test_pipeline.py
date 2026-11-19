"""Extraction pipeline, validator messages and HTTP API, run against a fake model."""
import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.extraction import extract_card, parse_json
from app.prompt import build_system_prompt
from app.providers.base import ProviderError
from app.schemas import schema_url
from app.validation import validate
from conftest import FakeProvider, make_pdf

GOOD = {"$schema": schema_url("dataset"),
        "Dataset": {"Name": "My dataset", "Link": "https://example.org/d"}}


def test_parse_json_tolerates_fences_and_prose():
    assert parse_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json('Here it is: {"a": {"b": 2}} done') == {"a": {"b": 2}}
    assert parse_json("no json here") is None


def test_valid_first_answer_needs_one_request():
    provider = FakeProvider(json.dumps(GOOD))
    result = extract_card(provider, "dataset", pdf=make_pdf())
    assert result.valid and not result.repaired and result.card == GOOD
    assert len(provider.calls) == 1 and provider.calls[0]["pdf"] is not None


def test_invalid_answer_gets_one_repair_request_naming_the_problems():
    bad = {"dataset_name": "My dataset", "link": "https://example.org/d"}   # v1's flat shape
    provider = FakeProvider(json.dumps(bad), json.dumps(GOOD))
    result = extract_card(provider, "dataset", text="A paper about my dataset.")
    assert result.valid and result.repaired and result.card == GOOD
    assert len(provider.calls) == 2
    assert '"Name" is required but missing' in provider.calls[1]["user"]
    assert result.usage == {"input_tokens": 20, "output_tokens": 10}


def test_unparseable_then_still_invalid_returns_card_with_named_errors():
    provider = FakeProvider("Sorry, I cannot.", json.dumps({"Dataset": {"Name": "My dataset"}}))
    result = extract_card(provider, "dataset", text="A paper.")
    assert list(result.card) == ["$schema", "Dataset"]          # shape holds even on failure
    assert [e["location"] for e in result.errors] == ["Dataset › Link"]


def test_rejects_non_pdf_and_empty_input():
    with pytest.raises(ProviderError) as not_pdf:
        extract_card(FakeProvider(), "dataset", pdf=b"hello")
    assert not_pdf.value.status == 415
    with pytest.raises(ProviderError):
        extract_card(FakeProvider(), "dataset")


def test_validator_messages_name_the_field():
    card = {"$schema": "dataset.json", "dataset_name": "x",
            "Dataset": {"Name": "abc", "Link": "not a url",
                        "Imaging": {"Modalities": ["CT"]},
                        "Descriptors": {"Date": {"Published": "2024"}}}}
    messages = {e["location"]: e["message"] for e in validate(card, "dataset")}
    assert "dataset_name" in messages and "not a field" in messages["dataset_name"]
    assert "must be exactly" in messages["$schema"]
    assert "too short" in messages["Dataset › Name"]
    assert "web address" in messages["Dataset › Link"]
    assert "not an allowed value" in messages["Dataset › Imaging › Modalities › item 1"]
    assert "YYYY-MM-DD" in messages["Dataset › Descriptors › Date › Published"]


def test_system_prompt_is_built_from_the_schema():
    for card_type, root in (("dataset", "Dataset"), ("model", "Model")):
        prompt = build_system_prompt(card_type)
        assert schema_url(card_type) in prompt and f'"{root}"' in prompt
        assert "Computed tomography (RID10321)" in prompt
    assert build_system_prompt("dataset") == build_system_prompt("dataset")   # stable -> cacheable


@pytest.fixture
def client(monkeypatch, tmp_path):
    from app.budget import Ledger
    monkeypatch.setattr(main, "ledger", Ledger(tmp_path / "ledger.json", 50, 5))

    def use(*replies):
        monkeypatch.setattr(main, "_provider", FakeProvider(*replies))
        return TestClient(main.app)
    return use


def test_api_health_and_schema(client):
    api = client()
    health = api.get("/api/health").json()
    assert health["status"] == "ok" and health["card_types"] == ["dataset", "model"]
    assert api.get("/api/schemas/model").json()["$id"] == schema_url("model")
    assert health["schemas"]["dataset"]["url"] == schema_url("dataset")
    assert health["budget"] == {"paused": False}      # spending figures are not public by default
    assert api.get("/api/schemas/nope").status_code == 400


def test_api_validate(client):
    api = client()
    assert api.post("/api/validate", json=GOOD).json() == {
        "card_type": "dataset", "valid": True, "errors": []}
    flat = api.post("/api/validate?card_type=dataset", json={"dataset_name": "x"}).json()
    assert not flat["valid"]
    assert sorted(e["location"] for e in flat["errors"]) == ["$schema", "Dataset", "dataset_name"]
    assert api.post("/api/validate", json={"dataset_name": "x"}).status_code == 400


def test_api_extract_pdf_upload(client):
    api = client(json.dumps(GOOD))
    response = api.post("/api/extract", data={"card_type": "dataset"},
                        files={"file": ("paper.pdf", make_pdf(), "application/pdf")})
    body = response.json()
    assert response.status_code == 200 and body["valid"] and body["card"] == GOOD
    assert body["meta"]["provider"] == "fake"
    bad = api.post("/api/extract", data={"card_type": "dataset"},
                   files={"file": ("notes.txt", b"plain text", "text/plain")})
    assert bad.status_code == 415 and "not a PDF" in bad.json()["detail"]


# ------------------------------------------------------------------ schema authority
def test_published_schema_is_adopted_only_when_sane(tmp_path, monkeypatch):
    import copy
    from app import schemas
    monkeypatch.setattr(schemas, "CACHE_DIR", tmp_path)
    schemas.reset_for_tests()
    bundled = copy.deepcopy(schemas.load_schema("dataset"))

    newer = copy.deepcopy(bundled)
    newer["$defs"]["Dataset"]["properties"]["Name"]["maxLength"] = 300
    status = schemas.refresh_schemas(lambda url: newer if "dataset" in url else {"nonsense": True})
    assert schemas.load_schema("dataset")["$defs"]["Dataset"]["properties"]["Name"]["maxLength"] == 300
    assert status["dataset"]["source"] == "atlas" and status["dataset"]["last_error"] is None
    assert status["model"]["source"] == "bundled" and "does not describe" in status["model"]["last_error"]
    long_name = {"$schema": schema_url("dataset"), "Dataset": {"Name": "x" * 280, "Link": "https://example.org/d"}}
    assert validate(long_name, "dataset") == []          # validator follows the adopted schema

    for bad in ("<html>", {**newer, "additionalProperties": True}, {**newer, "required": ["Dataset"]},
                {**newer, "type": 12}):
        status = schemas.refresh_schemas(lambda url, bad=bad: bad)
        assert status["dataset"]["last_error"]            # rejected ...
        assert schemas.load_schema("dataset") == newer    # ... and the last good one stays

    def offline(url):
        raise OSError("no network")
    assert "could not be fetched" in schemas.refresh_schemas(offline)["dataset"]["last_error"]
    assert schemas.load_schema("dataset") == newer
    schemas.reset_for_tests()
    assert schemas.schema_status()["dataset"]["source"] == "atlas (saved copy)"   # survives a restart
    monkeypatch.setattr(schemas, "CACHE_DIR", tmp_path / "empty")
    schemas.reset_for_tests()


def test_bundled_schemas_match_the_published_contract():
    from app import schemas
    for card_type in ("dataset", "model"):
        schema = schemas.load_schema(card_type)
        assert schemas.acceptable(schema, card_type, schema) is None
        assert schema["$id"] == schema_url(card_type)


# ------------------------------------------------------------------ budget and cost
def test_budget_pauses_extraction_and_limits_each_visitor(tmp_path):
    from app.budget import Ledger
    ledger = Ledger(tmp_path / "usage.json", monthly_budget_usd=1.0, daily_limit_per_visitor=2)
    ledger.check("1.1.1.1")
    ledger.record("1.1.1.1", 0.30)
    ledger.record("1.1.1.1", 0.30)
    with pytest.raises(ProviderError) as too_many:
        ledger.check("1.1.1.1")
    assert too_many.value.status == 429 and "today's limit" in too_many.value.message
    ledger.check("2.2.2.2")                                # another visitor is unaffected
    ledger.record("2.2.2.2", 0.50)
    with pytest.raises(ProviderError) as spent:
        ledger.check("3.3.3.3")
    assert "budget" in spent.value.message
    summary = Ledger(tmp_path / "usage.json", 1.0, 2).summary()   # persisted on disk
    assert summary["spent_usd"] == 1.1 and summary["papers_this_month"] == 3 and summary["paused"]
    assert "1.1.1.1" not in (tmp_path / "usage.json").read_text()  # addresses are not stored


def test_api_reports_cost_and_enforces_the_budget(client, monkeypatch, tmp_path):
    from app.budget import Ledger
    import dataclasses
    api = client(json.dumps(GOOD), json.dumps(GOOD), json.dumps(GOOD))
    hidden = api.post("/api/extract", data={"card_type": "dataset", "text": "A paper."})
    assert hidden.status_code == 200 and "cost_usd" not in hidden.json()["meta"]
    monkeypatch.setattr(main, "settings", dataclasses.replace(main.settings, show_usage=True))
    monkeypatch.setattr(main, "ledger", Ledger(tmp_path / "usage.json", 0.0001, 5))
    assert api.get("/api/health").json()["budget"]["monthly_budget_usd"] == 0.0001
    first = api.post("/api/extract", data={"card_type": "dataset", "text": "A paper."})
    assert first.status_code == 200 and first.json()["meta"]["cost_usd"] > 0
    second = api.post("/api/extract", data={"card_type": "dataset", "text": "A paper."})
    assert second.status_code == 429 and "budget" in second.json()["detail"]
    assert api.get("/api/health").json()["budget"]["paused"] is True
    assert api.post("/api/validate", json=GOOD).json()["valid"]    # checking cards stays available


def test_api_normalize_tidies_a_card_without_a_model(client):
    api = client()
    messy = {"dataset": {"name": "My dataset", "link": "https://example.org/d", "summary": "x",
                         "imaging": {"modalities": ["MRI"]}}}
    body = api.post("/api/normalize?card_type=dataset", json=messy).json()
    assert body["valid"] and list(body["card"]) == ["$schema", "Dataset"]
    assert body["card"]["Dataset"]["Imaging"]["Modalities"] == ["Magnetic resonance imaging (RID10312)"]
    assert any("summary" in w for w in body["warnings"])


def test_prompt_carries_the_review_rules():
    prompt = build_system_prompt("model")
    for rule in ("without degrees or titles", "do not work out an article number",
                 "too small to read with certainty", "do not add a general term"):
        assert rule in prompt


def test_model_prompt_asks_for_results_the_editor_can_tabulate():
    prompt = build_system_prompt("model")
    assert "one line per evaluation set" in prompt and "accuracy = 91.1% (95% CI: 87.5, 94.4)" in prompt
    assert "one line per evaluation set" not in build_system_prompt("dataset")


def test_line_breaks_inside_text_survive_normalisation():
    text = "Test set (n = 10): accuracy = 0.9.\n\nRemarks follow."
    raw = {"Model": {"Name": "A model", "Link": "https://example.org/m",
                     "Model performance": {"Metrics": ["accuracy"], "Comments": "  " + text + " \n"}}}
    from app.normalize import normalize
    card, warnings = normalize(raw, "model")
    assert card["Model"]["Model performance"]["Comments"] == text and warnings == []
    assert validate(card, "model") == []
