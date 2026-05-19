import firebase_admin
from firebase_admin import credentials, firestore
import pandas as pd
import numpy as np
from datetime import datetime
import time

# ==========================================
# KYLRX AI - ENTERPRISE ML ENGINE (PYTHON)
# ==========================================
# This script serves as the backend intelligence layer for Kylrx AI.
# It fetches real-time workforce telemetry and applies behavioral 
# clustering and productivity regression.
# ==========================================

# 1. Initialize Firebase Admin SDK
# Note: You need to download your serviceAccountKey.json from Firebase Console
# Settings > Project Settings > Service accounts > Generate new private key
try:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("🔥 Kylrx AI Engine: Connected to Firebase Firestore")
except Exception as e:
    print(f"❌ Error: Service account key not found or invalid. {e}")
    print("💡 Please place 'serviceAccountKey.json' in this directory to enable the AI Engine.")
    exit()

def calculate_ai_insights(session_data):
    """
    Simulates a Behavioral Intelligence Model.
    In a production environment, this would call a pre-trained 
    Scikit-Learn or TensorFlow model.
    """
    active_time = session_data.get('activeTime', 0)
    idle_time = session_data.get('idleTime', 0)
    focus_loss = session_data.get('focusLossCount', 0)
    
    # Simple Regression Logic for Productivity
    total_time = active_time + idle_time + 1
    productivity_base = (active_time / total_time) * 100
    
    # Penalize based on behavioral anomalies (Focus loss)
    penalty = focus_loss * 2.5
    ai_score = max(0, min(100, productivity_base - penalty))
    
    # ML Classification: Burnout vs. High Performer
    risk_level = "Low"
    if productivity_base > 90 and focus_loss > 5:
        risk_level = "High (Burnout Risk)"
    elif ai_score < 40:
        risk_level = "Critical (Performance Risk)"
        
    return {
        "aiProductivityScore": round(ai_score, 2),
        "performanceRisk": risk_level,
        "behavioralLabel": "Elite" if ai_score > 90 else "Standard",
        "lastAnalysed": firestore.SERVER_TIMESTAMP
    }

def run_ai_engine():
    print("🚀 Kylrx AI Intelligence Stream Started...")
    
    # Listen to today's sessions
    today = datetime.now().strftime('%Y-%m-%d')
    sessions_ref = db.collection('hrms_sessions').where('date', '==', today)
    
    def on_snapshot(col_snapshot, changes, read_time):
        print(f"🧠 Processing {len(col_snapshot)} workforce profiles...")
        for doc in col_snapshot:
            data = doc.to_dict()
            user_id = data.get('userId')
            
            if not user_id:
                continue
                
            # Perform AI Inference
            insights = calculate_ai_insights(data)
            
            # Update activityStatus with AI insights
            db.collection('activityStatus').document(user_id).set({
                "aiScore": insights['aiProductivityScore'],
                "aiRisk": insights['performanceRisk'],
                "aiLabel": insights['behavioralLabel'],
                "mlEngineSync": True,
                "lastUpdate": firestore.SERVER_TIMESTAMP
            }, merge=True)
            
            print(f"✅ AI Analysis Complete for {data.get('userName', user_id)}: Score {insights['aiProductivityScore']}")

    # Watch the collection
    sessions_ref.on_snapshot(on_snapshot)

    # Keep the script running
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("Stopping AI Engine...")

if __name__ == "__main__":
    run_ai_engine()
