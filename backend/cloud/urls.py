from django.urls import path

from . import views

urlpatterns = [
    path("engine-profiles/", views.ProfilesView.as_view()),
    path("games/<int:pk>/analyse/", views.AnalyseGameView.as_view()),
    path("analysis-jobs/", views.JobListView.as_view()),
    path("analysis-jobs/<int:pk>/", views.JobDetailView.as_view()),
    path("analysis-jobs/<int:pk>/cancel/", views.JobCancelView.as_view()),
]
