import datetime as dt
import logging

from celery import shared_task
from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.db.models import F
from django.utils import timezone

from analysis.models import AnalysisRun
from analysis.services import create_run

from .analyser import Cancelled, CloudGameAnalyser
from .engine import StockfishRunner
from .models import AnalysisJob
from .profiles import PROFILES
from .quotas import remaining_positions_today

log = logging.getLogger(__name__)


@shared_task(bind=True, acks_late=True, soft_time_limit=settings.CLOUD_JOB_TIME_LIMIT_S,
             time_limit=settings.CLOUD_JOB_TIME_LIMIT_S + 60)
def run_cloud_job(self, job_id: int) -> str:
    job = AnalysisJob.objects.select_related("game").filter(id=job_id).first()
    if job is None or job.status != AnalysisJob.Status.QUEUED:
        return "skipped"
    if job.cancel_requested:
        AnalysisJob.objects.filter(id=job.id).update(status=AnalysisJob.Status.CANCELLED, finished_at=timezone.now())
        return "cancelled"
    profile = PROFILES[job.profile]
    AnalysisJob.objects.filter(id=job.id).update(
        status=AnalysisJob.Status.RUNNING, started_at=timezone.now(), heartbeat_at=timezone.now(),
        celery_task_id=self.request.id or "",
    )

    def should_cancel() -> bool:
        return AnalysisJob.objects.filter(id=job.id, cancel_requested=True).exists()

    def on_progress(done: int, total: int, label: str) -> None:
        AnalysisJob.objects.filter(id=job.id).update(
            progress_done=done, progress_total=total, progress_label=label[:100], heartbeat_at=timezone.now()
        )

    budget = remaining_positions_today(job.user)
    analyser = None
    try:
        with StockfishRunner() as runner:
            analyser = CloudGameAnalyser(runner, profile, should_cancel, on_progress, position_budget=budget)
            result = analyser.run(job.game)
        run = create_run(
            job.game,
            source=AnalysisRun.Source.CLOUD,
            profile=profile.id,
            engine_id=result["stats"]["engine"],
            engine_version=result["stats"]["engine"].split(" ")[-1],
            settings={**profile.as_dict(), **result["stats"]["engine_settings"]},
            moves=result["moves"],
            position_evals=result["positionEvals"],
            brilliancy_version=result["stats"]["brilliancy_version"],
            stats=result["stats"],
        )
        AnalysisJob.objects.filter(id=job.id).update(
            status=AnalysisJob.Status.DONE, run=run, finished_at=timezone.now(), stats=result["stats"],
            positions_analysed=F("positions_analysed") + analyser.searches, progress_label="Complete",
        )
        return "done"
    except Cancelled as exc:
        AnalysisJob.objects.filter(id=job.id).update(
            status=AnalysisJob.Status.CANCELLED, finished_at=timezone.now(), error=str(exc),
            positions_analysed=F("positions_analysed") + (analyser.searches if analyser else 0),
        )
        return "cancelled"
    except SoftTimeLimitExceeded:
        AnalysisJob.objects.filter(id=job.id).update(
            status=AnalysisJob.Status.FAILED, finished_at=timezone.now(), error="Time limit exceeded."
        )
        return "timeout"
    except Exception as exc:  # noqa: BLE001 - report any engine failure on the job
        log.exception("cloud job %s failed", job.id)
        AnalysisJob.objects.filter(id=job.id).update(
            status=AnalysisJob.Status.FAILED, finished_at=timezone.now(), error=str(exc)[:1000]
        )
        return "failed"


@shared_task
def reap_stale_jobs() -> int:
    """Marks running jobs with no heartbeat for 15 minutes as failed (worker crash)."""
    cutoff = timezone.now() - dt.timedelta(minutes=15)
    return AnalysisJob.objects.filter(status=AnalysisJob.Status.RUNNING, heartbeat_at__lt=cutoff).update(
        status=AnalysisJob.Status.FAILED, error="Worker stopped responding.", finished_at=timezone.now()
    )
