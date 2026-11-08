"""Import, dedupe and sync logic. All functions are idempotent."""

from __future__ import annotations

import datetime as dt
import logging

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.models import ExternalAccount, Provider

from .models import Game, GameProvider, Move, SyncCursor
from .pgn import ParsedGame, PgnError, parse_pgn, parse_single, time_class_from_control
from .providers import LICHESS_FINISHED, ChessComClient, LichessClient, ProviderError

log = logging.getLogger(__name__)


def _int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _played_at(headers: dict[str, str]) -> dt.datetime | None:
    date = headers.get("UTCDate") or headers.get("Date") or ""
    time_ = headers.get("UTCTime") or headers.get("EndTime", "").split(" ")[0] or "00:00:00"
    if "?" in date or not date:
        return None
    try:
        return dt.datetime.strptime(f"{date} {time_[:8]}", "%Y.%m.%d %H:%M:%S").replace(tzinfo=dt.UTC)
    except ValueError:
        try:
            return dt.datetime.strptime(date, "%Y.%m.%d").replace(tzinfo=dt.UTC)
        except ValueError:
            return None


def _user_perspective(user, white: str, black: str, result: str) -> tuple[str, str]:
    names = {a.username.lower() for a in ExternalAccount.objects.filter(user=user)}
    colour = "w" if white.lower() in names else "b" if black.lower() in names else ""
    if not colour or result not in ("1-0", "0-1", "1/2-1/2"):
        return colour, ""
    if result == "1/2-1/2":
        return colour, "draw"
    won = (result == "1-0") == (colour == "w")
    return colour, "win" if won else "loss"


@transaction.atomic
def upsert_game(
    user,
    parsed: ParsedGame,
    provider: str,
    external_id: str = "",
    source_url: str = "",
    extra: dict | None = None,
) -> tuple[Game, bool]:
    """Creates the game unless it already exists (by external id or content hash)."""
    extra = extra or {}
    existing = None
    if external_id:
        existing = Game.objects.filter(user=user, provider=provider, external_id=external_id).first()
    if existing is None:
        existing = Game.objects.filter(user=user, content_hash=parsed.content_hash).first()
    if existing:
        return existing, False

    h = parsed.headers
    white, black, result = h.get("White", ""), h.get("Black", ""), h.get("Result", "*")
    colour, user_result = _user_perspective(user, white, black, result)
    white_rating = extra.get("white_rating") or _int(h.get("WhiteElo"))
    black_rating = extra.get("black_rating") or _int(h.get("BlackElo"))
    game = Game(
        user=user,
        provider=provider,
        external_id=external_id,
        content_hash=parsed.content_hash,
        source_url=source_url,
        pgn=parsed.pgn,
        headers=h,
        initial_fen=parsed.initial_fen,
        white=white,
        black=black,
        white_rating=white_rating,
        black_rating=black_rating,
        result=result,
        user_colour=colour,
        user_result=user_result,
        user_rating=white_rating if colour == "w" else black_rating if colour == "b" else None,
        opponent=black if colour == "w" else white if colour == "b" else "",
        opponent_rating=black_rating if colour == "w" else white_rating if colour == "b" else None,
        time_class=extra.get("time_class") or time_class_from_control(h.get("TimeControl", "")),
        time_control=h.get("TimeControl", "")[:32],
        eco=h.get("ECO", "")[:8],
        opening=(extra.get("opening") or h.get("Opening") or h.get("ECOUrl", "").rsplit("/", 1)[-1].replace("-", " "))[:200],
        played_at=extra.get("played_at") or _played_at(h),
        ply_count=len(parsed.moves),
        provider_accuracy=extra.get("provider_accuracy"),
    )
    try:
        with transaction.atomic():
            game.save()
    except IntegrityError:  # concurrent import of the same game
        return Game.objects.get(user=user, content_hash=parsed.content_hash), False
    Move.objects.bulk_create(
        [
            Move(
                game=game,
                ply=m.ply,
                colour=m.colour,
                san=m.san,
                uci=m.uci,
                fen_before=m.fen_before,
                fen_after=m.fen_after,
                legal_move_count=m.legal_move_count,
                clock_seconds=m.clock_seconds,
            )
            for m in parsed.moves
        ]
    )
    return game, True


def import_pgn_text(user, text: str) -> dict:
    games, errors = parse_pgn(text, settings.MAX_PGN_BYTES)
    created, existing = [], []
    for g in games:
        site = g.headers.get("Site", "")
        provider = GameProvider.PGN
        external_id = ""
        if site.startswith("https://www.chess.com/game/") or site.startswith("https://lichess.org/"):
            provider = GameProvider.CHESSCOM if "chess.com" in site else GameProvider.LICHESS
            external_id = site if provider == GameProvider.CHESSCOM else site.rstrip("/").rsplit("/", 1)[-1][:8]
        game, was_created = upsert_game(user, g, provider, external_id, site if external_id else "")
        (created if was_created else existing).append(game.id)
    return {"created": created, "existing": existing, "errors": errors}


# --- Chess.com ------------------------------------------------------------------------------------

def _chesscom_extra(raw: dict) -> dict:
    white, black = raw.get("white") or {}, raw.get("black") or {}
    end = raw.get("end_time")
    return {
        "time_class": raw.get("time_class") or "",
        "white_rating": _int(white.get("rating")),
        "black_rating": _int(black.get("rating")),
        "played_at": dt.datetime.fromtimestamp(end, tz=dt.UTC) if isinstance(end, (int, float)) else None,
        "provider_accuracy": raw.get("accuracies") if isinstance(raw.get("accuracies"), dict) else None,
    }


def sync_chesscom(account: ExternalAccount, client: ChessComClient | None = None, now: dt.datetime | None = None) -> dict:
    client = client or ChessComClient()
    now = now or timezone.now()
    cursor, _ = SyncCursor.objects.get_or_create(account=account)
    months_state: dict = dict(cursor.chesscom_months)
    archives = sorted(client.archives(account.username))
    current_key = f"{now.year:04d}/{now.month:02d}"
    if not months_state:
        archives = archives[-settings.SYNC_MAX_MONTHS_INITIAL:]
    stats = {"months_fetched": 0, "months_unchanged": 0, "created": 0, "existing": 0, "skipped": 0, "errors": 0}
    for url in archives:
        key = url.rsplit("/games/", 1)[-1]
        state = months_state.get(key, {})
        if state.get("complete"):
            continue
        fetched, games = client.month(url, state.get("etag"), state.get("last_modified"))
        if fetched.status == 304:
            stats["months_unchanged"] += 1
        else:
            stats["months_fetched"] += 1
            for raw in games:
                if raw.get("rules", "chess") != "chess" or not raw.get("pgn"):
                    stats["skipped"] += 1
                    continue
                try:
                    parsed = parse_single(raw["pgn"])
                except PgnError:
                    stats["errors"] += 1
                    continue
                _, created = upsert_game(
                    account.user, parsed, GameProvider.CHESSCOM, raw.get("url") or "", raw.get("url") or "",
                    _chesscom_extra(raw),
                )
                stats["created" if created else "existing"] += 1
        # A past month never changes again once fetched; the current month keeps its ETag.
        months_state[key] = {
            "etag": fetched.etag,
            "last_modified": fetched.last_modified,
            "complete": key < current_key,
        }
    cursor.chesscom_months = months_state
    cursor.save()
    return stats


# --- Lichess --------------------------------------------------------------------------------------

def _lichess_extra(raw: dict) -> dict:
    players = raw.get("players") or {}
    last = raw.get("lastMoveAt") or raw.get("createdAt")
    opening = raw.get("opening") or {}
    return {
        "time_class": raw.get("speed") if raw.get("speed") != "correspondence" else "daily",
        "white_rating": _int((players.get("white") or {}).get("rating")),
        "black_rating": _int((players.get("black") or {}).get("rating")),
        "played_at": dt.datetime.fromtimestamp(last / 1000, tz=dt.UTC) if isinstance(last, (int, float)) else None,
        "opening": opening.get("name", "") if isinstance(opening, dict) else "",
    }


def lichess_game_analysable(raw: dict) -> bool:
    return (
        raw.get("status") in LICHESS_FINISHED
        and raw.get("variant", "standard") in ("standard", "fromPosition")
        and bool(raw.get("pgn"))
    )


def store_lichess_game(user, raw: dict) -> tuple[Game | None, bool]:
    if not lichess_game_analysable(raw) or not isinstance(raw.get("id"), str):
        return None, False
    try:
        parsed = parse_single(raw["pgn"])
    except PgnError:
        return None, False
    gid = raw["id"][:8]
    return upsert_game(user, parsed, GameProvider.LICHESS, gid, f"https://lichess.org/{gid}", _lichess_extra(raw))


def sync_lichess(account: ExternalAccount, client: LichessClient | None = None) -> dict:
    client = client or LichessClient()
    cursor, _ = SyncCursor.objects.get_or_create(account=account)
    since = (cursor.lichess_since_ms + 1) if cursor.lichess_since_ms else None
    stats = {"created": 0, "existing": 0, "skipped": 0}
    newest = cursor.lichess_since_ms or 0
    for raw in client.user_games(account.username, since, settings.SYNC_LICHESS_MAX_GAMES):
        game, created = store_lichess_game(account.user, raw)
        if game is None:
            stats["skipped"] += 1
        else:
            stats["created" if created else "existing"] += 1
        last = raw.get("lastMoveAt") or raw.get("createdAt") or 0
        if isinstance(last, int) and lichess_game_analysable(raw):
            newest = max(newest, last)
    cursor.lichess_since_ms = newest or None
    cursor.save()
    return stats


def sync_account(account: ExternalAccount) -> dict:
    account.last_sync_status = "running"
    account.save(update_fields=["last_sync_status"])
    try:
        stats = sync_chesscom(account) if account.provider == Provider.CHESSCOM else sync_lichess(account)
    except ProviderError as exc:
        account.last_sync_status = "error"
        account.last_sync_error = str(exc)
        account.save(update_fields=["last_sync_status", "last_sync_error"])
        raise
    account.last_sync_status = "ok"
    account.last_sync_error = ""
    account.last_synced_at = timezone.now()
    account.save(update_fields=["last_sync_status", "last_sync_error", "last_synced_at"])
    log.info("synced %s: %s", account, stats)
    return stats
