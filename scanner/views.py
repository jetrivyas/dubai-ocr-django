import json
import requests
from datetime import datetime
from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from .db import scan_sessions_collection

API_BASE_URL = "https://jumeirah-ai.testyourapp.online"

def get_client_ip(request):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0]
    else:
        ip = request.META.get('REMOTE_ADDR')
    return ip

def save_scan_result_to_db(request, doc_type, data):
    # Ensure session exists
    if not request.session.session_key:
        request.session.create()
        
    if scan_sessions_collection is None:
        return # DB not configured

    session_id = request.session.session_key
    ip_address = get_client_ip(request)
    
    # Extract structured data
    ocr_data = data.get('data', {}).get('ocrData', {})
    if not ocr_data:
        return
        
    structured_data = {}
    
    # Common fields we want to extract if they exist
    fields_to_extract = [
        'doc_type', 'type', 'mrz1', 'mrz2', 'mrz3', 'firstName', 'lastName', 
        'name', 'gender', 'nationality', 'documentNumber', 'dateOfBirth',
        'dateOfExpiry', 'dateOfIssue', 'personalNumber', 'issuingState', 
        'issueFront'
    ]
    
    for field in fields_to_extract:
        if field in ocr_data:
            structured_data[field] = ocr_data[field]

    doc = {
        'session_id': session_id,
        'ip_address': ip_address,
        'timestamp': datetime.utcnow(),
        'doc_type': doc_type,
        'structured_data': structured_data,
        'status': 'success'
    }
    
    try:
        scan_sessions_collection.insert_one(doc)
    except Exception as e:
        print(f"Failed to save to MongoDB: {e}")

def index(request):
    if not request.session.session_key:
        request.session.create()
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
        
        data = response.json()
        if response.status_code == 200 and not data.get('error'):
            save_scan_result_to_db(request, 'passport', data)
            
        return JsonResponse(data, status=response.status_code)

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
        
        data = response.json()
        if response.status_code == 200 and not data.get('error'):
            save_scan_result_to_db(request, 'id', data)
            
        return JsonResponse(data, status=response.status_code)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
