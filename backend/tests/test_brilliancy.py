"""Mirrors web/src/core/brilliancy/brilliancy.test.ts."""

from cloud.brilliancy import detect_sacrifice, evaluate_brilliance


def cp(v):
    return {"kind": "cp", "value": v, "perspective": "white"}


def shallow(ranks, sampled=30, legal=30):
    return [{"depth": i + 1, "playedRank": r, "sampledLines": sampled, "legalMoves": legal, "bestScore": cp(50)}
            for i, r in enumerate(ranks)]


def base(**over):
    traj = [-280, -310, -250, -200, -150, -60, 40, 300, 380, 420, 430, 440, 450, 450, 450, 450, 450, 450, 450, 450]
    d = {
        "mover": "w",
        "playedUci": "f1f7",
        "shallow": shallow([6, 7, 6, 5, 4, 3, 2, 1]),
        "trajectory": [{"depth": i + 1, "score": cp(v)} for i, v in enumerate(traj)],
        "deep": {"depth": 20, "bestUci": "f1f7", "bestScore": cp(450), "secondScore": cp(60), "playedScore": cp(450)},
        "recheck": {"depth": 24, "bestUci": "f1f7", "bestScore": cp(440), "secondScore": cp(50), "playedScore": cp(440)},
        "sacrifice": {"isSacrifice": True, "note": "rook sac"},
    }
    d.update(over)
    return d


def test_sound_reversal_is_brilliant():
    e = evaluate_brilliance(base())
    assert e["verdict"] == "brilliant"
    assert e["signals"]["shallowWorstRank"] == 7
    assert e["signals"]["discoveryInterval"] == [8, 9]
    assert e["confidence"] == "high"


def test_refuted_sacrifice_is_not_brilliant():
    e = evaluate_brilliance(base(deep={"depth": 20, "bestUci": "e2e4", "bestScore": cp(80), "secondScore": cp(60),
                                       "playedScore": cp(-350)}))
    assert e["verdict"] == "none"


def test_without_recheck_only_candidate():
    assert evaluate_brilliance(base(recheck=None))["verdict"] == "candidate"


def test_multipv2_rank_is_lower_bound():
    e = evaluate_brilliance(base(shallow=shallow([None, None, None, 2, 1, 1], 2, 30)))
    assert e["signals"]["shallowRankIsExact"] is False
    assert e["signals"]["shallowWorstRank"] == 3


def test_sacrifice_detection():
    assert detect_sacrifice("r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
                            ["a1a7", "a8a7", "h2h3", "g7g6", "g1h2", "h7h6"])["isSacrifice"]
    assert not detect_sacrifice("r2q2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", ["a1a8", "d8a8", "h2h3", "h7h6"])["isSacrifice"]
