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
def client(monkeypatch):
    def use(*replies):
        monkeypatch.setattr(main, "_provider", FakeProvider(*replies))
        return TestClient(main.app)
    return use


def test_api_health_and_schema(client):
    api = client()
    health = api.get("/api/health").json()
    assert health["status"] == "ok" and health["card_types"] == ["dataset", "model"]
    assert api.get("/api/schemas/model").json()["$id"] == "2025-11/model.json"
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
