#!/usr/bin/env python3
"""Deterministic fake UCI engine for tests: 2-ply material minimax, MultiPV and searchmoves support.

Speaks enough UCI for python-chess (uci/isready/setoption/ucinewgame/position/go/stop/quit).
"""

import sys

import chess

VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def material(board: chess.Board, colour: bool) -> int:
    bal = sum(VALUES[p.piece_type] * (1 if p.color == chess.WHITE else -1) for p in board.piece_map().values())
    return bal if colour == chess.WHITE else -bal


def out(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def search(board: chess.Board, restrict: list[str] | None):
    me = board.turn
    scored = []
    for m in board.legal_moves:
        if restrict and m.uci() not in restrict:
            continue
        board.push(m)
        replies = list(board.legal_moves)
        worst, reply = (10_000 if board.is_checkmate() else 0), None
        if replies:
            worst = None
            for r in replies:
                board.push(r)
                v = material(board, me) * 100
                board.pop()
                if worst is None or v < worst:
                    worst, reply = v, r
        board.pop()
        scored.append((worst, m.uci(), [m.uci()] + ([reply.uci()] if reply else [])))
    scored.sort(key=lambda s: (-s[0], s[1]))
    return scored


def main() -> None:
    board = chess.Board()
    multipv = 1
    for raw in sys.stdin:
        line = raw.strip()
        if line == "uci":
            out("id name FakeFish 1.0")
            out("id author tests")
            out("option name MultiPV type spin default 1 min 1 max 500")
            out("option name Threads type spin default 1 min 1 max 64")
            out("option name Hash type spin default 16 min 1 max 4096")
            out("uciok")
        elif line == "isready":
            out("readyok")
        elif line.startswith("setoption name MultiPV value"):
            multipv = int(line.split()[-1])
        elif line.startswith("position"):
            parts = line.split(" moves ")
            head = parts[0]
            board = chess.Board() if "startpos" in head else chess.Board(head.split("fen ", 1)[1])
            if len(parts) > 1:
                for u in parts[1].split():
                    board.push_uci(u)
        elif line.startswith("go"):
            restrict = line.split("searchmoves ", 1)[1].split() if "searchmoves" in line else None
            scored = search(board, restrict)
            for depth in (1, 2):
                for i, (cp, _uci, pv) in enumerate(scored[:multipv]):
                    score = "mate 1" if cp >= 10_000 else f"cp {cp}"
                    out(f"info depth {depth} multipv {i + 1} score {score} nodes 100 time 1 pv {' '.join(pv)}")
            out(f"bestmove {scored[0][1] if scored else '(none)'}")
        elif line == "quit":
            return


if __name__ == "__main__":
    main()
