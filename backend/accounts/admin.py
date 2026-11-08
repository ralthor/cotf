from django.contrib import admin

from .models import ExternalAccount


@admin.register(ExternalAccount)
class ExternalAccountAdmin(admin.ModelAdmin):
    list_display = ("user", "provider", "username", "last_synced_at", "last_sync_status")
    list_filter = ("provider", "last_sync_status")
