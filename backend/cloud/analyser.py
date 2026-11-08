"""Cloud game analysis: same three passes as the browser orchestrator, on native Stockfish."""

from __future__ import annotations

import time
from collections.abc import Callable

from analysis.scoring import classify_move, expected_score
from games.models import Game

from .brilliancy import BRILLIANCY_VERSION, POLICY, detect_sacrifice, evaluate_brilliance
from .engine import SearchResult, StockfishRunner
from .profiles import EngineProfile


class Cancelled(Exception):
    pass


class CloudGameAnalyser:
    def __init__(self, runner: StockfishRunner, profile: EngineProfile,
                 should_cancel: Callable[[], bool] = lambda: False,
                 on_progress: Callable[[int, int, str], None] = lambda d, t, label: None,
                 position_budget: int | None = None):
        self.runner = runner
        self.profile = profile
        self.should_cancel = should_cancel
        self.on_progress = on_progress
        self.position_budget = position_budget
        self.searches = 0
        self.max_depth = 0
        self.nodes = 0

    def _search(self, fen, depth, multipv=1, searchmoves=None, clear_hash=False) -> SearchResult:
        if self.should_cancel():
            raise Cancelled()
        if self.position_budget is not None and self.searches >= self.position_budget:
            raise Cancelled("Quota exhausted")
        r = self.runner.analyse(fen, depth, multipv, searchmoves, clear_hash, self.profile.per_search_time_limit_s)
        self.searches += 1
        self.max_depth = max(self.max_depth, r.depth)
        self.nodes += r.nodes or 0
        return r

    def _score_move(self, mv, root: SearchResult) -> dict:
        forced = mv.legal_move_count <= 1
        base = {"ply": mv.ply, "colour": mv.colour, "san": mv.san, "uci": mv.uci, "depth": root.depth,
                "lines": root.lines, "forced": forced}
        if not root.lines:
            return base
        best = root.lines[0]
        played = next((ln for ln in root.lines if ln["pvUci"][:1] == [mv.uci]), None)
        method = "root-multipv"
        if played is None:
            r = self._search(mv.fen_before, root.depth or self.profile.first_pass_depth, 1, [mv.uci])
            played = r.lines[0] if r.lines else None
            method = "searchmoves"
        if played is None:
            return base
        c = classify_move(mv.colour, mv.uci, best["pvUci"][0] if best["pvUci"] else None, best["score"],
                          played["score"], forced)
        return {
            **base,
            "bestMoveUci": best["pvUci"][0] if best["pvUci"] else None,
            "bestScore": best["score"],
            "playedScore": played["score"],
            "secondScore": root.lines[1]["score"] if len(root.lines) > 1 else None,
            "playedScoreMethod": method,
            "category": c.category,
            "expectedLossPct": c.loss.expected_loss_pct,
        }

    def run(self, game: Game) -> dict:
        started = time.monotonic()
        moves = list(game.moves.all())
        n = len(moves)
        p = self.profile
        evals: list[dict | None] = [None] * (n + 1)
        results: list[dict | None] = [None] * n
        roots: list[SearchResult | None] = [None] * (n + 1)

        for i in range(n + 1):
            self.on_progress(i, n + 1, f"Position {i}/{n}")
            fen = game.initial_fen if i == 0 else moves[i - 1].fen_after
            roots[i] = self._search(fen, p.first_pass_depth, 2)
            evals[i] = roots[i].lines[0]["score"] if roots[i].lines else None
            if i > 0:
                results[i - 1] = self._score_move(moves[i - 1], roots[i - 1])

        interesting = [
            idx for idx, r in enumerate(results)
            if r and not r["forced"] and (
                r.get("category") in ("questionable", "mistake", "blunder")
                or (r.get("bestScore") or {}).get("kind") == "mate"
                or (r.get("playedScore") or {}).get("kind") == "mate"
            )
        ][: p.max_deep_positions]
        for k, idx in enumerate(interesting):
            self.on_progress(k, len(interesting), f"Deep check {k + 1}/{len(interesting)}")
            root = self._search(moves[idx].fen_before, p.deep_pass_depth, 2)
            results[idx] = self._score_move(moves[idx], root)
            evals[idx] = root.lines[0]["score"] if root.lines else evals[idx]

        candidates = self._candidates(moves, results, roots)
        for k, idx in enumerate(candidates):
            self.on_progress(k, len(candidates), f"Brilliancy check {k + 1}/{len(candidates)}")
            evidence = self.check_brilliance(moves[idx])
            r = results[idx]
            if evidence["verdict"] != "none" and r:
                r["brilliance"] = evidence

        return {
            "moves": results,
            "positionEvals": evals,
            "stats": {
                "searches": self.searches,
                "max_depth_reached": self.max_depth,
                "nodes": self.nodes,
                "duration_s": round(time.monotonic() - started, 1),
                "engine": self.runner.id,
                "engine_settings": self.runner.settings,
                "profile": p.as_dict(),
                "brilliancy_version": BRILLIANCY_VERSION,
            },
        }

    def _candidates(self, moves, results, roots) -> list[int]:
        scored = []
        for idx, r in enumerate(results):
            mv = moves[idx]
            if not r or r["forced"] or r.get("category") != "best" or mv.legal_move_count < 3:
                continue
            root = roots[idx]
            horizon = self.profile.brilliancy_shallow_depth
            shallow_miss = any(
                d["depth"] <= horizon and d["lines"] and d["lines"][0]["pvUci"][:1] != [mv.uci]
                for d in (root.by_depth if root else [])
            )
            line = next((ln["pvUci"] for ln in r["lines"] if ln["pvUci"][:1] == [mv.uci]), [mv.uci])
            sac = detect_sacrifice(mv.fen_before, line)["isSacrifice"]
            gap = 0.0
            if r.get("secondScore"):
                gap = (expected_score(r["bestScore"], mv.colour) - expected_score(r["secondScore"], mv.colour)) * 100
            decisive = not r.get("secondScore") or gap >= POLICY["min_uniqueness_pct"]
            weight = (2 if shallow_miss else 0) + (2 if sac else 0) + (2 if decisive else 0)
            if weight >= 4:
                scored.append((weight + gap / 100, idx))
        scored.sort(reverse=True)
        return sorted(idx for _, idx in scored[: self.profile.max_brilliancy_candidates])

    def check_brilliance(self, mv) -> dict:
        p = self.profile
        legal = mv.legal_move_count
        # Full-width search to the shallow horizon: every legal move scored at depths 1..horizon.
        shallow_run = self._search(mv.fen_before, p.brilliancy_shallow_depth, legal, clear_hash=True)
        shallow = []
        for d in shallow_run.by_depth:
            if d["depth"] > p.brilliancy_shallow_depth or not d["lines"]:
                continue
            idx = next((i for i, ln in enumerate(d["lines"]) if ln["pvUci"][:1] == [mv.uci]), None)
            shallow.append({
                "depth": d["depth"],
                "playedRank": d["lines"][idx]["rank"] if idx is not None else None,
                "sampledLines": len(d["lines"]),
                "legalMoves": legal,
                "bestUci": d["lines"][0]["pvUci"][0] if d["lines"][0]["pvUci"] else "",
                "bestScore": d["lines"][0]["score"],
                "playedScore": d["lines"][idx]["score"] if idx is not None else None,
            })
        traj_run = self._search(mv.fen_before, p.brilliancy_deep_depth, 1, [mv.uci], clear_hash=True)
        trajectory = [{"depth": d["depth"], "score": d["lines"][0]["score"]} for d in traj_run.by_depth if d["lines"]]
        deep = self._search(mv.fen_before, p.brilliancy_deep_depth, 2, clear_hash=True)
        recheck = self._search(mv.fen_before, p.recheck_depth, 2, clear_hash=True)
        re_played = next((ln["score"] for ln in recheck.lines if ln["pvUci"][:1] == [mv.uci]), None)
        if re_played is None:
            r = self._search(mv.fen_before, p.recheck_depth, 1, [mv.uci], clear_hash=True)
            re_played = r.lines[0]["score"] if r.lines else None
        played_deep = traj_run.lines[0]["score"] if traj_run.lines else deep.lines[0]["score"]
        line = traj_run.lines[0]["pvUci"] if traj_run.lines else [mv.uci]
        return evaluate_brilliance({
            "mover": mv.colour,
            "playedUci": mv.uci,
            "shallow": shallow,
            "trajectory": trajectory,
            "deep": {
                "depth": deep.depth,
                "bestUci": deep.lines[0]["pvUci"][0] if deep.lines and deep.lines[0]["pvUci"] else "",
                "bestScore": deep.lines[0]["score"],
                "secondScore": deep.lines[1]["score"] if len(deep.lines) > 1 else None,
                "playedScore": played_deep,
            },
            "recheck": None if not recheck.lines or re_played is None else {
                "depth": recheck.depth,
                "bestUci": recheck.lines[0]["pvUci"][0] if recheck.lines[0]["pvUci"] else "",
                "bestScore": recheck.lines[0]["score"],
                "secondScore": recheck.lines[1]["score"] if len(recheck.lines) > 1 else None,
                "playedScore": re_played,
            },
            "sacrifice": detect_sacrifice(mv.fen_before, line),
        })
