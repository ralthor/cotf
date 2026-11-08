"""Django settings. Everything environment-specific comes from environment variables."""

import os
from pathlib import Path

import dj_database_url
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [x.strip() for x in os.environ.get(name, default).split(",") if x.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG and not os.environ.get("PYTEST_CURRENT_TEST") and os.environ.get("DJANGO_ALLOW_INSECURE_KEY") != "1":
        raise RuntimeError("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is off.")
    SECRET_KEY = "dev-insecure-key-do-not-use-in-production"

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "django_filters",
    "accounts",
    "games",
    "analysis",
    "cloud",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# PostgreSQL in production (DATABASE_URL=postgres://...); SQLite for local dev and tests.
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}", conn_max_age=60, conn_health_checks=True
    )
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "user": "600/min",
        "auth": "10/min",
        "imports": "20/hour",
        "cloud": "30/hour",
    },
}

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173")

# --- Celery -------------------------------------------------------------------------------------
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = None
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER", False)
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_ROUTES = {
    "games.tasks.*": {"queue": "sync"},
    "cloud.tasks.*": {"queue": "engine"},
}
CELERY_BEAT_SCHEDULE = {
    "sync-all-external-accounts": {
        "task": "games.tasks.sync_all_accounts",
        "schedule": crontab(minute=17, hour="*/6"),
    },
    "reap-stale-cloud-jobs": {
        "task": "cloud.tasks.reap_stale_jobs",
        "schedule": crontab(minute="*/10"),
    },
}

# --- Provider sync --------------------------------------------------------------------------------
# Server-side requests identify the app; set a real contact address in production.
PROVIDER_USER_AGENT = os.environ.get(
    "PROVIDER_USER_AGENT", "ChessGameAnalyser/0.1 (self-hosted; contact: admin@example.invalid)"
)
SYNC_MAX_MONTHS_INITIAL = int(os.environ.get("SYNC_MAX_MONTHS_INITIAL", "3"))
SYNC_LICHESS_MAX_GAMES = int(os.environ.get("SYNC_LICHESS_MAX_GAMES", "300"))
MAX_PGN_BYTES = 5 * 1024 * 1024

# --- Cloud analysis (Phase 3) ---------------------------------------------------------------------
STOCKFISH_PATH = os.environ.get("STOCKFISH_PATH", "stockfish")
CLOUD_ANALYSIS_ENABLED = env_bool("CLOUD_ANALYSIS_ENABLED", True)
CLOUD_MAX_ACTIVE_JOBS_PER_USER = int(os.environ.get("CLOUD_MAX_ACTIVE_JOBS_PER_USER", "2"))
CLOUD_DAILY_QUOTA_POSITIONS = int(os.environ.get("CLOUD_DAILY_QUOTA_POSITIONS", "2000"))
CLOUD_JOB_TIME_LIMIT_S = int(os.environ.get("CLOUD_JOB_TIME_LIMIT_S", "1800"))
CLOUD_ENGINE_THREADS = int(os.environ.get("CLOUD_ENGINE_THREADS", "2"))
CLOUD_ENGINE_HASH_MB = int(os.environ.get("CLOUD_ENGINE_HASH_MB", "256"))

if not DEBUG:
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SESSION_COOKIE_SECURE = env_bool("SECURE_COOKIES", True)
    CSRF_COOKIE_SECURE = env_bool("SECURE_COOKIES", True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}
