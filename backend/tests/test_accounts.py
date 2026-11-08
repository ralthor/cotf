import pytest
from rest_framework.authtoken.models import Token

pytestmark = pytest.mark.django_db


def test_register_login_me_logout(anon):
    r = anon.post("/api/auth/register/", {"username": "bob", "password": "a-long-passphrase"}, format="json")
    assert r.status_code == 201
    token = r.json()["token"]
    anon.credentials(HTTP_AUTHORIZATION=f"Token {token}")
    assert anon.get("/api/auth/me/").json()["username"] == "bob"
    assert anon.post("/api/auth/logout/").status_code == 204
    assert not Token.objects.filter(key=token).exists()
    anon.credentials()  # a revoked token is rejected even on public endpoints
    r = anon.post("/api/auth/login/", {"username": "bob", "password": "a-long-passphrase"}, format="json")
    assert r.status_code == 200 and r.json()["token"]


def test_register_rejects_weak_password_and_duplicates(anon, user):
    assert anon.post("/api/auth/register/", {"username": "carol", "password": "12345678"}, format="json").status_code == 400
    r = anon.post("/api/auth/register/", {"username": "ALICE", "password": "another-long-pass"}, format="json")
    assert r.status_code == 400


def test_login_failure(anon, user):
    assert anon.post("/api/auth/login/", {"username": "alice", "password": "nope"}, format="json").status_code == 400


def test_requires_auth(anon):
    assert anon.get("/api/games/").status_code == 401


def test_external_accounts(api):
    r = api.post("/api/accounts/external/", {"provider": "chesscom", "username": "@Example_Player"}, format="json")
    assert r.status_code == 201
    assert r.json()["username"] == "example_player"
    r = api.post("/api/accounts/external/", {"provider": "chesscom", "username": "other"}, format="json")
    assert r.status_code == 200  # one account per provider: updated
    assert api.post("/api/accounts/external/", {"provider": "lichess", "username": "bad name"}, format="json").status_code == 400
    assert len(api.get("/api/accounts/external/").json()) == 1
