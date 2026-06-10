from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('api/extract_passport/', views.proxy_extract_passport, name='proxy_extract_passport'),
    path('api/extract_id/', views.proxy_extract_id, name='proxy_extract_id'),
]
