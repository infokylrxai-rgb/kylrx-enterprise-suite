import json
import random
import time

class EngineeringProductivityModel:
    def __init__(self):
        self.labels = ["Focused Developer", "High Performer", "Needs Attention"]
        self.weights = {
            "coding_time": 0.6,
            "idle_time": -0.4,
            "focus_warnings": -2.0,
            "complexity_factor": 1.2
        }

    def predict_score(self, features):
        """
        Simulates an ML model prediction for engineering productivity.
        In a production environment, this would use a trained model (e.g. Scikit-learn or TensorFlow).
        """
        score = 70 # Base intercept
        score += features.get('coding_time', 0) * self.weights['coding_time']
        score += features.get('idle_time', 0) * self.weights['idle_time']
        score += features.get('warnings', 0) * self.weights['focus_warnings']
        score *= self.weights['complexity_factor']
        
        return min(100, max(0, round(score, 2)))

    def detect_anomaly(self, history):
        """
        Simple threshold-based anomaly detection.
        """
        if len(history) < 5:
            return False
        
        avg = sum(history) / len(history)
        current = history[-1]
        
        # If current score is 30% lower than avg, it's an anomaly
        if current < (avg * 0.7):
            return True
        return False

    def generate_report(self, employee_id):
        # Simulated data for an engineering shift
        features = {
            "coding_time": random.randint(120, 240), # minutes
            "idle_time": random.randint(10, 30),
            "warnings": random.randint(0, 2)
        }
        
        score = self.predict_score(features)
        
        label = self.labels[0]
        if score > 90: label = self.labels[1]
        elif score < 60: label = self.labels[2]
        
        return {
            "employee_id": employee_id,
            "productivity_score": score,
            "performance_label": label,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "insights": [
                "Development productivity within expected bounds" if score > 70 else "Productivity below benchmark",
                "Workflow consistency high" if features['warnings'] == 0 else "Focus interruptions detected"
            ]
        }

if __name__ == "__main__":
    # Example usage
    model = EngineeringProductivityModel()
    report = model.generate_report("ENG-402")
    print(json.dumps(report, indent=4))
