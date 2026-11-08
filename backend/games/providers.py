"""Server-side clients for Chess.com PubAPI and the Lichess API.

Both: serial requests, a meaningful User-Agent, conditional requests, and back-off on 429.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import httpx
from django.conf import settings

CHESSCOM_API = "https://api.chess.com/pub"
LICHESS_ORIGIN = "https://lichess.org"
LICHESS_ID_RE = re.compile(r"^[A-Za-z0-9]{8}$")


class ProviderError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


@dataclass
class Fetched:
    status: int
    body: str
    etag: str | None
    last_modified: str | None


class _Client:
    rate_limit_backoff_s = 5.0
    max_retries = 2
    provider = "provider"

    def __init__(self, transport: httpx.BaseTransport | None = None, sleep: Callable[[float], None] = time.sleep):
        self.http = httpx.Client(
            transport=transport,
            timeout=httpx.Timeout(30.0, read=120.0),
            headers={"User-Agent": settings.PROVIDER_USER_AGENT},
            follow_redirects=False,
        )
        self.sleep = sleep

    def get(self, url: str, accept: str, etag: str | None = None, last_modified: str | None = None) -> Fetched:
        headers = {"Accept": accept}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        for attempt in range(self.max_retries + 1):
            try:
                r = self.http.get(url, headers=headers)
            except httpx.HTTPError as exc:
                raise ProviderError(f"{self.provider} request failed: {exc}") from exc
            if r.status_code == 429:
                if attempt >= self.max_retries:
                    raise ProviderError(f"{self.provider} rate limit reached", 429)
                self.sleep(self.rate_limit_backoff_s * (attempt + 1))
                continue
            if r.status_code >= 500 and attempt < self.max_retries:
                self.sleep(2**attempt)
                continue
            if r.status_code == 304:
                return Fetched(304, "", etag, last_modified)
            if r.status_code in (404, 410):
                raise ProviderError(f"{self.provider}: not found", r.status_code)
            if r.status_code >= 400:
                raise ProviderError(f"{self.provider} responded with HTTP {r.status_code}", r.status_code)
            return Fetched(r.status_code, r.text, r.headers.get("ETag"), r.headers.get("Last-Modified"))
        raise ProviderError(f"{self.provider}: retries exhausted")


class ChessComClient(_Client):
    provider = "Chess.com"

    def archives(self, username: str) -> list[str]:
        f = self.get(f"{CHESSCOM_API}/player/{username}/games/archives", "application/json")
        data = json.loads(f.body or "{}")
        return [a for a in data.get("archives", []) if isinstance(a, str) and a.startswith(f"{CHESSCOM_API}/player/")]

    def month(self, url: str, etag: str | None = None, last_modified: str | None = None) -> tuple[Fetched, list[dict]]:
        if not url.startswith(f"{CHESSCOM_API}/player/"):
            raise ProviderError("Unexpected archive URL")
        f = self.get(url, "application/json", etag, last_modified)
        if f.status == 304:
            return f, []
        data = json.loads(f.body or "{}")
        games = [g for g in data.get("games", []) if isinstance(g, dict)]
        return f, games


class LichessClient(_Client):
    provider = "Lichess"
    rate_limit_backoff_s = 60.0  # Lichess: wait a full minute after 429
    max_retries = 1

    def user_games(self, username: str, since_ms: int | None, max_games: int) -> Iterator[dict]:
        params = {"max": str(max_games), "pgnInJson": "true", "clocks": "true", "opening": "true", "finished": "true"}
        if since_ms:
            params["since"] = str(since_ms)
        url = f"{LICHESS_ORIGIN}/api/games/user/{username}"
        for attempt in range(self.max_retries + 1):
            with self.http.stream("GET", url, params=params, headers={"Accept": "application/x-ndjson"}) as r:
                if r.status_code == 429:
                    if attempt >= self.max_retries:
                        raise ProviderError("Lichess rate limit reached", 429)
                    self.sleep(self.rate_limit_backoff_s)
                    continue
                if r.status_code == 404:
                    raise ProviderError("Lichess: user not found", 404)
                if r.status_code >= 400:
                    raise ProviderError(f"Lichess responded with HTTP {r.status_code}", r.status_code)
                for line in r.iter_lines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue  # truncated final line
                    if isinstance(obj, dict):
                        yield obj
                return

    def game(self, game_id: str) -> dict:
        if not LICHESS_ID_RE.match(game_id):
            raise ProviderError("Invalid Lichess game id")
        f = self.get(
            f"{LICHESS_ORIGIN}/game/export/{game_id}?pgnInJson=true&clocks=true&opening=true", "application/json"
        )
        return json.loads(f.body)


LICHESS_FINISHED = {
    "mate", "resign", "stalemate", "timeout", "draw", "outoftime", "cheat",
    "unknownFinish", "insufficientMaterialClaim", "variantEnd",
}


def parse_lichess_game_id(text: str) -> str | None:
    """Mirrors web/src/features/import/lichess.ts: only lichess.org hosts; first 8 chars of the path id."""
    from urllib.parse import urlparse

    s = text.strip()
    if re.fullmatch(r"[A-Za-z0-9]{8}([A-Za-z0-9]{4})?", s):
        return s[:8]
    u = urlparse(s if "://" in s else f"https://{s}")
    if u.hostname not in ("lichess.org", "www.lichess.org"):
        return None
    seg = [p for p in u.path.split("/") if p]
    if not seg:
        return None
    first = seg[1] if seg[0] in ("embed", "game") and len(seg) > 1 else seg[0]
    if not re.fullmatch(r"[A-Za-z0-9]{8}([A-Za-z0-9]{4})?", first):
        return None
    return first[:8]
