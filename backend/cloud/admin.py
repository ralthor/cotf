from django.contrib import admin

from .models import AnalysisJob


@admin.register(AnalysisJob)
class AnalysisJobAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "game", "profile", "status", "progress_done", "progress_total", "created_at")
    list_filter = ("status", "profile")
