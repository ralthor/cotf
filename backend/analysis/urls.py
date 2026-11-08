from django.urls import path

from . import views

urlpatterns = [
    path("games/<int:pk>/analysis/", views.GameAnalysisView.as_view()),
    path("stats/", views.StatsView.as_view()),
]
