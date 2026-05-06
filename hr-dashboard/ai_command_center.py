import firebase_admin
from firebase_admin import credentials, firestore
import threading
import time
import datetime
import random
import numpy as np
import tkinter as tk
from tkinter import ttk
import pandas as pd

# Machine Learning Imports
try:
    from sklearn.ensemble import IsolationForest, RandomForestClassifier
    from sklearn.linear_model import LinearRegression
    from sklearn.tree import DecisionTreeClassifier
except ImportError:
    print("Please install required packages: pip install scikit-learn pandas numpy firebase-admin")
    exit(1)

# ==========================================
# 1. FIREBASE INTEGRATION LAYER
# ==========================================
class FirebaseController:
    def __init__(self):
        try:
            # Use the service account key found in the config directory
            cred = credentials.Certificate("config/serviceAccountKey.json")
            firebase_admin.initialize_app(cred)
            self.db = firestore.client()
            print("Firebase Admin Initialized Successfully.")
        except Exception as e:
            print(f"Firebase Init Error: {e}")
            exit(1)

    def get_all_telemetry(self):
        docs = self.db.collection('activityStatus').stream()
        return [doc.to_dict() | {"id": doc.id} for doc in docs]

    def create_alert(self, user_id, dept_id, severity, message):
        alert_ref = self.db.collection('alertEvents').document()
        alert_ref.set({
            "userId": user_id,
            "departmentId": dept_id,
            "severity": severity,
            "message": message,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "source": "AI_ML_ENGINE"
        })

    def create_insight(self, dept_id, message):
        insight_ref = self.db.collection('aiInsights').document()
        insight_ref.set({
            "departmentId": dept_id,
            "message": message,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "type": "productivity_drop" if "productivity" in message.lower() else "behavior_alert"
        })

    def update_user_ai_labels(self, user_id, productivity, behavior, is_anomaly):
        user_ref = self.db.collection('activityStatus').document(user_id)
        user_ref.update({
            "aiProductivityScore": productivity,
            "aiBehaviorLabel": behavior,
            "isAnomaly": is_anomaly,
            "lastAIUpdate": firestore.SERVER_TIMESTAMP
        })

    def get_campaigns(self):
        return [doc.to_dict() for doc in self.db.collection('campaigns').stream()]

# ==========================================
# 2. MACHINE LEARNING MODULE
# ==========================================
class AIModels:
    def __init__(self):
        # 1. Anomaly Detection (Isolation Forest)
        self.iso_forest = IsolationForest(contamination=0.1, random_state=42)
        # 2. Productivity Prediction (Linear Regression)
        self.lin_reg = LinearRegression()
        # 3. Behavior Classification (Decision Tree)
        self.tree_clf = DecisionTreeClassifier(random_state=42)
        # 4. Burnout Risk Prediction (Classification)
        self.burnout_clf = RandomForestClassifier(n_estimators=10, random_state=42)
        
        self._train_initial_models()

    def _train_initial_models(self):
        # Features: [activeTime, idleTime, tabSwitchCount]
        X_train = np.array([
            [300, 10, 2],   # Normal, Focused
            [600, 5, 1],    # Normal, Focused
            [50, 400, 0],   # Normal, Idle
            [200, 10, 45],  # Anomaly, Highly Distracted
            [10, 800, 0],   # Normal, Idle
            [400, 20, 5],   # Normal, Focused
            [150, 30, 80],  # Anomaly, Highly Distracted
            [350, 10, 4]    # Normal, Normal
        ])
        
        # 1. Train Anomaly Detection
        self.iso_forest.fit(X_train)
        
        # 2. Train Productivity Prediction (Target Score 0-100)
        y_prod = np.array([95, 98, 15, 45, 5, 88, 30, 90])
        self.lin_reg.fit(X_train, y_prod)
        
        # 3. Train Behavior Classification 
        # 0: Focused, 1: Normal, 2: Distracted, 3: Highly Distracted
        y_behav = np.array([0, 0, 2, 3, 2, 1, 3, 1])
        self.tree_clf.fit(X_train, y_behav)

        # 4. Train Burnout Risk (0: Low Risk, 1: High Risk)
        # Assuming High Risk = High Idle + Low Tab Switches (completely disengaged) OR High Active + Low Breaks over long term
        y_burnout = np.array([0, 0, 1, 0, 1, 0, 0, 0])
        self.burnout_clf.fit(X_train, y_burnout)

    def analyze_user(self, user):
        # Handle potential missing keys from Firestore
        active = float(user.get("activeTime", 0))
        idle = float(user.get("idleTime", 0))
        switches = float(user.get("tabSwitchCount", 0))
        
        X = np.array([[active, idle, switches]])
        
        # Predict Anomaly
        anomaly_score = self.iso_forest.predict(X)[0]
        is_anomaly = (anomaly_score == -1)
        
        # Predict Productivity
        prod_score = self.lin_reg.predict(X)[0]
        prod_score = max(0, min(100, int(prod_score)))
        
        # Predict Behavior
        behavior_idx = self.tree_clf.predict(X)[0]
        behaviors = ["Focused", "Normal", "Distracted", "Highly Distracted"]
        behavior = behaviors[behavior_idx]
        
        # Predict Burnout
        burnout_risk = "High" if self.burnout_clf.predict(X)[0] == 1 else "Low"
        
        return {
            "is_anomaly": is_anomaly,
            "productivity": prod_score,
            "behavior": behavior,
            "burnout_risk": burnout_risk
        }

# ==========================================
# 3. AI AGENT & AUTOMATION ENGINE
# ==========================================
class AIAgent(threading.Thread):
    def __init__(self, firebase, ui_controller):
        super().__init__(daemon=True)
        self.fb = firebase
        self.ui = ui_controller
        self.models = AIModels()
        self.running = True

    def run(self):
        while self.running:
            try:
                self.ui.log_action("Executing AI Analysis Cycle...")
                
                # 1. Fetch live telemetry
                users = self.fb.get_all_telemetry()
                insights = []
                
                for user in users:
                    user_id = user.get("id")
                    name = user.get("name", "Unknown")
                    dept = user.get("departmentId", "General")
                    
                    # 2. ML Analysis
                    analysis = self.models.analyze_user(user)
                    user["ai_analysis"] = analysis
                    
                    # 3. AI Decision Engine
                    # A. Anomaly Detection
                    if analysis["is_anomaly"]:
                        self.fb.create_alert(user_id, dept, "warning", f"AI Detected anomalous behavior pattern for {name}.")
                        self.ui.log_action(f"[ALERT] Anomaly: {name}")
                    
                    # B. Productivity drop
                    if analysis["productivity"] < 35:
                        self.fb.create_insight(dept, f"Productivity warning: {name}'s score dropped to {analysis['productivity']}%")
                        self.ui.log_action(f"[INSIGHT] Low Productivity: {name}")
                        
                    # C. Distraction & Social Media Check
                    if analysis["behavior"] == "Highly Distracted" or (status == "Away" and user.get("tabSwitchCount", 0) > 3):
                        self.fb.create_alert(user_id, dept, "info", f"{name} detected on external tabs. Potential Social Media usage (Tab switches: {user.get('tabSwitchCount',0)})")
                        self.ui.log_action(f"[ALERT] Social Media/Distraction: {name}")
                        # Force update behavior label for visibility
                        analysis["behavior"] = "External Distraction"

                    # SMART ALERTS: Burnout and Inactivity
                    if analysis["burnout_risk"] == "High":
                        self.fb.create_insight(dept, f"High Burnout Risk predicted for {name}. Recommend check-in.")
                        self.ui.log_action(f"[INSIGHT] Burnout Risk: {name}")

                    # D. Auto-Flag Low Activity
                    idle_time = float(user.get("idleTime", 0))
                    if idle_time > 7200: # 2 hours idle
                        self.fb.create_alert("sys", dept, "critical", f"Employee inactive for 2+ hours: {name}")
                        self.ui.log_action(f"[ALERT] Extreme Inactivity: {name}")
                        self.fb.update_user_ai_labels(user_id, analysis["productivity"], "AWOL", analysis["is_anomaly"])
                    elif idle_time > 600: # 10 mins idle
                        # Mark as Low Activity in Firestore
                        self.fb.update_user_ai_labels(user_id, analysis["productivity"], "Low Activity", analysis["is_anomaly"])
                    else:
                        # 4. Sync results to Firestore
                        self.fb.update_user_ai_labels(user_id, analysis["productivity"], analysis["behavior"], analysis["is_anomaly"])

                # 5. Marketing Performance Check
                campaigns = self.fb.get_campaigns()
                for c in campaigns:
                    if c.get("status") == "Active":
                        budget = float(c.get("budget", 0))
                        if budget > 100000:
                            self.fb.create_alert("sys", "Marketing", "info", f"High priority campaign active: {c.get('name')}")
                            insights.append(f"Optimizing ROI for high-budget campaign: {c.get('name')}")

                # Update UI Dashboard
                self.ui.update_data(users, insights)
                
            except Exception as e:
                self.ui.log_action(f"[ERROR] Cycle failed: {e}")
            
            time.sleep(30) # Run every 30 seconds for live demo

# ==========================================
# 4. COMMAND CENTER UI (Tkinter)
# ==========================================
class CommandCenterUI:
    def __init__(self, root):
        self.root = root
        self.root.title("HRFlow AI Command Center")
        self.root.geometry("1100x700")
        self.root.configure(bg="#050b14")
        
        self.c_panel = "#0a1324"
        self.c_text = "#e2e8f0"
        self.c_accent = "#0ea5e9"
        
        self.build_ui()

    def build_ui(self):
        # Top Header
        header = tk.Frame(self.root, bg="#020617", height=60)
        header.pack(fill=tk.X)
        tk.Label(header, text="SYSTEM STATUS: AI ANALYTICS ENGINE ONLINE", bg="#020617", fg=self.c_accent, font=("Courier", 12, "bold")).pack(pady=15)

        # Main Layout
        content = tk.Frame(self.root, bg="#050b14")
        content.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Left: Live Monitor
        monitor = tk.Frame(content, bg=self.c_panel, highlightthickness=1, highlightbackground="#1e293b")
        monitor.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0,5))
        
        tk.Label(monitor, text="LIVE ML CLASSIFICATION", bg=self.c_panel, fg="#94a3b8", font=("Arial", 9, "bold")).pack(anchor=tk.W, padx=10, pady=10)
        
        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Treeview", background=self.c_panel, foreground=self.c_text, fieldbackground=self.c_panel, borderwidth=0)
        style.configure("Treeview.Heading", background="#1e293b", foreground="#fff")
        
        cols = ("Name", "Dept", "Status", "Prod Score", "AI Label")
        self.tree = ttk.Treeview(monitor, columns=cols, show="headings")
        for c in cols:
            self.tree.heading(c, text=c)
            self.tree.column(c, width=100, anchor=tk.CENTER)
        self.tree.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Right: Logs
        self.log_box = tk.Text(content, width=40, bg="#020617", fg="#38bdf8", font=("Courier", 9), borderwidth=0)
        self.log_box.pack(side=tk.RIGHT, fill=tk.Y)

    def log_action(self, msg):
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        self.log_box.insert(tk.END, f"[{ts}] {msg}\n")
        self.log_box.see(tk.END)

    def update_data(self, users, insights):
        for i in self.tree.get_children(): self.tree.delete(i)
        for u in users:
            a = u.get("ai_analysis", {"productivity":0, "behavior":"...", "burnout_risk":"Low"})
            self.tree.insert("", tk.END, values=(u.get("name","?"), u.get("departmentId","?"), u.get("status","?"), f"{a['productivity']}%", f"{a['behavior']} (Burnout: {a['burnout_risk']})"))

# ==========================================
# START ENGINE
# ==========================================
if __name__ == "__main__":
    root = tk.Tk()
    ui = CommandCenterUI(root)
    
    fb = FirebaseController()
    agent = AIAgent(fb, ui)
    
    ui.log_action("AI Command Center Initialized.")
    ui.log_action("Starting Automation Engine...")
    
    agent.start()
    root.mainloop()
