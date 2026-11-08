from django.contrib import admin

from .models import Game, SyncCursor


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "provider", "white", "black", "result", "time_class", "played_at")
    list_filter = ("provider", "time_class", "user_result")
    search_fields = ("white", "black", "external_id")


admin.site.register(SyncCursor)
