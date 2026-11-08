"""PGN parsing with python-chess into canonical moves/FENs (mirrors web/src/core/chess/pgn.ts)."""

from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass, field

import chess
import chess.pgn

MAX_GAMES = 500
MAX_PLIES = 1200
SUPPORTED_VARIANTS = {"", "standard", "from position", "fromposition"}
CLOCK_RE = re.compile(r"\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]")


class PgnError(ValueError):
    pass


@dataclass
class ParsedMove:
    ply: int
    colour: str
    san: str
    uci: str
    fen_before: str
    fen_after: str
    legal_move_count: int
    clock_seconds: float | None = None


@dataclass
class ParsedGame:
    headers: dict[str, str]
    initial_fen: str
    moves: list[ParsedMove] = field(default_factory=list)
    pgn: str = ""

    @property
    def content_hash(self) -> str:
        movetext = " ".join(m.uci for m in self.moves)
        return hashlib.sha256(f"{self.initial_fen}|{movetext}|{self.headers.get('Date', '')}|"
                              f"{self.headers.get('White', '')}|{self.headers.get('Black', '')}".encode()).hexdigest()


def _clock(comment: str) -> float | None:
    m = CLOCK_RE.search(comment or "")
    if not m:
        return None
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def parse_game(game: chess.pgn.Game, raw_text: str | None = None) -> ParsedGame:
    if game.errors:
        raise PgnError(f"Could not read moves: {game.errors[0]}")
    headers = {k: v for k, v in game.headers.items()}
    variant = headers.get("Variant", "").strip().lower()
    if variant not in SUPPORTED_VARIANTS:
        raise PgnError(f'Unsupported variant "{headers.get("Variant")}". Only standard chess is supported.')
    board = game.board()
    if board.chess960:
        raise PgnError("Chess960 is not supported.")
    initial_fen = board.fen()
    moves: list[ParsedMove] = []
    for ply, node in enumerate(game.mainline(), start=1):
        if ply > MAX_PLIES:
            raise PgnError(f"Game exceeds {MAX_PLIES} plies.")
        move = node.move
        if move not in board.legal_moves:
            raise PgnError(f"Illegal move at ply {ply}.")
        fen_before = board.fen()
        legal = board.legal_moves.count()
        san = board.san(move)
        colour = "w" if board.turn == chess.WHITE else "b"
        board.push(move)
        moves.append(
            ParsedMove(ply, colour, san, move.uci(), fen_before, board.fen(), legal, _clock(node.comment))
        )
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=True)
    return ParsedGame(headers=headers, initial_fen=initial_fen, moves=moves, pgn=(raw_text or game.accept(exporter)).strip())


def parse_pgn(text: str, max_bytes: int = 5 * 1024 * 1024) -> tuple[list[ParsedGame], list[str]]:
    """Parses one or more games. Returns (games, errors); invalid games are skipped, not fatal."""
    if len(text.encode()) > max_bytes:
        raise PgnError("PGN input is too large.")
    stream = io.StringIO(text.replace("\r\n", "\n").lstrip("﻿"))
    games: list[ParsedGame] = []
    errors: list[str] = []
    index = 0
    while index < MAX_GAMES:
        try:
            game = chess.pgn.read_game(stream)
        except Exception as exc:  # noqa: BLE001 - python-chess raises various errors on malformed input
            errors.append(f"Game {index + 1}: {exc}")
            break
        if game is None:
            break
        index += 1
        try:
            games.append(parse_game(game))
        except PgnError as exc:
            errors.append(f"Game {index}: {exc}")
    if index == 0:
        errors.append("No PGN games found.")
    return games, errors


def parse_single(text: str) -> ParsedGame:
    games, errors = parse_pgn(text)
    if not games:
        raise PgnError(errors[0] if errors else "No game found.")
    return games[0]


def time_class_from_control(tc: str) -> str:
    """Classifies a PGN TimeControl ("600+5", "-", "1/86400") by estimated duration."""
    if not tc or tc == "?":
        return ""
    if tc == "-" or "/" in tc:
        return "daily"
    try:
        base, _, inc = tc.partition("+")
        total = int(base) + 40 * int(inc or 0)
    except ValueError:
        return ""
    if total < 180:
        return "bullet"
    if total < 480:
        return "blitz"
    if total < 1500:
        return "rapid"
    return "classical"
