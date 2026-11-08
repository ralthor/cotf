from django.conf import settings
from django.db import models


class AnalysisJob(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        DONE = "done", "Done"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    ACTIVE = (Status.QUEUED, Status.RUNNING)

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="analysis_jobs")
    game = models.ForeignKey("games.Game", on_delete=models.CASCADE, related_name="analysis_jobs")
    profile = models.CharField(max_length=32)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    cancel_requested = models.BooleanField(default=False)
    progress_done = models.PositiveIntegerField(default=0)
    progress_total = models.PositiveIntegerField(default=0)
    progress_label = models.CharField(max_length=100, blank=True, default="")
    positions_analysed = models.PositiveIntegerField(default=0)
    error = models.TextField(blank=True, default="")
    run = models.ForeignKey("analysis.AnalysisRun", null=True, blank=True, on_delete=models.SET_NULL)
    celery_task_id = models.CharField(max_length=64, blank=True, default="")
    stats = models.JSONField(default=dict)  # achieved depth, nodes, duration, cpu seconds
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    heartbeat_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "status"])]
