from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from analysis.services import run_to_frontend
from games.models import Game

from .models import AnalysisJob
from .profiles import PROFILES
from .quotas import active_jobs, remaining_positions_today
from .tasks import run_cloud_job


class JobSerializer(serializers.ModelSerializer):
    class Meta:
        model = AnalysisJob
        fields = [
            "id", "game", "profile", "status", "cancel_requested", "progress_done", "progress_total",
            "progress_label", "positions_analysed", "error", "run", "stats", "created_at", "started_at", "finished_at",
        ]


class ProfilesView(APIView):
    def get(self, request):
        return Response({
            "enabled": settings.CLOUD_ANALYSIS_ENABLED,
            "profiles": [{"id": p.id, "label": p.label} for p in PROFILES.values()],
            "remaining_positions_today": remaining_positions_today(request.user),
            "max_active_jobs": settings.CLOUD_MAX_ACTIVE_JOBS_PER_USER,
        })


class AnalyseGameView(APIView):
    throttle_scope = "cloud"

    def post(self, request, pk: int):
        if not settings.CLOUD_ANALYSIS_ENABLED:
            return Response({"detail": "Cloud analysis is disabled."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        game = get_object_or_404(Game, pk=pk, user=request.user)
        profile = str(request.data.get("profile", "cloud-standard"))
        if profile not in PROFILES:
            return Response({"detail": "Unknown profile."}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            existing = AnalysisJob.objects.filter(game=game, profile=profile, status__in=AnalysisJob.ACTIVE).first()
            if existing:  # dedupe: same game + profile already queued/running
                return Response(JobSerializer(existing).data, status=status.HTTP_200_OK)
            if active_jobs(request.user) >= settings.CLOUD_MAX_ACTIVE_JOBS_PER_USER:
                return Response({"detail": "Too many active cloud jobs. Wait for one to finish."}, status=429)
            if remaining_positions_today(request.user) < game.ply_count + 1:
                return Response({"detail": "Daily cloud analysis quota reached."}, status=429)
            job = AnalysisJob.objects.create(user=request.user, game=game, profile=profile,
                                             progress_total=game.ply_count + 1)
        transaction.on_commit(lambda: run_cloud_job.delay(job.id))
        return Response(JobSerializer(job).data, status=status.HTTP_202_ACCEPTED)


class JobListView(APIView):
    def get(self, request):
        jobs = AnalysisJob.objects.filter(user=request.user)[:50]
        return Response(JobSerializer(jobs, many=True).data)


class JobDetailView(APIView):
    def get(self, request, pk: int):
        job = get_object_or_404(AnalysisJob, pk=pk, user=request.user)
        data = JobSerializer(job).data
        if job.run_id:
            data["analysis"] = run_to_frontend(job.run)
        return Response(data)


class JobCancelView(APIView):
    def post(self, request, pk: int):
        job = get_object_or_404(AnalysisJob, pk=pk, user=request.user)
        if job.status in AnalysisJob.ACTIVE:
            job.cancel_requested = True
            if job.status == AnalysisJob.Status.QUEUED:
                job.status = AnalysisJob.Status.CANCELLED
            job.save(update_fields=["cancel_requested", "status"])
        return Response(JobSerializer(job).data)
