import datetime as dt
import json

import httpx
import pytest

from accounts.models import ExternalAccount
from games.models import Game, SyncCursor
from games.pgn import parse_pgn, time_class_from_control
from games.providers import ChessComClient, LichessClient, ProviderError, parse_lichess_game_id
from games.services import sync_chesscom, sync_lichess

from .fixtures import ILLEGAL, ITALIAN, QUEEN_BLUNDER

pytestmark = pytest.mark.django_db
NOW = dt.datetime(2026, 11, 8, tzinfo=dt.UTC)


def test_parse_pgn_reports_errors_without_failing_valid_games():
    games, errors = parse_pgn("\n\n".join([ITALIAN, ILLEGAL, QUEEN_BLUNDER]))
    assert len(games) == 2
    assert len(errors) == 1
    g = games[0]
    assert g.moves[6].san == "O-O" and g.moves[6].uci == "e1g1"
    assert g.moves[0].clock_seconds == 600
    assert g.moves[0].legal_move_count == 20


def test_time_class():
    assert time_class_from_control("60+0") == "bullet"
    assert time_class_from_control("180+2") == "blitz"
    assert time_class_from_control("600") == "rapid"
    assert time_class_from_control("1800+30") == "classical"
    assert time_class_from_control("-") == "daily"


def test_pgn_import_dedupes_and_sets_user_perspective(api, user):
    ExternalAccount.objects.create(user=user, provider="chesscom", username="example_player")
    r = api.post("/api/imports/pgn/", {"pgn": ITALIAN + "\n\n" + QUEEN_BLUNDER}, format="json")
    assert r.status_code == 201 and len(r.json()["created"]) == 2
    r = api.post("/api/imports/pgn/", {"pgn": ITALIAN}, format="json")
    assert r.status_code == 200 and r.json()["existing"]
    g = Game.objects.get(provider="chesscom")  # Site header recognised
    assert g.user_colour == "w" and g.user_result == "win" and g.opponent == "Beta" and g.time_class == "rapid"
    assert g.moves.count() == 10
    assert api.post("/api/imports/pgn/", {"pgn": ILLEGAL}, format="json").status_code == 400


def test_game_list_filters_and_isolation(api, user, django_user_model):
    ExternalAccount.objects.create(user=user, provider="chesscom", username="example_player")
    api.post("/api/imports/pgn/", {"pgn": ITALIAN + "\n\n" + QUEEN_BLUNDER}, format="json")
    assert api.get("/api/games/").json()["count"] == 2
    assert api.get("/api/games/?result=loss").json()["count"] == 1
    assert api.get("/api/games/?time_class=blitz").json()["count"] == 1
    assert api.get("/api/games/?opponent=bet").json()["count"] == 1
    assert api.get("/api/games/?colour=b").json()["count"] == 0
    gid = api.get("/api/games/").json()["results"][0]["id"]
    detail = api.get(f"/api/games/{gid}/").json()
    assert detail["moves"][0]["ply"] == 1
    from rest_framework.test import APIClient

    other = APIClient()
    other.force_authenticate(django_user_model.objects.create_user("mallory", password="x-long-password"))
    assert other.get(f"/api/games/{gid}/").status_code == 404


def test_lichess_id_parsing_matches_frontend():
    assert parse_lichess_game_id("https://lichess.org/AbCd1234/black") == "AbCd1234"
    assert parse_lichess_game_id("https://lichess.org/AbCd1234wxyz") == "AbCd1234"
    assert parse_lichess_game_id("https://lichess.org.evil.example/AbCd1234") is None
    assert parse_lichess_game_id("https://lichess.org/@/user") is None


def _chesscom_transport(calls):
    games_nov = {"games": [
        {"url": "https://www.chess.com/game/live/1", "pgn": ITALIAN, "end_time": 1762600000, "rules": "chess",
         "time_class": "rapid", "white": {"username": "example_player", "rating": 1500}, "black": {"username": "Beta", "rating": 1480},
         "accuracies": {"white": 91.2, "black": 80.0}},
        {"url": "https://www.chess.com/game/live/2", "pgn": ITALIAN, "rules": "chess960"},
    ]}

    def handler(request: httpx.Request):
        calls.append((request.url.path, request.headers.get("If-None-Match"), request.headers.get("User-Agent")))
        if request.url.path.endswith("/archives"):
            return httpx.Response(200, json={"archives": [
                "https://api.chess.com/pub/player/example_player/games/2026/10",
                "https://api.chess.com/pub/player/example_player/games/2026/11",
            ]})
        if request.url.path.endswith("/2026/10"):
            return httpx.Response(200, json={"games": []}, headers={"ETag": '"oct"'})
        if request.headers.get("If-None-Match") == '"nov"':
            return httpx.Response(304)
        return httpx.Response(200, content=json.dumps(games_nov), headers={"ETag": '"nov"'})

    return httpx.MockTransport(handler)


def test_chesscom_sync_is_idempotent_and_uses_etags(user):
    account = ExternalAccount.objects.create(user=user, provider="chesscom", username="example_player")
    calls = []
    client = ChessComClient(transport=_chesscom_transport(calls), sleep=lambda s: None)
    s1 = sync_chesscom(account, client, now=NOW)
    assert s1["created"] == 1 and s1["skipped"] == 1
    g = Game.objects.get()
    assert g.provider_accuracy == {"white": 91.2, "black": 80.0}
    assert g.time_class == "rapid" and g.played_at is not None
    cursor = SyncCursor.objects.get(account=account)
    assert cursor.chesscom_months["2026/10"]["complete"] is True
    assert cursor.chesscom_months["2026/11"]["complete"] is False
    calls.clear()
    s2 = sync_chesscom(account, client, now=NOW)
    assert s2["created"] == 0 and s2["months_unchanged"] == 1
    paths = [c[0] for c in calls]
    assert not any(p.endswith("/2026/10") for p in paths)  # completed month not refetched
    assert any(c[1] == '"nov"' for c in calls)  # conditional request for current month
    assert all("ChessGameAnalyser" in (c[2] or "") for c in calls)


def test_chesscom_429_backoff():
    sleeps = []
    n = {"i": 0}

    def handler(request):
        n["i"] += 1
        return httpx.Response(429) if n["i"] == 1 else httpx.Response(200, json={"archives": []})

    client = ChessComClient(transport=httpx.MockTransport(handler), sleep=sleeps.append)
    assert client.archives("x") == []
    assert sleeps == [5.0]


def test_lichess_sync_cursor_and_filters(user):
    account = ExternalAccount.objects.create(user=user, provider="lichess", username="someone")
    lines = [
        {"id": "aaaaaaaa", "status": "resign", "variant": "standard", "lastMoveAt": 1000, "pgn": ITALIAN, "speed": "blitz"},
        {"id": "bbbbbbbb", "status": "started", "variant": "standard", "lastMoveAt": 5000, "pgn": QUEEN_BLUNDER},
        {"id": "cccccccc", "status": "mate", "variant": "chess960", "lastMoveAt": 3000, "pgn": QUEEN_BLUNDER},
    ]
    seen_since = []

    def handler(request):
        seen_since.append(request.url.params.get("since"))
        assert request.headers["Accept"] == "application/x-ndjson"
        body = "\n".join(json.dumps(x) for x in lines) + '\n{"truncated'
        return httpx.Response(200, content=body)

    client = LichessClient(transport=httpx.MockTransport(handler), sleep=lambda s: None)
    stats = sync_lichess(account, client)
    assert stats == {"created": 1, "existing": 0, "skipped": 2}
    assert SyncCursor.objects.get(account=account).lichess_since_ms == 1000
    sync_lichess(account, client)
    assert seen_since == [None, "1001"]
    g = Game.objects.get()
    assert g.external_id == "aaaaaaaa" and g.source_url == "https://lichess.org/aaaaaaaa" and g.time_class == "blitz"


def test_lichess_429_waits_a_minute():
    sleeps = []
    n = {"i": 0}

    def handler(request):
        n["i"] += 1
        return httpx.Response(429) if n["i"] == 1 else httpx.Response(200, content="")

    client = LichessClient(transport=httpx.MockTransport(handler), sleep=sleeps.append)
    assert list(client.user_games("x", None, 10)) == []
    assert sleeps == [60.0]
    n["i"] = -10
    with pytest.raises(ProviderError):
        LichessClient(transport=httpx.MockTransport(lambda r: httpx.Response(429)), sleep=lambda s: None).game("aaaaaaaa")


def test_sync_endpoint_validates_username_and_queues(api, user):
    from unittest.mock import patch

    assert api.post("/api/imports/lichess/", {"username": "bad name!"}, format="json").status_code == 400
    with patch("games.views.sync_account_task.delay") as delay:
        delay.return_value.id = "t1"
        r = api.post("/api/imports/chesscom/", {"username": "Example_Player"}, format="json")
    assert r.status_code == 202 and delay.called
    assert ExternalAccount.objects.get(user=user, provider="chesscom").username == "example_player"
