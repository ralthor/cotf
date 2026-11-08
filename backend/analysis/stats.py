"""Aggregated statistics over a user's analysed games (latest complete run per game)."""

from __future__ import annotations

from collections import defaultdict

from games.models import Game

from .models import AnalysisRun, MoveClassification
from .scoring import CATEGORIES

PHASES = (("opening", 1, 20), ("middlegame", 21, 60), ("endgame", 61, 10_000))


def _phase(ply: int) -> str:
    for name, lo, hi in PHASES:
        if lo <= ply <= hi:
            return name
    return "endgame"


def user_stats(games_qs) -> dict:
    games = list(games_qs.exclude(user_colour="").order_by("played_at"))
    latest: dict[int, AnalysisRun] = {}
    for run in (
        AnalysisRun.objects.filter(game__in=[g.id for g in games], status=AnalysisRun.Status.COMPLETE)
        .order_by("game_id", "-created_at")
    ):
        latest.setdefault(run.game_id, run)

    trend = []
    by_time_class: dict[str, list[float]] = defaultdict(list)
    by_opening: dict[str, dict] = defaultdict(lambda: {"games": 0, "points": 0.0, "accuracy": []})
    results = {"win": 0, "loss": 0, "draw": 0}
    for g in games:
        if g.user_result in results:
            results[g.user_result] += 1
        key = g.opening or g.eco or "Unknown"
        op = by_opening[key]
        op["games"] += 1
        op["points"] += {"win": 1.0, "draw": 0.5}.get(g.user_result, 0.0)
        run = latest.get(g.id)
        if not run:
            continue
        side = "white" if g.user_colour == "w" else "black"
        acc = (run.summary.get(side) or {}).get("accuracy", {}).get("value")
        if acc is None:
            continue
        trend.append(
            {
                "game": g.id,
                "played_at": g.played_at.isoformat() if g.played_at else None,
                "accuracy": acc,
                "time_class": g.time_class,
                "result": g.user_result,
                "opponent": g.opponent,
            }
        )
        by_time_class[g.time_class or "unknown"].append(acc)
        op["accuracy"].append(acc)

    categories = {c: 0 for c in CATEGORIES}
    phase_counts = {name: {c: 0 for c in CATEGORIES} for name, _, _ in PHASES}
    colour_of = {g.id: g.user_colour for g in games}
    for mc in MoveClassification.objects.filter(run__in=list(latest.values())).select_related("run"):
        if mc.colour != colour_of.get(mc.run.game_id) or not mc.category:
            continue
        categories[mc.category] += 1
        phase_counts[_phase(mc.ply)][mc.category] += 1

    def avg(xs):
        return round(sum(xs) / len(xs), 1) if xs else None

    return {
        "games": len(games),
        "analysed_games": len(trend),
        "results": results,
        "average_accuracy": avg([t["accuracy"] for t in trend]),
        "accuracy_trend": trend,
        "by_time_class": {k: {"games": len(v), "accuracy": avg(v)} for k, v in by_time_class.items()},
        "categories": categories,
        "by_phase": phase_counts,
        "openings": sorted(
            (
                {
                    "opening": k,
                    "games": v["games"],
                    "score_pct": round(100 * v["points"] / v["games"], 1),
                    "accuracy": avg(v["accuracy"]),
                }
                for k, v in by_opening.items()
            ),
            key=lambda o: -o["games"],
        )[:20],
        "notes": "Accuracy is this app's estimate (acc-v1) from the latest complete analysis of each game. "
        "Phases are approximated by ply (opening ≤ 20, middlegame ≤ 60).",
    }


def filtered_games(user, params):
    from games.filters import GameFilter

    return GameFilter(params, queryset=Game.objects.filter(user=user)).qs
