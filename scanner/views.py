import requests
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from django.conf import settings

API_BASE_URL = getattr(settings, "OCR_API_BASE_URL", "https://jumeirah-ai.testyourapp.online")
API_TIMEOUT  = getattr(settings, "OCR_API_TIMEOUT", 15)   # seconds
MAX_UPLOAD_MB = getattr(settings, "OCR_MAX_UPLOAD_MB", 4)  # megabytes


def index(request):
    return render(request, "scanner/index.html")


def _size_check(file_obj):
    """Return True if file is within allowed size limit."""
    return file_obj.size <= MAX_UPLOAD_MB * 1024 * 1024


@csrf_exempt
@require_POST
def proxy_extract_passport(request):
    front_file = request.FILES.get("front_file")
    if not front_file:
        return JsonResponse({"error": "No image provided"}, status=400)
    if not _size_check(front_file):
        return JsonResponse({"error": f"Image too large (max {MAX_UPLOAD_MB} MB)"}, status=413)

    try:
        files = {"front_file": (front_file.name, front_file.read(), front_file.content_type)}
        resp = requests.post(
            f"{API_BASE_URL}/extract_passport",
            files=files,
            timeout=API_TIMEOUT,
        )
        resp.raise_for_status()
        return JsonResponse(resp.json(), status=resp.status_code)
    except requests.Timeout:
        return JsonResponse({"error": "OCR API timed out — try again"}, status=504)
    except requests.ConnectionError:
        return JsonResponse({"error": "Could not reach OCR API"}, status=502)
    except requests.HTTPError as exc:
        return JsonResponse({"error": f"OCR API error: {exc.response.status_code}"}, status=502)
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=500)


@csrf_exempt
@require_POST
def proxy_extract_id(request):
    front_file = request.FILES.get("front_file")
    back_file  = request.FILES.get("back_file")
    doc_type   = request.POST.get("doc_type", "emirates_id")

    if not front_file or not back_file:
        return JsonResponse({"error": "Both front and back images are required"}, status=400)
    if not _size_check(front_file) or not _size_check(back_file):
        return JsonResponse({"error": f"Image too large (max {MAX_UPLOAD_MB} MB per file)"}, status=413)

    try:
        files = {
            "front_file": (front_file.name, front_file.read(), front_file.content_type),
            "back_file":  (back_file.name,  back_file.read(),  back_file.content_type),
        }
        resp = requests.post(
            f"{API_BASE_URL}/extract_id",
            files=files,
            params={"doc_type": doc_type},
            timeout=API_TIMEOUT,
        )
        resp.raise_for_status()
        return JsonResponse(resp.json(), status=resp.status_code)
    except requests.Timeout:
        return JsonResponse({"error": "OCR API timed out — try again"}, status=504)
    except requests.ConnectionError:
        return JsonResponse({"error": "Could not reach OCR API"}, status=502)
    except requests.HTTPError as exc:
        return JsonResponse({"error": f"OCR API error: {exc.response.status_code}"}, status=502)
    except Exception as exc:
        return JsonResponse({"error": str(exc)}, status=500)
