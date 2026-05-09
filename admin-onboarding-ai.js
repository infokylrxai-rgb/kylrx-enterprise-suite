import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, onSnapshot, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Onboarding AI Intelligence Engine
 * Handles predictive analytics, sentiment analysis, and bottleneck detection.
 */

class OnboardingAI {
    constructor() {
        this.stats = {
            completionRate: 0,
            avgCompletionTime: 0,
            sentimentScore: 0,
            bottlenecks: []
        };
        this.init();
    }

    async init() {
        console.log("[AI] Intelligence Engine Initializing...");
        this.startRealTimeListeners();
        this.runInference();
    }

    startRealTimeListeners() {
        const usersRef = collection(db, 'users');
        
        // Listen for onboarding updates to refresh analytics
        onSnapshot(usersRef, (snap) => {
            console.log("[AI] Data sync received, recalculating insights...");
            this.calculateMetrics(snap);
        });
    }

    calculateMetrics(snap) {
        let completed = 0;
        let total = snap.size;
        let totalTime = 0;
        let sentimentSum = 0;

        snap.forEach(doc => {
            const data = doc.data();
            if (data.onboardingStatus === 'Active') completed++;
            
            // Simulated sentiment from a field 'onboardingFeedback'
            sentimentSum += data.onboardingSentiment || 4.5; 
        });

        this.stats.completionRate = (completed / total) * 100;
        this.stats.sentimentScore = sentimentSum / total;
        
        this.updateUI();
    }

    async runInference() {
        console.log("[AI] Running predictive inference...");
        // Logic to detect bottlenecks
        // E.g., Find which step has most 'In Progress' users
        const usersRef = collection(db, 'users');
        const pendingSnap = await getDocs(query(usersRef, where('onboardingStatus', '==', 'Pending')));
        
        const stepCounts = {};
        pendingSnap.forEach(doc => {
            const currentStep = doc.data().currentOnboardingStep || 'Personal Info';
            stepCounts[currentStep] = (stepCounts[currentStep] || 0) + 1;
        });

        // Find max bottleneck
        const topBottleneck = Object.entries(stepCounts).sort((a,b) => b[1] - a[1])[0];
        if (topBottleneck) {
            this.stats.bottlenecks = [`${topBottleneck[0]} is currently the primary bottleneck with ${topBottleneck[1]} users waiting.`];
        }
    }

    updateUI() {
        // Update stats on dashboard
        const rateEl = document.querySelector('.ai-glass-card h2');
        if (rateEl) rateEl.textContent = `${this.stats.completionRate.toFixed(1)}%`;
        
        const sentimentEl = document.querySelectorAll('.ai-glass-card h2')[2];
        if (sentimentEl) sentimentEl.textContent = `${this.stats.sentimentScore.toFixed(1)}/5`;
    }

    async handleChat(query) {
        // Simulated AI Chat logic
        const q = query.toLowerCase();
        if (q.includes('bottleneck')) {
            return `I've detected that the 'Finance Verification' stage is causing a 48-hour delay in the Engineering department.`;
        } else if (q.includes('completion')) {
            return `Based on current velocity, I predict 95% of the current batch will finish within 72 hours.`;
        } else if (q.includes('sales')) {
            return `Sales is lagging due to 'Government ID' verification failures. I recommend checking the upload quality requirements.`;
        }
        return `I'm analyzing your request. Is there a specific department or stage you'd like me to audit?`;
    }
}

export const onboardingAI = new OnboardingAI();
