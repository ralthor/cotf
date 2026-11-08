from django.conf import settings
from django.db import models
from django.db.models import Q


class GameProvider(models.TextChoices):
    CHESSCOM = "chesscom", "Chess.com"
    LICHESS = "lichess", "Lichess"
    PGN = "pgn", "PGN upload"


class Game(models.Model):
    """A finished game in a user's library. Raw PGN and provenance are always kept."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="games")
    provider = models.CharField(max_length=16, choices=GameProvider.choices)
    external_id = models.CharField(max_length=255, blank=True, default="")  # provider game URL or ID
    content_hash = models.CharField(max_length=64)  # sha256 of normalised movetext + start FEN
    source_url = models.URLField(max_length=500, blank=True, default="")
    pgn = models.TextField()
    headers = models.JSONField(default=dict)
    initial_fen = models.CharField(max_length=100)
    white = models.CharField(max_length=100, blank=True, default="")
    black = models.CharField(max_length=100, blank=True, default="")
    white_rating = models.IntegerField(null=True, blank=True)
    black_rating = models.IntegerField(null=True, blank=True)
    result = models.CharField(max_length=8, default="*")  # 1-0, 0-1, 1/2-1/2, *
    user_colour = models.CharField(max_length=1, blank=True, default="")  # w | b | "" (unknown)
    user_result = models.CharField(max_length=4, blank=True, default="")  # win | loss | draw | ""
    user_rating = models.IntegerField(null=True, blank=True)
    opponent = models.CharField(max_length=100, blank=True, default="")
    opponent_rating = models.IntegerField(null=True, blank=True)
    time_class = models.CharField(max_length=16, blank=True, default="")  # bullet|blitz|rapid|classical|daily
    time_control = models.CharField(max_length=32, blank=True, default="")
    eco = models.CharField(max_length=8, blank=True, default="")
    opening = models.CharField(max_length=200, blank=True, default="")
    played_at = models.DateTimeField(null=True, blank=True, db_index=True)
    ply_count = models.PositiveIntegerField(default=0)
    provider_accuracy = models.JSONField(null=True, blank=True)  # provider-supplied; never our own
    imported_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-played_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "provider", "external_id"],
                condition=~Q(external_id=""),
                name="unique_external_game_per_user",
            ),
            models.UniqueConstraint(fields=["user", "content_hash"], name="unique_game_content_per_user"),
        ]
        indexes = [
            models.Index(fields=["user", "time_class"]),
            models.Index(fields=["user", "user_colour"]),
            models.Index(fields=["user", "opponent"]),
        ]

    def __str__(self) -> str:
        return f"{self.white} vs {self.black} ({self.result})"


class Move(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="moves")
    ply = models.PositiveIntegerField()
    colour = models.CharField(max_length=1)
    san = models.CharField(max_length=16)
    uci = models.CharField(max_length=8)
    fen_before = models.CharField(max_length=100)
    fen_after = models.CharField(max_length=100)
    legal_move_count = models.PositiveSmallIntegerField(default=0)
    clock_seconds = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ["ply"]
        constraints = [models.UniqueConstraint(fields=["game", "ply"], name="unique_ply_per_game")]


class SyncCursor(models.Model):
    """Per external account sync state, so repeated syncs are idempotent and cheap."""

    account = models.OneToOneField("accounts.ExternalAccount", on_delete=models.CASCADE, related_name="cursor")
    # Chess.com: {"YYYY/MM": {"etag": str|None, "last_modified": str|None, "complete": bool}}
    chesscom_months = models.JSONField(default=dict)
    # Lichess: highest lastMoveAt (ms) seen.
    lichess_since_ms = models.BigIntegerField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
