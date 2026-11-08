import pytest
from django.test import override_settings
from rest_framework.test import APIClient


@pytest.fixture(autouse=True)
def _eager_celery(settings):
    settings.CELERY_TASK_ALWAYS_EAGER = True
    from config.celery import app

    app.conf.task_always_eager = True
    app.conf.task_eager_propagates = True
    yield


@pytest.fixture
def user(django_user_model):
    return django_user_model.objects.create_user(username="alice", password="s3cure-pass-123")


@pytest.fixture
def api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def anon():
    return APIClient()


__all__ = ["override_settings"]
