"""The normaliser must turn any model output into a schema-shaped card."""
from app.normalize import normalize
from app.schemas import schema_url
from app.validation import validate

# The shape v1's PDF import produced: flat, snake_case, no "Dataset" wrapper.
FLAT_V1_DRAFT = {
    "dataset_name": "RSNA Abdominal Traumatic Injury CT (RATIC) Dataset",
    "link": "https://doi.org/10.1148/ryai.240101",
    "imaging_details": {"modality": "CT"},
    "burned_in_phi": "No",
    "partioning_scheme": "70/15/15",
}


def test_root_is_always_exactly_schema_and_dataset():
    for raw in (FLAT_V1_DRAFT, {}, [], "nonsense", None, {"dataset": {"Name": "abcd"}},
                {"$schema": "dataset.json", "Dataset": {"Name": "abcd"}, "extra": 1}):
        card, _ = normalize(raw, "dataset")
        assert list(card) == ["$schema", "Dataset"]
        assert card["$schema"] == schema_url("dataset")


def test_flat_v1_draft_never_fails_with_additional_properties():
    card, warnings = normalize(FLAT_V1_DRAFT, "dataset")
    errors = validate(card, "dataset")
    assert not [e for e in errors if e["keyword"] == "additionalProperties"]
    assert card["Dataset"]["Link"] == "https://doi.org/10.1148/ryai.240101"   # "link" -> "Link"
    assert any("dataset_name" in w for w in warnings)                          # reported, not silent
    # what is left is an honest, specific problem: the name could not be mapped
    assert [(e["location"], e["keyword"]) for e in errors] == [("Dataset › Name", "required")]


def test_wrong_wrapper_and_schema_value_are_repaired():
    card, _ = normalize({"$schema": "dataset.json",
                         "dataset": {"Name": "My dataset", "Link": "https://example.org/d"}}, "dataset")
    assert validate(card, "dataset") == []


def test_snake_case_keys_inside_sections_are_rescued():
    raw = {"Dataset": {
        "name": "My dataset", "link": "https://example.org/d",
        "imaging": {"modalities": ["CT", "MRI", "PET/CT", "chest x-ray", "CT"],
                    "file_format": ["dicom", "nifti", "TIFF"],
                    "burned_in_phi": "no",
                    "procedures": ["CT Chest without IV contrast"]},
        "dataset_properties": {"partitioning_scheme": "Patient-level 80/10/10 split"},
    }}
    card, _ = normalize(raw, "dataset")
    imaging = card["Dataset"]["Imaging"]
    assert imaging["Modalities"] == ["Computed tomography (RID10321)",
                                     "Magnetic resonance imaging (RID10312)",
                                     "PET-CT (RID10341)", "Projection radiography (RID10345)"]
    assert imaging["File format"] == ["DICOM", "NiFTI", "Other"]
    assert imaging["Burned-in PHI"] == "No"
    assert imaging["Procedures"] == [{"Name": "CT Chest without IV contrast"}]
    assert card["Dataset"]["Dataset properties"]["Partitioning scheme"].startswith("Patient-level")
    assert validate(card, "dataset") == []


def test_values_are_coerced_to_schema_types():
    raw = {"Dataset": {
        "Name": "My dataset", "Link": "https://example.org/d",
        "Descriptors": {
            "Authors": ["Jane Doe", {"Name": "John Roe", "Email": ""}],
            "Date": {"Published": "2024", "Created": "2023-05-01", "Updated": "last spring"},
            "Version": 2,
            "License": {},
        },
        "Indexing": {"Content": ["CT", "AI", "CH", "CT"], "SNOMED": ["233604007"],
                     "Keywords": "Deep learning", "RadLex": ["RID58", "RID1169"]},
        "Partitions": [
            {"Partition": "training set", "Total": {"Patient count": "12,611", "Sex": "F",
                                                    "Demographic": "mixed",
                                                    "Age range": [[18, "year"], [90, "years"]]}},
            {"Partition": "Testing", "Total": {"Patient count": 200.0,
                                               "Age range": [[18, "years"]]}},
            {"Partition": "something else"},
        ],
    }}
    card, warnings = normalize(raw, "dataset")
    body = card["Dataset"]
    assert body["Descriptors"]["Authors"] == [{"Name": "Jane Doe"}, {"Name": "John Roe"}]
    assert body["Descriptors"]["Date"] == {"Published": 2024, "Created": "2023-05-01"}
    assert body["Descriptors"]["Version"] == "2"
    assert "License" not in body["Descriptors"]
    assert body["Indexing"]["Content"] == ["CT", "CH"]
    assert body["Indexing"]["SNOMED"] == [233604007]
    assert body["Indexing"]["Keywords"] == ["Deep learning"]
    assert "RadLex" not in body["Indexing"]            # exactly the schema's example codes
    train, test, other = body["Partitions"]
    assert train["Partition"] == "Training"
    assert train["Total"] == {"Patient count": 12611, "Sex": "Female",
                              "Age range": [[18, "years"], [90, "years"]]}
    assert test == {"Partition": "Test", "Total": {"Patient count": 200}}
    assert other == {"Partition": "Other"}
    assert validate(card, "dataset") == []
    assert any("Demographic" in w for w in warnings)


def test_model_card_normalises_with_the_model_schema():
    raw = {"model": {
        "Name": "LungNoduleNet", "Link": "https://example.org/m",
        "model_performance": {"metrics": ["AUC", "Dice", "sensitivity", "my custom score"],
                              "comments": "AUC 0.91 (95% CI 0.88-0.94) on the test set"},
        "Model properties": {"Use": {"Intended": "Detection and diagnosis"},
                             "Regulatory information": {"FDA cleared": "yes"},
                             "Output": {"CDE": ["RDE1203"], "CDEs": ["RDES174"]}},
        "Partitions": [{"Partition": "Training"}],
    }}
    card, warnings = normalize(raw, "model")
    assert list(card) == ["$schema", "Model"]
    body = card["Model"]
    assert body["Model performance"]["Metrics"] == [
        "area under the receiver operating characteristic curve",
        "Dice similarity coefficient", "sensitivity", "other"]
    assert body["Model properties"]["Use"]["Intended"] == ["Detection and diagnosis"]
    assert body["Model properties"]["Regulatory information"]["FDA cleared"] is True
    assert body["Model properties"]["Output"] == {"CDEs": ["RDES174"]}
    assert "Partitions" not in body                    # a dataset-only section
    assert validate(card, "model") == []


def test_valid_card_passes_through_unchanged():
    card = {"$schema": schema_url("dataset"), "Dataset": {
        "Name": "My dataset", "Link": "https://example.org/d",
        "Partitions": [{"Partition": "Training", "Total": {
            "Patient count": 10, "Age range": [[1, "months"], [240, "months"]]}}]}}
    again, warnings = normalize(card, "dataset")
    assert again == card and warnings == []


def test_duplicate_spellings_of_a_field_are_reported_not_silently_dropped():
    raw = {"Dataset": {"Name": "My dataset", "Link": "https://example.org/d",
                       "Imaging": {"Burned-in PHI": "No", "burned_in_phi": "yes"}}}
    card, warnings = normalize(raw, "dataset")
    assert card["Dataset"]["Imaging"] == {"Burned-in PHI": "No"}
    assert any('"burned_in_phi"' in w and "already has" in w for w in warnings)
