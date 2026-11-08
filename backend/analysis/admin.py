from django.contrib import admin

from .models import AnalysisRun


@admin.register(AnalysisRun)
class AnalysisRunAdmin(admin.ModelAdmin):
    list_display = ("id", "game", "source", "profile", "engine_id", "status", "created_at")
    list_filter = ("source", "profile", "status")
