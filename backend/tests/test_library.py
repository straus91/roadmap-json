import json

from fastapi.testclient import TestClient

from app import library, main


def page(card: dict, title: str, description: str) -> str:
    """An ATLAS card page as its site serves it: the card sits inside the page's script data."""
    inner = json.dumps("18:T2073," + json.dumps(card))[1:-1]
    return (f"<html><head><title>{title} - RSNA ATLAS AI Data Cards</title>"
            f'<meta name="description" content="{description}"/></head><body>'
            f'<script>self.__next_f.push([1,"{inner}"])</script></body></html>')


DATASET = {"$schema": "https://atlas.rsna.org/schemas/2025-11/dataset.json", "Dataset": {
    "Name": "Liver MRI set", "Link": "https://example.org/d",
    "Indexing": {"Content": ["GI", "MR", "PD"], "Keywords": ["liver", "segmentation"], "RadLex": ["RID58"]},
    "Imaging": {"Modalities": ["Magnetic resonance imaging (RID10312)"], "File format": ["DICOM"]},
    "Descriptors": {"Date": {"Published": "2023-05-01"}, "License": {"Text": "CC BY 4.0"},
                    "Organizations": [{"Name": "Example University"}], "Authors": [{"Name": "Jane Doe"}],
                    "Comments": "A set of liver MRI studies."},
    "Partitions": [
        {"Partition": "Other", "Total": {"Patient count": 500}},                 # the whole set
        {"Partition": "Training", "Total": {"Patient count": 300, "Age range": [[2, "years"], [17, "years"]]}},
        {"Partition": "Test", "Total": {"Patient count": 150}},
    ]}}
MODEL = {"$schema": "https://atlas.rsna.org/schemas/2025-11/model.json", "Model": {
    "Name": "FractureNet", "Link": "https://example.org/m",
    "Indexing": {"Content": ["MK", "CT"], "Keywords": ["fracture"]},
    "Imaging": {"Modalities": ["Projection radiography (RID10345)"]},
    "Descriptors": {"Date": {"Published": 2024}},
    "Model properties": {"Use": {"Intended": ["Detection"]}, "Clinical benefit": "Faster reads."},
    "Model performance": {"Metrics": ["sensitivity"], "Comments": "Sensitivity 91%."}}}
IDS = ("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222")
SITEMAP = "".join(f"<url><loc>https://atlas.rsna.org/cards/{card_id}</loc></url>" for card_id in IDS)


def fake_atlas(broken: set[str] = frozenset()):
    def fetch(url: str) -> str:
        if url.endswith("sitemap.xml"):
            return SITEMAP
        if url.rsplit("/", 1)[-1] in broken:
            raise OSError("page not reachable")
        if url.endswith(IDS[0]):
            return page(DATASET, "Liver MRI set", "MRI of the liver in children.")
        return page(MODEL, "FractureNet", "RSNA ATLAS is a hub for the imaging AI research community")
    return fetch


def test_cards_are_read_from_atlas_pages_and_described_by_their_own_content(tmp_path):
    library.reset_for_tests()
    library.configure(tmp_path)
    assert library.refresh_library(fake_atlas(), pause=0) == 2
    rows = {row["type"]: row for row in library.library_index()["cards"]}

    dataset = rows["dataset"]
    assert dataset["title"] == "Liver MRI set" and dataset["summary"] == "MRI of the liver in children."
    assert dataset["modalities"] == ["MRI"]                       # the MR content code adds nothing new
    assert dataset["subspecialties"] == ["Gastrointestinal", "Pediatric"]
    assert dataset["sizes"] == {"patient": 500}                   # not 950: the whole set is listed too
    assert dataset["population"] == "Pediatric" and dataset["ages"] == [2, 17]
    assert dataset["year"] == 2023 and dataset["license"] == "CC BY 4.0"
    assert "example university" in dataset["search"] and "rid58" in dataset["search"]

    model = rows["model"]
    assert model["summary"] == "Faster reads."                    # ATLAS's placeholder is not a description
    assert not model["has_atlas_description"]
    assert model["modalities"] == ["Radiography", "CT"]           # the CT content code is not lost
    assert model["tasks"] == ["Detection"] and model["metrics"] == ["sensitivity"]
    assert model["population"] == "Not stated" and model["year"] == 2024 and model["has_performance"]

    # the copy survives a restart, and one that fails keeps the last good cards
    library.reset_for_tests()
    library.configure(tmp_path)
    assert library.library_index()["count"] == 2
    assert library.refresh_library(lambda url: (_ for _ in ()).throw(OSError("offline")), pause=0) == 2
    assert library.library_index()["last_error"]
    assert library.refresh_library(fake_atlas(broken={IDS[1]}), pause=0) == 2   # one page down: kept


def test_library_addresses(tmp_path):
    library.reset_for_tests()
    library.configure(tmp_path)
    library.refresh_library(fake_atlas(), pause=0)
    client = TestClient(main.app)
    listing = client.get("/api/library").json()
    assert listing["count"] == 2 and listing["synced_at"]
    one = client.get(f"/api/library/{IDS[0]}").json()
    assert one["card"] == DATASET and one["facts"]["title"] == "Liver MRI set"
    assert client.get("/api/library/nothing").status_code == 404
    assert client.get("/api/health").json()["embed_origins"] == ["https://atlas.rsna.org"]
    library.reset_for_tests()


def test_a_dataset_given_only_as_splits_is_their_sum():
    parts = [{"Partition": "Training", "Total": {"Image count": 800}},
             {"Partition": "Test", "Total": {"Image count": 200}},
             {"Partition": "Other", "Total": {"Image count": 50, "Site count": 3}}]
    assert library._sizes(parts) == {"image": 1000, "site": 3}
