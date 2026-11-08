"""Python port of web/src/core/scoring + web/src/core/classification (cls-v1, acc-v1).

Scores use the same JSON shape as the frontend (white-relative):
  {"kind": "cp", "value": 35, "perspective": "white"}
  {"kind": "mate", "moves": 3, "winner": "w", "perspective": "white"}
Parity with the TypeScript implementation is enforced by shared/classifier-cases.json.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

CP_LOGISTIC_K = 0.00368208
MATE_SORT_BASE = 100_000
ACCURACY_VERSION = "acc-v1"
ACC_DECAY = 0.045
MIN_MOVES = 5


@dataclass(frozen=True)
class Policy:
    version: str = "cls-v1"
    best_max_loss_pct: float = 1.0
    best_max_cp_loss: float = 10
    good_max_loss_pct: float = 4
    questionable_max_loss_pct: float = 10
    mistake_max_loss_pct: float = 20


DEFAULT_POLICY = Policy()
CATEGORIES = ["brilliant", "best", "good", "questionable", "mistake", "blunder"]


def cp_for(score: dict, colour: str) -> float | None:
    if score["kind"] != "cp":
        return None
    return score["value"] if colour == "w" else -score["value"]


def sort_key(score: dict, colour: str) -> float:
    if score["kind"] == "cp":
        return cp_for(score, colour)  # type: ignore[return-value]
    good = score["winner"] == colour
    return MATE_SORT_BASE - score["moves"] if good else -MATE_SORT_BASE + score["moves"]


def expected_score(score: dict, colour: str, wdl: dict | None = None) -> float:
    if score["kind"] == "mate":
        return 1.0 if score["winner"] == colour else 0.0
    if wdl:
        total = wdl["win"] + wdl["draw"] + wdl["loss"]
        if total > 0:
            white_exp = (wdl["win"] + wdl["draw"] / 2) / total
            return white_exp if colour == "w" else 1 - white_exp
    cp = cp_for(score, colour)
    return 1 / (1 + math.exp(-CP_LOGISTIC_K * cp))


@dataclass
class MoveLoss:
    centipawn_loss: float | None
    expected_loss_pct: float
    matches_best: bool


def move_loss(best: dict, played: dict, mover: str) -> MoveLoss:
    b, p = cp_for(best, mover), cp_for(played, mover)
    cpl = max(0.0, b - p) if b is not None and p is not None else None
    e = max(0.0, (expected_score(best, mover) - expected_score(played, mover)) * 100)
    return MoveLoss(cpl, e, sort_key(played, mover) >= sort_key(best, mover))


@dataclass
class Classification:
    category: str
    loss: MoveLoss
    reasons: list[str] = field(default_factory=list)
    policy_version: str = DEFAULT_POLICY.version


def classify_move(
    mover: str,
    played_uci: str,
    best_uci: str | None,
    best: dict,
    played: dict,
    forced: bool = False,
    brilliant: bool = False,
    policy: Policy = DEFAULT_POLICY,
) -> Classification:
    loss = move_loss(best, played, mover)
    reasons: list[str] = []

    def done(cat: str) -> Classification:
        return Classification(cat, loss, reasons, policy.version)

    is_top = best_uci is not None and best_uci == played_uci
    best_mates = best["kind"] == "mate" and best["winner"] == mover
    played_mates = played["kind"] == "mate" and played["winner"] == mover
    played_mated = played["kind"] == "mate" and played["winner"] != mover
    best_mated = best["kind"] == "mate" and best["winner"] != mover
    slower_mate = best_mates and played_mates and played["moves"] > best["moves"]
    tied = not slower_mate and (
        loss.matches_best
        or (
            loss.expected_loss_pct <= policy.best_max_loss_pct
            and (loss.centipawn_loss is None or loss.centipawn_loss <= policy.best_max_cp_loss)
        )
    )
    if brilliant and (is_top or tied):
        reasons.append("Passed the depth-reversal brilliancy checks and is best at the deepest search.")
        return done("brilliant")
    if forced:
        reasons.append("Only legal move.")
        return done("best")
    if is_top or tied:
        reasons.append("Engine's top choice." if is_top else "Effectively tied with the top choice.")
        return done("best")
    if played_mated and not best_mated:
        reasons.append("Allows a forced mate that could have been avoided.")
        return done("blunder")
    if best_mates and not played_mates:
        reasons.append("Misses a forced mate.")
        return done("blunder" if loss.expected_loss_pct > policy.questionable_max_loss_pct else "mistake")
    if best_mates and played_mates:
        reasons.append("Still mates, but slower than the fastest mate.")
        return done("good")
    lp = loss.expected_loss_pct
    reasons.append(f"Expected score drops by {lp:.1f} percentage points.")
    if lp <= policy.good_max_loss_pct:
        return done("good")
    if lp <= policy.questionable_max_loss_pct:
        return done("questionable")
    if lp <= policy.mistake_max_loss_pct:
        return done("mistake")
    return done("blunder")


def move_accuracy(expected_loss_pct: float) -> float:
    return 100 * math.exp(-ACC_DECAY * max(0.0, expected_loss_pct))


def game_accuracy(moves: list[tuple[float | None, bool]]) -> dict:
    """moves: (expected_loss_pct or None, forced). Mirrors gameAccuracy() in accuracy.ts."""
    eligible = [m for m in moves if not m[1]]
    scored = [m for m in eligible if m[0] is not None]
    result = {
        "version": ACCURACY_VERSION,
        "scoredMoves": len(scored),
        "totalMoves": len(eligible),
        "provisional": len(scored) < len(eligible),
    }
    if len(scored) >= MIN_MOVES:
        mean = sum(move_accuracy(m[0]) for m in scored) / len(scored)  # type: ignore[arg-type]
        result["value"] = round(mean * 10) / 10
    return result


def summarise(moves: list[dict]) -> dict:
    """moves: per-ply dicts with colour, category, centipawnLoss, expectedLossPct, forced."""
    out = {}
    for colour, key in (("w", "white"), ("b", "black")):
        own = [m for m in moves if m.get("colour") == colour]
        counts = {c: 0 for c in CATEGORIES}
        cpl = []
        for m in own:
            if m.get("category") in counts:
                counts[m["category"]] += 1
            if m.get("centipawnLoss") is not None and not m.get("forced"):
                cpl.append(min(m["centipawnLoss"], 1000))
        out[key] = {
            "accuracy": game_accuracy([(m.get("expectedLossPct"), bool(m.get("forced"))) for m in own]),
            "averageCpLoss": round(sum(cpl) / len(cpl)) if cpl else None,
            "counts": counts,
        }
    return out
