"""Python port of web/src/core/brilliancy (brill-v3). Keep the two in sync; see docs/ALGORITHM_AND_TEST_CASES.md."""

from __future__ import annotations

import chess

from analysis.scoring import expected_score, sort_key

BRILLIANCY_VERSION = "brill-v3"
POLICY = {
    "horizon": 3,
    "min_shallow_loss_pct": 10,
    "min_deep_expected": 0.4,
    "best_tolerance_pct": 1.5,
    "min_uniqueness_pct": 8,
    "sound_tolerance_pct": 8,
    "min_sustained_depths": 3,
    "stability_tolerance_pct": 6,
    "big_sacrifice_min": 8,
    "big_sacrifice_horizon": 1,
    "big_sacrifice_hanging_min": 5,
}
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def material_balance(board: chess.Board, colour: bool) -> int:
    bal = 0
    for piece in board.piece_map().values():
        bal += VALUES[piece.piece_type] * (1 if piece.color == chess.WHITE else -1)
    return bal if colour == chess.WHITE else -bal


ATTACKER_ORDER = {**VALUES, chess.KING: 100}


def static_exchange(board: chess.Board, square: int) -> int:
    """Material the side to move wins by starting a capture sequence on `square` (least valuable
    attacker first, free to stop). Legal moves only, so pins and checks are respected."""
    gains: list[int] = []
    made = 0
    while True:
        caps = [m for m in board.legal_moves
                if m.to_square == square and board.piece_at(square) is not None and not board.is_en_passant(m)]
        if not caps:
            break
        cap = min(caps, key=lambda m: ATTACKER_ORDER[board.piece_type_at(m.from_square)])
        gains.append(VALUES[board.piece_type_at(square)])
        board.push(cap)
        made += 1
    for _ in range(made):
        board.pop()
    res = 0
    for g in reversed(gains):
        res = max(0, g - res)
    return res


def _max_capture_gain(board: chess.Board) -> int:
    victim = not board.turn
    best = 0
    for sq, piece in board.piece_map().items():
        if piece.color == victim and piece.piece_type != chess.KING:
            best = max(best, static_exchange(board, sq))
    return best


def detect_sacrifice(fen_before: str, line_uci: list[str], min_deficit: int = 2, min_checkpoints: int = 2,
                     max_plies: int = 10) -> dict:
    """Mirrors detectSacrifice() in web/src/core/brilliancy/sacrifice.ts."""
    board = chess.Board(fen_before)
    mover = board.turn
    start = material_balance(board, mover)
    max_deficit = run = best_run = inspected = offered = 0
    for uci in line_uci[:max_plies]:
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            break
        if move not in board.legal_moves:
            break
        board.push(move)
        inspected += 1
        if inspected == 1:
            gained_by_move = material_balance(board, mover) - start
            offered = max(0, _max_capture_gain(board) - gained_by_move)
        if board.turn != mover:
            continue
        deficit = start - material_balance(board, mover)
        if deficit >= min_deficit:
            run += 1
            best_run = max(best_run, run)
            max_deficit = max(max_deficit, deficit)
        else:
            run = 0
    ends_in_mate = inspected > 0 and board.is_checkmate() and board.turn != mover
    line_sac = best_run >= (1 if ends_in_mate else min_checkpoints) and max_deficit >= min_deficit
    offered_sac = offered >= min_deficit
    is_sac = line_sac or offered_sac
    size = max(max_deficit if line_sac else 0, offered if offered_sac else 0)
    parts = []
    if line_sac:
        parts.append(
            f"Mover gives up {max_deficit} pawn(s) of material and mates." if ends_in_mate and best_run < min_checkpoints
            else f"Mover stays {max_deficit} pawn(s) of material down for {best_run} replies along the engine line."
        )
    if offered_sac:
        parts.append(f"After the move the opponent can win {offered} pawn(s) of material by capturing.")
    if is_sac:
        note = " ".join(parts)
    elif inspected == 0:
        note = "No line available to inspect."
    else:
        note = "No sustained material deficit; captures and exchanges balance out."
    return {
        "isSacrifice": is_sac,
        "maxDeficit": max_deficit,
        "persistedCheckpoints": best_run,
        "finalDelta": material_balance(board, mover) - start,
        "endsInMate": ends_in_mate,
        "offered": offered,
        "size": size,
        "inspectedPlies": inspected,
        "note": note,
    }


def _pct(score: dict, mover: str) -> float:
    return expected_score(score, mover) * 100


def ordinal(n: int) -> str:
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def evaluate_brilliance(inp: dict, policy: dict = POLICY) -> dict:
    """Mirrors evaluateBrilliance() in web/src/core/brilliancy/detector.ts (brill-v3, camelCase keys)."""
    mover = inp["mover"]
    played_uci = inp["playedUci"]
    deep = inp["deep"]
    gates: list[dict] = []
    reasons: list[str] = []

    # 1. Shallow view (depths 1..horizon of a full-width search)
    sac_in = inp.get("sacrifice") or {}
    sacrifice = bool(sac_in.get("isSacrifice"))
    sacrifice_size = (sac_in.get("size", sac_in.get("maxDeficit", 0)) or 0) if sacrifice else 0
    offered = sac_in.get("offered", 0) or 0
    big_sacrifice = sacrifice_size >= policy["big_sacrifice_min"]
    sampled = sorted((s for s in inp["shallow"] if s["depth"] >= 1), key=lambda s: s["depth"])
    full_horizon = sampled[-1]["depth"] if sampled else 0
    horizon = min(full_horizon, policy["big_sacrifice_horizon"]) if big_sacrifice else full_horizon
    shallow = [s for s in sampled if s["depth"] <= horizon]
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
    looks_bad_engine = shallow_loss is not None and shallow_loss >= policy["min_shallow_loss_pct"]
    looks_bad_hanging = big_sacrifice and offered >= policy["big_sacrifice_hanging_min"]
    horizon_note = f" (short horizon for a {sacrifice_size}-pawn sacrifice)" if big_sacrifice else ""
    detail = "The played move was not measured at shallow depth." if shallow_loss is None else (
        f"Searching {horizon} {'ply' if horizon == 1 else 'plies'} ahead{horizon_note}, the move looks {shallow_loss:.1f} pts "
        f"worse than {at_h['bestUci']} (needs ≥ {policy['min_shallow_loss_pct']}).")
    if looks_bad_hanging and not looks_bad_engine:
        detail += f" The opponent can take {offered} pawns of material outright."
    gates.append({
        "name": "looks-bad-at-shallow-depth",
        "passed": looks_bad_engine or looks_bad_hanging,
        "detail": detail,
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

    def clamp01(x: float) -> float:
        return max(0.0, min(1.0, x))

    score = (
        30 * clamp01((shallow_loss or 0) / 30)
        + 25 * clamp01((inversion or 0) / 40)
        + 20 * clamp01((gap if gap is not None else policy["min_uniqueness_pct"]) / 25)
        + ((5 + 10 * min(sacrifice_size, 9) / 9) if sacrifice else 0)
        + 10 * clamp01(((discovery or 0) - horizon) / 8)
    )
    hard = all(g["passed"] for g in gates if g["name"] != "stable-on-recheck")
    verdict = "none"
    if hard:
        verdict = "brilliant" if stable is True else "candidate" if stable is None else "none"

    if looks_bad_engine:
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
            "sacrificeSize": sacrifice_size,
            "offered": offered,
            "stable": stable,
        },
        "gates": gates,
        "reasons": reasons,
    }
