from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter(trailing_slash=True)
router.register("games", views.GameViewSet, basename="game")

urlpatterns = [
    path("imports/pgn/", views.PgnImportView.as_view()),
    path("imports/chesscom/", views.ChessComImportView.as_view()),
    path("imports/lichess/", views.LichessImportView.as_view()),
    path("accounts/external/<int:pk>/sync/", views.SyncNowView.as_view()),
    *router.urls,
]
