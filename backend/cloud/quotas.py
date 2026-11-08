import datetime as dt

from django.conf import settings
from django.db.models import Sum
from django.utils import timezone

from .models import AnalysisJob


def positions_used_today(user) -> int:
    since = timezone.now() - dt.timedelta(days=1)
    return AnalysisJob.objects.filter(user=user, created_at__gte=since).aggregate(n=Sum("positions_analysed"))["n"] or 0


def remaining_positions_today(user) -> int:
    return max(0, settings.CLOUD_DAILY_QUOTA_POSITIONS - positions_used_today(user))


def active_jobs(user) -> int:
    return AnalysisJob.objects.filter(user=user, status__in=AnalysisJob.ACTIVE).count()
