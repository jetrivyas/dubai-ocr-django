import json
import requests
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

API_BASE_URL = "https://jumeirah-ai.testyourapp.online"

def index(request):
    return render(request, 'scanner/index.html')

@csrf_exempt
@require_POST
def proxy_extract_passport(request):
    """
    Proxy endpoint to forward the passport image to the external API.
    """
    try:
        front_file = request.FILES.get('front_file')
        if not front_file:
            return JsonResponse({'error': 'No image provided'}, status=400)

        files = {'front_file': (front_file.name, front_file.read(), front_file.content_type)}
        response = requests.post(f"{API_BASE_URL}/extract_passport", files=files)
        
        return JsonResponse(response.json(), status=response.status_code)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
@require_POST
def proxy_extract_id(request):
    """
    Proxy endpoint to forward the ID images (front and back) to the external API.
    """
    try:
        front_file = request.FILES.get('front_file')
        back_file = request.FILES.get('back_file')
        doc_type = request.POST.get('doc_type', 'emirates_id')

        if not front_file or not back_file:
            return JsonResponse({'error': 'Both front and back images are required'}, status=400)

        files = {
            'front_file': (front_file.name, front_file.read(), front_file.content_type),
            'back_file': (back_file.name, back_file.read(), back_file.content_type),
        }
        
        params = {'doc_type': doc_type}
        response = requests.post(f"{API_BASE_URL}/extract_id", files=files, params=params)
        
        return JsonResponse(response.json(), status=response.status_code)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
