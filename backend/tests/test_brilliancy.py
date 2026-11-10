"""Mirrors web/src/core/brilliancy/brilliancy.test.ts (brill-v3)."""

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


SMOTHERED = "3r3k/6pp/7N/8/2Q5/8/6PP/6K1 w - - 0 1"  # 1.Qg8+!! Rxg8 2.Nf7#
M2 = {"kind": "mate", "moves": 2, "winner": "w", "perspective": "white"}


def test_queen_sacrifice_mating_next_move_counts_after_one_reply():
    s = detect_sacrifice(SMOTHERED, ["c4g8", "d8g8", "h6f7"])
    assert s["endsInMate"] and s["persistedCheckpoints"] == 1 and s["isSacrifice"]
    assert s["size"] == 9 and s["offered"] == 7


def test_queen_trade_offer_is_not_a_sacrifice():
    s = detect_sacrifice("3q2k1/5ppp/8/8/Q7/8/5PPP/3R2K1 w - - 0 1", ["a4d7", "d8d7", "d1d7", "h7h6"])
    assert not s["isSacrifice"] and s["offered"] == 0


def test_quiet_move_leaving_piece_hanging_is_a_sacrifice():
    s = detect_sacrifice("4r1k1/5ppp/8/4N3/8/8/5PPP/6K1 w - - 0 1", ["h2h3"])
    assert s["isSacrifice"] and s["offered"] == 3 and s["size"] == 3
    s = detect_sacrifice("4r1k1/5ppp/8/4N3/3P4/8/5PP1/6K1 w - - 0 1", ["g2g3"])
    assert not s["isSacrifice"] and s["offered"] == 0


def sac(size, offered=None):
    return {"isSacrifice": True, "maxDeficit": size, "persistedCheckpoints": 1, "finalDelta": -size, "endsInMate": True,
            "offered": size if offered is None else offered, "size": size, "inspectedPlies": 3, "note": "test sacrifice"}


def quick_mate(sacrifice=None):
    return base(
        shallow=shallow([(-800, 300, 35), (9000, 300, 1), (9000, 300, 1)]),
        trajectory=[{"depth": i + 1, "score": s} for i, s in enumerate([cp(-800)] + [M2] * 12)],
        deep={"depth": 13, "bestUci": "f3e5", "bestScore": M2, "secondScore": cp(300), "playedScore": M2},
        recheck={"depth": 15, "bestUci": "f3e5", "bestScore": M2, "playedScore": M2},
        sacrifice=sacrifice,
    )


def test_queen_sacrifice_with_short_mate_is_brilliant():
    e = evaluate_brilliance(quick_mate(sac(9)))
    assert e["signals"]["horizon"] == 1 and e["signals"]["sacrificeSize"] == 9
    assert e["signals"]["discoveryInterval"] == [1, 2]
    assert e["verdict"] == "brilliant"


def test_quick_payoff_without_big_sacrifice_is_not_brilliant():
    for s in (None, sac(5)):
        e = evaluate_brilliance(quick_mate(s))
        assert e["signals"]["horizon"] == 3 and e["verdict"] == "none"


def test_hanging_queen_looks_bad():
    inp = quick_mate(sac(9))
    inp["shallow"] = shallow([(300, 300, 1)])
    gate = lambda e: next(g for g in e["gates"] if g["name"] == "looks-bad-at-shallow-depth")["passed"]
    assert gate(evaluate_brilliance(inp))
    assert not gate(evaluate_brilliance({**inp, "sacrifice": sac(9, 0)}))


def test_sacrifice_bonus_scales_with_size():
    none, small, big = (evaluate_brilliance(base(sacrifice=s))["score"] for s in (None, sac(3), sac(5)))
    assert none < small < big
