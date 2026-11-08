"""Mirrors web/src/core/brilliancy/brilliancy.test.ts (brill-v2)."""

from cloud.brilliancy import detect_sacrifice, evaluate_brilliance, ordinal


def cp(v):
    return {"kind": "cp", "value": v, "perspective": "white"}


def shallow(rows, legal=30):
    return [{"depth": i + 1, "playedRank": rank, "sampledLines": legal, "legalMoves": legal, "bestUci": "g1f3",
             "bestScore": cp(best), "playedScore": cp(played)} for i, (played, best, rank) in enumerate(rows)]


def base(**over):
    traj = [-650, -600, -600, -580, -300, 120, 140, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150]
    d = {
        "mover": "w",
        "playedUci": "f3e5",
        "shallow": shallow([(-650, 40, 30), (-600, 35, 29), (-600, 30, 28)]),
        "trajectory": [{"depth": i + 1, "score": cp(v)} for i, v in enumerate(traj)],
        "deep": {"depth": 18, "bestUci": "f3e5", "bestScore": cp(150), "secondScore": cp(20), "playedScore": cp(150)},
        "recheck": {"depth": 20, "bestUci": "f3e5", "bestScore": cp(155), "secondScore": cp(25), "playedScore": cp(155)},
    }
    d.update(over)
    return d


def test_looks_bad_within_horizon_but_decisive_best_is_brilliant():
    e = evaluate_brilliance(base())
    assert e["verdict"] == "brilliant"
    assert e["signals"]["horizon"] == 3
    assert e["signals"]["discoveryInterval"] == [5, 6]
    assert "28th of 30" in " ".join(e["reasons"])


def test_low_rank_in_already_winning_position_is_not_brilliant():
    e = evaluate_brilliance(base(
        shallow=shallow([(409, 804, 26), (409, 879, 26), (548, 897, 26)], 34),
        trajectory=[{"depth": i + 1, "score": cp(v)} for i, v in enumerate(
            [409, 409, 548, 357, 455, 455, 455, 700, 720, 730, 735, 740, 740, 740])],
        deep={"depth": 14, "bestUci": "f3e5", "bestScore": cp(740), "secondScore": cp(700), "playedScore": cp(740)},
        recheck={"depth": 16, "bestUci": "f3e5", "bestScore": cp(735), "secondScore": cp(690), "playedScore": cp(735)},
    ))
    assert e["verdict"] == "none"
    assert not next(g for g in e["gates"] if g["name"] == "decisive")["passed"]


def test_found_within_horizon_is_not_brilliant():
    e = evaluate_brilliance(base(trajectory=[{"depth": i + 1, "score": cp(v)} for i, v in enumerate([-600] + [150] * 7)]))
    assert e["verdict"] == "none"


def test_refuted_sacrifice_is_not_brilliant():
    e = evaluate_brilliance(base(deep={"depth": 18, "bestUci": "g1f3", "bestScore": cp(40), "secondScore": cp(30),
                                       "playedScore": cp(-600)}))
    assert e["verdict"] == "none"


def test_without_recheck_only_candidate():
    assert evaluate_brilliance(base(recheck=None))["verdict"] == "candidate"


def test_ordinal():
    assert [ordinal(n) for n in (1, 2, 3, 11, 12, 21, 26)] == ["1st", "2nd", "3rd", "11th", "12th", "21st", "26th"]


def test_sacrifice_detection():
    assert detect_sacrifice("r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
                            ["a1a7", "a8a7", "h2h3", "g7g6", "g1h2", "h7h6"])["isSacrifice"]
    assert not detect_sacrifice("r2q2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", ["a1a8", "d8a8", "h2h3", "h7h6"])["isSacrifice"]
