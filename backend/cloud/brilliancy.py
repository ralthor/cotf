"""Python port of web/src/core/brilliancy (brill-v1). Keep the two in sync; see docs/ALGORITHM_AND_TEST_CASES.md."""

from __future__ import annotations

import chess

from analysis.scoring import expected_score, sort_key

BRILLIANCY_VERSION = "brill-v1"
POLICY = {
    "min_deep_expected": 0.4,
    "best_tolerance_pct": 1.5,
    "min_shallow_rank": 3,
    "min_inversion_pct": 15,
    "min_discovery_depth": 4,
    "min_sustained_depths": 3,
    "sound_tolerance_pct": 8,
    "stability_tolerance_pct": 6,
    "brilliant_score": 55,
    "candidate_score": 40,
}
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def material_balance(board: chess.Board, colour: bool) -> int:
    bal = 0
    for piece in board.piece_map().values():
        bal += VALUES[piece.piece_type] * (1 if piece.color == chess.WHITE else -1)
    return bal if colour == chess.WHITE else -bal


def detect_sacrifice(fen_before: str, line_uci: list[str], min_deficit: int = 2, min_checkpoints: int = 2,
                     max_plies: int = 10) -> dict:
    board = chess.Board(fen_before)
    mover = board.turn
    start = material_balance(board, mover)
    max_deficit = run = best_run = inspected = 0
    for uci in line_uci[:max_plies]:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        board.push(move)
        inspected += 1
        if board.turn != mover:
            continue
        deficit = start - material_balance(board, mover)
        if deficit >= min_deficit:
            run += 1
            best_run = max(best_run, run)
            max_deficit = max(max_deficit, deficit)
        else:
            run = 0
    is_sac = best_run >= min_checkpoints and max_deficit >= min_deficit
    return {
        "isSacrifice": is_sac,
        "maxDeficit": max_deficit,
        "persistedCheckpoints": best_run,
        "finalDelta": material_balance(board, mover) - start,
        "inspectedPlies": inspected,
        "note": (
            f"Mover stays {max_deficit} pawn(s) of material down for {best_run} replies along the engine line."
            if is_sac
            else "No sustained material deficit; captures and exchanges balance out."
        ),
    }


def _pct(score: dict, mover: str) -> float:
    return expected_score(score, mover) * 100


def evaluate_brilliance(inp: dict, policy: dict = POLICY) -> dict:
    """inp mirrors BrillianceInput in detector.ts (camelCase keys)."""
    mover = inp["mover"]
    played_uci = inp["playedUci"]
    deep = inp["deep"]
    gates: list[dict] = []
    reasons: list[str] = []

    deep_played = _pct(deep["playedScore"], mover)
    deep_best = _pct(deep["bestScore"], mover)
    deep_is_best = (
        deep["bestUci"] == played_uci
        or sort_key(deep["playedScore"], mover) >= sort_key(deep["bestScore"], mover)
        or deep_best - deep_played <= policy["best_tolerance_pct"]
    )
    gates.append({
        "name": "deep-quality",
        "passed": deep_is_best and deep_played >= policy["min_deep_expected"] * 100,
        "detail": f"At depth {deep['depth']} the move is {'best/tied' if deep_is_best else 'not best'} "
                  f"with {deep_played:.1f}% expected score.",
    })

    shallow = [s for s in inp["shallow"] if s["depth"] >= 1]
    worst_rank = None
    exact = True
    for s in shallow:
        is_exact = s["playedRank"] is not None or s["sampledLines"] >= s["legalMoves"]
        rank = s["playedRank"] if s["playedRank"] is not None else s["sampledLines"] + 1
        if not is_exact:
            exact = False
        worst_rank = rank if worst_rank is None else max(worst_rank, rank)
    max_shallow_depth = max([s["depth"] for s in shallow], default=0)
    worst_exp = None
    for t in inp["trajectory"]:
        if t["depth"] > max_shallow_depth:
            continue
        p = _pct(t["score"], mover)
        worst_exp = p if worst_exp is None else min(worst_exp, p)
    rank_reversal = worst_rank is not None and worst_rank >= policy["min_shallow_rank"]
    inversion = None if worst_exp is None else deep_played - worst_exp
    inverted = inversion is not None and inversion >= policy["min_inversion_pct"]
    gates.append({
        "name": "overlooked-at-shallow-depth",
        "passed": rank_reversal or inverted,
        "detail": f"Worst shallow rank {worst_rank if worst_rank is not None else 'n/a'}"
                  f"{'' if exact else ' (lower bound)'}; inversion "
                  f"{'n/a' if inversion is None else f'{inversion:.1f}'} pts.",
    })

    traj = sorted(inp["trajectory"], key=lambda t: t["depth"])
    discovery = None
    last_unsound = None
    for t in traj:
        sound = _pct(t["score"], mover) >= deep_played - policy["sound_tolerance_pct"]
        if not sound:
            last_unsound = t["depth"]
            discovery = None
        elif discovery is None:
            discovery = t["depth"]
    if last_unsound is None and traj:
        discovery = traj[0]["depth"]
    interval = [last_unsound, discovery] if discovery is not None and last_unsound is not None else None
    sustained = discovery is not None and len([t for t in traj if t["depth"] >= discovery]) >= policy["min_sustained_depths"]
    gates.append({
        "name": "sustained-discovery",
        "passed": discovery is not None and last_unsound is not None
        and discovery >= policy["min_discovery_depth"] and sustained,
        "detail": "The move never settled into a sound evaluation." if discovery is None
        else f"Already sound from depth {discovery}; nothing to discover." if last_unsound is None
        else f"Looked unsound up to depth {last_unsound}, stays sound from depth {discovery}.",
    })

    gap = deep_best - _pct(deep["secondScore"], mover) if deep.get("secondScore") else None

    stable = None
    recheck = inp.get("recheck")
    if recheck:
        re_played = _pct(recheck["playedScore"], mover)
        re_best = _pct(recheck["bestScore"], mover)
        stable = abs(re_played - deep_played) <= policy["stability_tolerance_pct"] and (
            recheck["bestUci"] == played_uci or re_best - re_played <= policy["best_tolerance_pct"]
        )
        gates.append({
            "name": "stable-on-recheck",
            "passed": stable,
            "detail": f"Recheck at depth {recheck['depth']}: {re_played:.1f}% vs {deep_played:.1f}%.",
        })

    sacrifice = bool((inp.get("sacrifice") or {}).get("isSacrifice"))

    def clamp01(x: float) -> float:
        return max(0.0, min(1.0, x))

    score = (
        30 * clamp01((inversion or 0) / 40)
        + 25 * clamp01(((worst_rank or 1) - 1) / 5)
        + 20 * clamp01((gap or 0) / 25)
        + 15 * (1 if sacrifice else 0)
        + 10 * clamp01((discovery or 0) / 12)
    )
    hard = all(g["passed"] for g in gates if g["name"] != "stable-on-recheck")
    verdict = "none"
    if hard and score >= policy["candidate_score"]:
        verdict = "candidate"
    if hard and stable is True and score >= policy["brilliant_score"]:
        verdict = "brilliant"
    if stable is False:
        verdict = "none"

    if rank_reversal:
        reasons.append(f"Ranked #{worst_rank}{'' if exact else '+'} at shallow depth, #1 at depth {deep['depth']}.")
    if inverted:
        reasons.append(f"Same move gained {inversion:.1f} expected-score points from shallow to deep search.")
    if gap is not None and gap >= 10:
        reasons.append(f"Clearly better than the second-best move ({gap:.1f} pts).")
    if sacrifice:
        reasons.append(inp["sacrifice"]["note"])
    if interval:
        reasons.append(f"Discovered between depth {interval[0]} and {interval[1]}.")
    for g in gates:
        if not g["passed"]:
            reasons.append(f"Gate failed ({g['name']}): {g['detail']}")

    confidence = "high" if stable is True and exact and deep["depth"] >= 20 else "medium" if stable is True else "low"
    return {
        "version": BRILLIANCY_VERSION,
        "verdict": verdict,
        "score": int(score + 0.5),  # same rounding as Math.round
        "confidence": confidence,
        "signals": {
            "shallowWorstRank": worst_rank,
            "shallowRankIsExact": exact,
            "deepRank": 1 if deep_is_best else None,
            "shallowWorstExpectedPct": worst_exp,
            "deepExpectedPct": deep_played,
            "inversionPct": inversion,
            "uniquenessGapPct": gap,
            "discoveryDepth": discovery,
            "discoveryInterval": interval,
            "sacrifice": sacrifice,
            "stable": stable,
        },
        "gates": gates,
        "reasons": reasons,
    }
