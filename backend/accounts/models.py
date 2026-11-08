from django.conf import settings
from django.db import models


class Provider(models.TextChoices):
    CHESSCOM = "chesscom", "Chess.com"
    LICHESS = "lichess", "Lichess"


class ExternalAccount(models.Model):
    """A public username on a chess site. No provider credentials are ever stored."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="external_accounts")
    provider = models.CharField(max_length=16, choices=Provider.choices)
    username = models.CharField(max_length=50)
    created_at = models.DateTimeField(auto_now_add=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_sync_status = models.CharField(max_length=16, default="never")  # never|ok|error|running
    last_sync_error = models.TextField(blank=True, default="")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "provider"], name="one_account_per_provider")]

    def __str__(self) -> str:
        return f"{self.provider}:{self.username}"
