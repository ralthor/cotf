"""Python port of web/src/core/brilliancy (brill-v1). Keep the two in sync; see docs/ALGORITHM_AND_TEST_CASES.md."""

from __future__ import annotations

import chess

from analysis.scoring import expected_score, sort_key

BRILLIANCY_VERSION = "brill-v2"
POLICY = {
    "horizon": 3,
    "min_shallow_loss_pct": 10,
    "min_deep_expected": 0.4,
    "best_tolerance_pct": 1.5,
    "min_uniqueness_pct": 8,
    "sound_tolerance_pct": 8,
    "min_sustained_depths": 3,
    "stability_tolerance_pct": 6,
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


def ordinal(n: int) -> str:
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def evaluate_brilliance(inp: dict, policy: dict = POLICY) -> dict:
    """Mirrors evaluateBrilliance() in web/src/core/brilliancy/detector.ts (brill-v2, camelCase keys)."""
    mover = inp["mover"]
    played_uci = inp["playedUci"]
    deep = inp["deep"]
    gates: list[dict] = []
    reasons: list[str] = []

    # 1. Shallow view (depths 1..horizon of a full-width search)
    shallow = sorted((s for s in inp["shallow"] if s["depth"] >= 1), key=lambda s: s["depth"])
    horizon = shallow[-1]["depth"] if shallow else 0
    view = []
    for s in shallow:
        best_pct = _pct(s["bestScore"], mover)
        played_pct = _pct(s["playedScore"], mover) if s.get("playedScore") else None
        view.append({
            "depth": s["depth"],
            "playedRank": s["playedRank"],
            "legalMoves": s["legalMoves"],
            "bestUci": s["bestUci"],
            "bestPct": best_pct,
            "playedPct": played_pct,
            "lossPct": None if played_pct is None else max(0.0, best_pct - played_pct),
        })
    at_h = view[-1] if view else None
    shallow_loss = at_h["lossPct"] if at_h else None
    gates.append({
        "name": "looks-bad-at-shallow-depth",
        "passed": shallow_loss is not None and shallow_loss >= policy["min_shallow_loss_pct"],
        "detail": "The played move was not measured at shallow depth." if shallow_loss is None else
        f"Searching {horizon} {'ply' if horizon == 1 else 'plies'} ahead, the move looks {shallow_loss:.1f} pts "
        f"worse than {at_h['bestUci']} (needs ≥ {policy['min_shallow_loss_pct']}).",
    })

    # 2. Best at depth
    deep_played = _pct(deep["playedScore"], mover)
    deep_best = _pct(deep["bestScore"], mover)
    deep_is_best = (
        deep["bestUci"] == played_uci
        or sort_key(deep["playedScore"], mover) >= sort_key(deep["bestScore"], mover)
        or deep_best - deep_played <= policy["best_tolerance_pct"]
    )
    gates.append({
        "name": "best-at-depth",
        "passed": deep_is_best and deep_played >= policy["min_deep_expected"] * 100,
        "detail": f"At depth {deep['depth']} the move is {'best/tied' if deep_is_best else 'not best'} "
                  f"with {deep_played:.1f}% expected score.",
    })

    # 3. Decisive
    gap = deep_best - _pct(deep["secondScore"], mover) if deep.get("secondScore") else None
    gates.append({
        "name": "decisive",
        "passed": gap is None or gap >= policy["min_uniqueness_pct"],
        "detail": "Only one sensible move was available." if gap is None else
        f"Best minus second-best at depth: {gap:.1f} pts (needs ≥ {policy['min_uniqueness_pct']}).",
    })

    # 4. Found beyond the horizon and sustained
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
    if discovery is None:
        detail = "The move never settled into a sound evaluation."
    elif discovery <= horizon:
        detail = f"Already sound at depth {discovery}, within the {horizon}-ply horizon."
    else:
        detail = f"Looked unsound up to depth {last_unsound}, sound from depth {discovery}" + ("" if sustained else " (not sustained)") + "."
    gates.append({
        "name": "found-beyond-horizon",
        "passed": discovery is not None and discovery > horizon and sustained,
        "detail": detail,
    })

    # 5. Same move, shallow vs deep
    within = [t for t in traj if t["depth"] <= horizon]
    inversion = deep_played - _pct(within[-1]["score"], mover) if within else None

    # 6. Stability
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
        30 * clamp01((shallow_loss or 0) / 30)
        + 25 * clamp01((inversion or 0) / 40)
        + 20 * clamp01((gap if gap is not None else policy["min_uniqueness_pct"]) / 25)
        + 15 * (1 if sacrifice else 0)
        + 10 * clamp01(((discovery or 0) - horizon) / 8)
    )
    hard = all(g["passed"] for g in gates if g["name"] != "stable-on-recheck")
    verdict = "none"
    if hard:
        verdict = "brilliant" if stable is True else "candidate" if stable is None else "none"

    if shallow_loss is not None and shallow_loss >= policy["min_shallow_loss_pct"]:
        rank = at_h["playedRank"]
        rank_txt = f"; {ordinal(rank)} of {at_h['legalMoves']} moves" if rank else ""
        reasons.append(f"A {horizon}-ply look rates it a mistake ({shallow_loss:.1f} pts worse than {at_h['bestUci']}{rank_txt}).")
    if deep_is_best:
        reasons.append(f"Best move at depth {deep['depth']}.")
    if gap is not None and gap >= policy["min_uniqueness_pct"]:
        reasons.append(f"Clearly better than the second-best move ({gap:.1f} pts).")
    if sacrifice:
        reasons.append(inp["sacrifice"]["note"])
    if interval:
        reasons.append(f"The engine finds it between depth {interval[0]} and {interval[1]}.")
    for g in gates:
        if not g["passed"]:
            reasons.append(f"Gate failed ({g['name']}): {g['detail']}")

    confidence = "high" if stable is True and deep["depth"] >= 20 else "medium" if stable is True else "low"
    return {
        "version": BRILLIANCY_VERSION,
        "verdict": verdict,
        "score": int(score + 0.5),  # same rounding as Math.round
        "confidence": confidence,
        "signals": {
            "horizon": horizon,
            "shallowLossPct": shallow_loss,
            "shallowRank": at_h["playedRank"] if at_h else None,
            "legalMoves": at_h["legalMoves"] if at_h else None,
            "shallowView": view,
            "deepRank": 1 if deep_is_best else None,
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
