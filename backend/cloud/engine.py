"""Native Stockfish runner for cloud workers (python-chess UCI), producing the frontend's JSON shapes."""

from __future__ import annotations

import os
import resource
import shlex
from dataclasses import dataclass

import chess
import chess.engine
from django.conf import settings


def _limit_resources(memory_mb: int, cpu_seconds: int):
    def apply():  # runs in the child process before exec
        resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        os.nice(5)

    return apply


def score_json(pov: chess.engine.PovScore) -> dict:
    """White-relative score in the shared JSON shape."""
    w = pov.white()
    if w.is_mate():
        m = w.mate()
        assert m is not None
        # mate(+n): White mates in n; mate(-n) / mate(0) handled via winner.
        if m > 0:
            return {"kind": "mate", "moves": m, "winner": "w", "perspective": "white"}
        return {"kind": "mate", "moves": abs(m), "winner": "b", "perspective": "white"}
    return {"kind": "cp", "value": int(w.score()), "perspective": "white"}


@dataclass
class SearchResult:
    fen: str
    depth: int
    lines: list[dict]  # [{rank, score, pvUci, depth, nodes}]
    by_depth: list[dict]  # [{depth, lines:[...]}] (complete MultiPV sets only)
    nodes: int
    time_ms: int
    terminal: str | None = None


class StockfishRunner:
    """One engine process per worker task. Hash is cleared on request for reproducible research runs."""

    def __init__(self, path: str | None = None, threads: int | None = None, hash_mb: int | None = None,
                 memory_mb: int = 2048, cpu_seconds: int | None = None):
        cmd = shlex.split(path or settings.STOCKFISH_PATH)
        self.engine = chess.engine.SimpleEngine.popen_uci(
            cmd, preexec_fn=_limit_resources(memory_mb, cpu_seconds or settings.CLOUD_JOB_TIME_LIMIT_S * 2)
        )
        opts = {}
        if "Threads" in self.engine.options:
            opts["Threads"] = threads or settings.CLOUD_ENGINE_THREADS
        if "Hash" in self.engine.options:
            opts["Hash"] = hash_mb or settings.CLOUD_ENGINE_HASH_MB
        if opts:
            self.engine.configure(opts)
        self.id = self.engine.id.get("name", "unknown")
        self.settings = {"threads": opts.get("Threads"), "hash_mb": opts.get("Hash")}
        self._game: object = object()

    def close(self) -> None:
        try:
            self.engine.quit()
        except Exception:  # noqa: BLE001
            self.engine.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def analyse(self, fen: str, depth: int, multipv: int = 1, searchmoves: list[str] | None = None,
                clear_hash: bool = False, time_limit_s: float | None = None) -> SearchResult:
        board = chess.Board(fen)
        if board.is_checkmate():
            loser = "w" if board.turn == chess.WHITE else "b"
            line = {"rank": 1, "depth": 0, "pvUci": [],
                    "score": {"kind": "mate", "moves": 0, "winner": "b" if loser == "w" else "w", "perspective": "white"}}
            return SearchResult(fen, 0, [line], [], 0, 0, "checkmate")
        if board.is_stalemate() or board.is_insufficient_material():
            line = {"rank": 1, "depth": 0, "pvUci": [], "score": {"kind": "cp", "value": 0, "perspective": "white"}}
            return SearchResult(fen, 0, [line], [], 0, 0, "draw")
        root_moves = [chess.Move.from_uci(u) for u in searchmoves] if searchmoves else None
        multipv = max(1, min(multipv, board.legal_moves.count() if not root_moves else len(root_moves)))
        limit = chess.engine.Limit(depth=depth, time=time_limit_s)
        snapshots: dict[int, dict[int, dict]] = {}
        nodes = time_ms = 0
        # A fresh `game` object makes python-chess send `ucinewgame`, clearing the hash.
        game = object() if clear_hash else self._game
        self._game = game
        with self.engine.analysis(board, limit, multipv=multipv, root_moves=root_moves, game=game) as analysis:
            for info in analysis:
                if "score" not in info or "pv" not in info or "depth" not in info:
                    continue
                if info.get("lowerbound") or info.get("upperbound"):
                    continue
                d = int(info["depth"])
                rank = int(info.get("multipv", 1))
                snapshots.setdefault(d, {})[rank] = {
                    "rank": rank,
                    "depth": d,
                    "score": score_json(info["score"]),
                    "pvUci": [m.uci() for m in info["pv"]],
                    "nodes": info.get("nodes"),
                }
                nodes = info.get("nodes", nodes) or nodes
                time_ms = int(1000 * info.get("time", time_ms / 1000))
        complete = sorted(d for d, m in snapshots.items() if len(m) >= multipv and 1 in m)
        by_depth = [{"depth": d, "lines": [snapshots[d][r] for r in sorted(snapshots[d])]} for d in complete]
        final = by_depth[-1] if by_depth else None
        if final is None and snapshots:
            d = max(d for d, m in snapshots.items() if 1 in m)
            final = {"depth": d, "lines": [snapshots[d][r] for r in sorted(snapshots[d])]}
        return SearchResult(fen, final["depth"] if final else 0, final["lines"] if final else [], by_depth, nodes, time_ms)
