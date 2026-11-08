from django.db import models


class AnalysisRun(models.Model):
    """One immutable engine analysis of a game. New settings ⇒ new run; old runs are never overwritten."""

    class Source(models.TextChoices):
        BROWSER = "browser", "Browser (WASM)"
        CLOUD = "cloud", "Cloud worker (native)"

    class Status(models.TextChoices):
        COMPLETE = "complete", "Complete"
        PARTIAL = "partial", "Partial"

    game = models.ForeignKey("games.Game", on_delete=models.CASCADE, related_name="analysis_runs")
    source = models.CharField(max_length=16, choices=Source.choices)
    profile = models.CharField(max_length=32)  # e.g. browser-standard, cloud-deep
    engine_id = models.CharField(max_length=120)
    engine_version = models.CharField(max_length=40, blank=True, default="")
    settings = models.JSONField(default=dict)  # depth, nodes, multipv, threads, hash, ...
    policy_version = models.CharField(max_length=16)
    accuracy_version = models.CharField(max_length=16)
    brilliancy_version = models.CharField(max_length=16, blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.COMPLETE)
    summary = models.JSONField(default=dict)
    position_evals = models.JSONField(default=list)  # white-relative score per position (N+1)
    stats = models.JSONField(default=dict)  # achieved depth, nodes, duration, cost for cloud runs
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["game", "-created_at"])]


class MoveClassification(models.Model):
    run = models.ForeignKey(AnalysisRun, on_delete=models.CASCADE, related_name="moves")
    ply = models.PositiveIntegerField()
    colour = models.CharField(max_length=1)
    san = models.CharField(max_length=16)
    uci = models.CharField(max_length=8)
    depth = models.PositiveSmallIntegerField(default=0)
    best_move_uci = models.CharField(max_length=8, blank=True, default="")
    best_score = models.JSONField(null=True)
    played_score = models.JSONField(null=True)
    second_score = models.JSONField(null=True)
    lines = models.JSONField(default=list)
    category = models.CharField(max_length=16, blank=True, default="")
    centipawn_loss = models.FloatField(null=True)
    expected_loss_pct = models.FloatField(null=True)
    forced = models.BooleanField(default=False)
    reasons = models.JSONField(default=list)
    brilliance = models.JSONField(null=True)

    class Meta:
        ordering = ["ply"]
        constraints = [models.UniqueConstraint(fields=["run", "ply"], name="unique_ply_per_run")]
