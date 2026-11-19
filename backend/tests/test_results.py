from app import results
from conftest import FakeProvider

TEXT = ("On the internal test set (n = 65 patients) the model reached a Dice score of 0.943 "
        "(95% CI: 0.938, 0.947). Sensitivity was 91.1% on the external set; AUC 0.89–0.92 across sites.")


def test_only_numbers_that_are_in_the_text_are_kept():
    reply = ('{"results": ['
             '{"set": "Internal test set (n = 65 patients)", "metric": "Dice similarity coefficient", "value": "0.943", "detail": "95% CI: 0.938, 0.947"},'
             '{"set": "External set", "metric": "sensitivity", "value": "91.1%", "detail": ""},'
             '{"set": "Across sites", "metric": "AUC", "value": "0.89-0.92", "detail": ""},'   # plain hyphen for the text's dash: same number
             '{"set": "External set", "metric": "specificity", "value": "94.0%", "detail": ""},'  # not in the text
             '{"set": "External set", "metric": "sensitivity", "value": "0.911", "detail": ""},'  # converted, not printed
             '{"set": "x", "metric": "accuracy", "value": "high", "detail": ""}]}')             # not a number
    provider = FakeProvider(reply)
    kept, dropped, usage = results.read_results(provider, ["Dice similarity coefficient", "sensitivity"], TEXT)
    assert [row["value"] for row in kept] == ["0.943", "91.1%", "0.89-0.92"]
    assert dropped == 3 and usage["input_tokens"] == 10
    assert "Dice similarity coefficient" in provider.calls[0]["user"] and TEXT in provider.calls[0]["user"]


def test_a_reading_belongs_to_one_exact_text(tmp_path):
    results.configure(None)
    key = results.fingerprint(TEXT)
    assert results.fingerprint("  " + TEXT.replace(" ", "  ")) == key       # spacing does not matter
    assert results.fingerprint(TEXT.replace("0.943", "0.944")) != key      # any other change does
    results._save(tmp_path / "atlas-library" / "metric_results.json", {key: [{"set": "s", "metric": "m", "value": "0.943", "detail": ""}]}, "fake-1")
    results.configure(tmp_path)
    assert results.results_for(TEXT)[0]["value"] == "0.943"
    assert results.results_for(TEXT.replace("0.943", "0.944")) is None
    results.configure(None)


def test_a_bad_reply_gives_no_results():
    kept, dropped, _ = results.read_results(FakeProvider("sorry, I cannot"), [], TEXT)
    assert kept == [] and dropped == 0
