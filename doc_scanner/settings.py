from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

# ------------------------------------------------------------------
# Security — load from environment, never hardcode
# ------------------------------------------------------------------
SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "django-insecure-change-me-in-production"  # dev fallback only
)
DEBUG = os.environ.get("DJANGO_DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# ------------------------------------------------------------------
# OCR API config — override via environment variables
# ------------------------------------------------------------------
OCR_API_BASE_URL  = os.environ.get("OCR_API_BASE_URL", "https://jumeirah-ai.testyourapp.online")
OCR_API_TIMEOUT   = int(os.environ.get("OCR_API_TIMEOUT", "15"))   # seconds
OCR_MAX_UPLOAD_MB = int(os.environ.get("OCR_MAX_UPLOAD_MB", "4"))   # megabytes

# ------------------------------------------------------------------
# Application
# ------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.staticfiles",   # Only keep what you actually use
    "scanner",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "doc_scanner.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
            ],
        },
    },
]

WSGI_APPLICATION = "doc_scanner.wsgi.application"

# No database needed — this app does zero DB writes
DATABASES = {}

# ------------------------------------------------------------------
# Upload limits — reject oversized images at Django layer
# ------------------------------------------------------------------
DATA_UPLOAD_MAX_MEMORY_SIZE = OCR_MAX_UPLOAD_MB * 2 * 1024 * 1024  # front + back

# ------------------------------------------------------------------
# Static files
# ------------------------------------------------------------------
STATIC_URL  = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Django 5 syntax for whitenoise compressed static files
STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
