import json
from pathlib import Path

from analysis.scoring import ACCURACY_VERSION, DEFAULT_POLICY, classify_move, game_accuracy

FIXTURE = json.loads((Path(__file__).resolve().parents[2] / "shared" / "classifier-cases.json").read_text())


def test_versions_match_fixture():
    assert FIXTURE["policyVersion"] == DEFAULT_POLICY.version
    assert FIXTURE["accuracyVersion"] == ACCURACY_VERSION


def test_classifier_parity_with_typescript():
    for c in FIXTURE["cases"]:
        r = classify_move(c["mover"], c["playedUci"], c["bestUci"], c["best"], c["played"],
                          c.get("forced", False), c.get("brilliant", False))
        assert r.category == c["expected"], c["name"]
        assert r.loss.centipawn_loss == c["expectedCpl"], c["name"]


def test_accuracy_parity():
    r = game_accuracy([(x, False) for x in FIXTURE["accuracy"]["losses"]])
    assert r["value"] == 80.6
    assert game_accuracy([(0, False)])["scoredMoves"] == 1
    assert "value" not in game_accuracy([(0, False)])
