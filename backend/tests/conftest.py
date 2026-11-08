import pytest

from accounts.models import ExternalAccount
from games.models import Game

from .fixtures import ITALIAN, QUEEN_BLUNDER


@pytest.fixture
def games(api, user):
    ExternalAccount.objects.create(user=user, provider="chesscom", username="example_player")
    api.post("/api/imports/pgn/", {"pgn": ITALIAN + "\n\n" + QUEEN_BLUNDER}, format="json")
    return {g.headers["Event"]: g for g in Game.objects.all()}
