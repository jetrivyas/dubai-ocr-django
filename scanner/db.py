import os
from pymongo import MongoClient
from django.conf import settings

# Initialize MongoDB client
try:
    client = MongoClient(settings.MONGO_URI, serverSelectionTimeoutMS=5000)
    db = client[settings.MONGO_DB_NAME]
    
    # Expose the collections
    scan_sessions_collection = db['scan_sessions']
except Exception as e:
    print(f"Warning: Could not connect to MongoDB: {e}")
    client = None
    db = None
    scan_sessions_collection = None
