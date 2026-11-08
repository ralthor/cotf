import pytest

pytestmark = pytest.mark.django_db


def cp(v):
    return {"kind": "cp", "value": v, "perspective": "white"}


def test_upload_browser_analysis_reclassifies_server_side(api, games):
    g = games["Blunder"]
    moves = [
        {"ply": 1, "uci": "e2e4", "bestMoveUci": "e2e4", "bestScore": cp(30), "playedScore": cp(30), "depth": 14,
         "category": "blunder"},  # client label ignored
        {"ply": 2, "uci": "d7d5", "bestMoveUci": "e7e5", "bestScore": cp(30), "playedScore": cp(60)},
        {"ply": 3, "uci": "d1g4", "bestMoveUci": "e4d5", "bestScore": cp(80), "playedScore": cp(-850)},
        {"ply": 4, "uci": "c8g4", "bestMoveUci": "c8g4", "bestScore": cp(-850), "playedScore": cp(-850)},
    ]
    r = api.post(f"/api/games/{g.id}/analysis/", {"presetId": "standard", "engineId": "Stockfish 19 [lite-single]",
                                                  "moves": moves, "positionEvals": [cp(20)] * 5}, format="json")
    assert r.status_code == 201, r.json()
    body = r.json()
    cats = [m["category"] for m in body["moves"]]
    assert cats == ["best", "good", "blunder", "best"]
    assert body["phase"] == "done"
    assert body["summary"]["white"]["counts"]["blunder"] == 1
    # Immutable: a second upload creates a second run.
    api.post(f"/api/games/{g.id}/analysis/", {"presetId": "fast", "engineId": "x", "moves": moves}, format="json")
    assert len(api.get(f"/api/games/{g.id}/analysis/").json()) == 2


def test_upload_rejects_mismatched_moves(api, games):
    g = games["Blunder"]
    r = api.post(f"/api/games/{g.id}/analysis/", {"presetId": "standard", "engineId": "x",
                                                  "moves": [{"ply": 1, "uci": "d2d4"}]}, format="json")
    assert r.status_code == 400
    r = api.post(f"/api/games/{g.id}/analysis/", {"presetId": "bogus", "moves": []}, format="json")
    assert r.status_code == 400


def test_stats(api, games):
    g = games["Blunder"]
    moves = [{"ply": i + 1, "uci": m.uci, "bestMoveUci": m.uci, "bestScore": cp(0), "playedScore": cp(0)}
             for i, m in enumerate(g.moves.all())]
    api.post(f"/api/games/{g.id}/analysis/", {"presetId": "standard", "engineId": "x", "moves": moves}, format="json")
    s = api.get("/api/stats/").json()
    assert s["games"] == 2 and s["results"] == {"win": 1, "loss": 1, "draw": 0}
    assert s["categories"]["best"] == 2  # only the user's (white) moves
    assert api.get("/api/stats/?time_class=rapid").json()["games"] == 1
