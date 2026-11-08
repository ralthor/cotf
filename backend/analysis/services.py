"""Storing analysis runs (from the browser or a cloud worker) and shaping them for the frontend."""

from __future__ import annotations

from django.db import transaction

from games.models import Game

from .models import AnalysisRun, MoveClassification
from .scoring import ACCURACY_VERSION, DEFAULT_POLICY, classify_move, summarise

SCORE_KINDS = {"cp", "mate"}


class AnalysisValidationError(ValueError):
    pass


def _valid_score(s) -> dict | None:
    if s is None:
        return None
    if not isinstance(s, dict) or s.get("kind") not in SCORE_KINDS:
        raise AnalysisValidationError("Invalid score object.")
    if s["kind"] == "cp":
        v = s.get("value")
        if not isinstance(v, (int, float)) or abs(v) > 100_000:
            raise AnalysisValidationError("Invalid centipawn score.")
        return {"kind": "cp", "value": int(v), "perspective": "white"}
    moves, winner = s.get("moves"), s.get("winner")
    if not isinstance(moves, int) or moves < 0 or winner not in ("w", "b"):
        raise AnalysisValidationError("Invalid mate score.")
    return {"kind": "mate", "moves": moves, "winner": winner, "perspective": "white"}


def build_move_rows(game: Game, moves_in: list[dict | None]) -> list[dict]:
    """Validates per-move results against the stored game and re-classifies server-side (cls-v1)."""
    game_moves = {m.ply: m for m in game.moves.all()}
    rows: list[dict] = []
    for item in moves_in:
        if not item:
            continue
        ply = item.get("ply")
        gm = game_moves.get(ply)
        if gm is None or item.get("uci") != gm.uci:
            raise AnalysisValidationError(f"Move at ply {ply} does not match the stored game.")
        best = _valid_score(item.get("bestScore"))
        played = _valid_score(item.get("playedScore"))
        second = _valid_score(item.get("secondScore"))
        forced = gm.legal_move_count <= 1
        brilliance = item.get("brilliance") if isinstance(item.get("brilliance"), dict) else None
        row = {
            "ply": ply,
            "colour": gm.colour,
            "san": gm.san,
            "uci": gm.uci,
            "depth": int(item.get("depth") or 0),
            "best_move_uci": str(item.get("bestMoveUci") or "")[:8],
            "best_score": best,
            "played_score": played,
            "second_score": second,
            "lines": item.get("lines") if isinstance(item.get("lines"), list) else [],
            "forced": forced,
            "brilliance": brilliance,
            "category": "",
            "centipawn_loss": None,
            "expected_loss_pct": None,
            "reasons": [],
        }
        if best and played:
            c = classify_move(
                gm.colour, gm.uci, row["best_move_uci"] or None, best, played, forced,
                brilliant=bool(brilliance and brilliance.get("verdict") == "brilliant"),
            )
            row.update(
                category=c.category,
                centipawn_loss=c.loss.centipawn_loss,
                expected_loss_pct=round(c.loss.expected_loss_pct, 3),
                reasons=c.reasons,
            )
        rows.append(row)
    return rows


@transaction.atomic
def create_run(
    game: Game,
    *,
    source: str,
    profile: str,
    engine_id: str,
    engine_version: str = "",
    settings: dict | None = None,
    moves: list[dict | None],
    position_evals: list | None = None,
    brilliancy_version: str = "",
    stats: dict | None = None,
) -> AnalysisRun:
    rows = build_move_rows(game, moves)
    complete = len(rows) == game.ply_count and all(r["category"] for r in rows)
    summary = summarise(
        [
            {
                "colour": r["colour"],
                "category": r["category"],
                "centipawnLoss": r["centipawn_loss"],
                "expectedLossPct": r["expected_loss_pct"],
                "forced": r["forced"],
            }
            for r in rows
        ]
    )
    if game.provider_accuracy:
        summary["white"]["providerAccuracy"] = game.provider_accuracy.get("white")
        summary["black"]["providerAccuracy"] = game.provider_accuracy.get("black")
    evals = [_valid_score(e) if e else None for e in (position_evals or [])][: game.ply_count + 1]
    run = AnalysisRun.objects.create(
        game=game,
        source=source,
        profile=profile[:32],
        engine_id=engine_id[:120],
        engine_version=engine_version[:40],
        settings=settings or {},
        policy_version=DEFAULT_POLICY.version,
        accuracy_version=ACCURACY_VERSION,
        brilliancy_version=brilliancy_version[:16],
        status=AnalysisRun.Status.COMPLETE if complete else AnalysisRun.Status.PARTIAL,
        summary=summary,
        position_evals=evals,
        stats=stats or {},
    )
    MoveClassification.objects.bulk_create([MoveClassification(run=run, **r) for r in rows])
    return run


def run_to_frontend(run: AnalysisRun) -> dict:
    """Shapes a run like the frontend's GameAnalysis type so the same UI can render it."""
    n = run.game.ply_count
    by_ply = {m.ply: m for m in run.moves.all()}
    moves = []
    for ply in range(1, n + 1):
        m = by_ply.get(ply)
        if m is None:
            moves.append(None)
            continue
        moves.append(
            {
                "ply": m.ply,
                "colour": m.colour,
                "san": m.san,
                "uci": m.uci,
                "depth": m.depth,
                "bestMoveUci": m.best_move_uci or None,
                "bestScore": m.best_score,
                "playedScore": m.played_score,
                "secondScore": m.second_score,
                "lines": m.lines,
                "loss": None
                if m.expected_loss_pct is None
                else {"centipawnLoss": m.centipawn_loss, "expectedLossPct": m.expected_loss_pct, "matchesBest": False},
                "category": m.category or None,
                "reasons": m.reasons,
                "forced": m.forced,
                "provisional": False,
                "passes": [run.source],
                "brilliance": m.brilliance,
            }
        )
    evals = list(run.position_evals) + [None] * max(0, n + 1 - len(run.position_evals))
    return {
        "id": run.id,
        "gameId": f"server:{run.game_id}",
        "presetId": "cloud" if run.source == "cloud" else run.profile.removeprefix("browser-"),
        "engineId": run.engine_id,
        "policyVersion": run.policy_version,
        "accuracyVersion": run.accuracy_version,
        "brilliancyVersion": run.brilliancy_version,
        "moves": moves,
        "positionEvals": evals,
        "phase": "done" if run.status == AnalysisRun.Status.COMPLETE else "cancelled",
        "progress": {"done": 1, "total": 1, "label": "Complete"},
        "summary": run.summary,
        "source": run.source,
        "profile": run.profile,
        "settings": run.settings,
        "stats": run.stats,
        "startedAt": run.created_at.isoformat(),
        "updatedAt": run.created_at.isoformat(),
    }
