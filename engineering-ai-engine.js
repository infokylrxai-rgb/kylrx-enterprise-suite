/**
 * Engineering AI Engine
 * Calculates productivity scores and provides real-time ML insights.
 */

export class AIEngine {
    constructor() {
        this.baseScore = 85;
        this.currentScore = 85;
        this.history = [];
    }

    calculateScore(codingTimeSec, idleTimeSec, warnings) {
        // Simple logic to simulate AI processing
        let score = this.baseScore;
        
        // Bonus for coding time (1 point per 10 mins)
        score += (codingTimeSec / 600);
        
        // Penalty for idle time (1 point per 5 mins)
        score -= (idleTimeSec / 300);
        
        // Heavy penalty for focus loss
        score -= (warnings * 5);
        
        // Clamp score between 0 and 100
        this.currentScore = Math.max(0, Math.min(100, Math.round(score)));
        this.history.push(this.currentScore);
        if (this.history.length > 20) this.history.shift();

        return this.currentScore;
    }

    getLabel(score) {
        if (score >= 90) return "HIGH PERFORMER";
        if (score >= 75) return "FOCUSED DEVELOPER";
        return "NEEDS ATTENTION";
    }

    getInsights(score, warnings) {
        const insights = [];
        
        if (score > 80) insights.push("Development productivity improving");
        else insights.push("Focus optimizations recommended");

        if (warnings > 0) insights.push("Focus interruptions detected");
        else insights.push("Steady workflow maintainted");

        if (score < 60) insights.push("Workflow anomaly detected");

        return insights;
    }

    calculateSalaryImpact(base, score) {
        let bonus = 0;
        let penalty = 0;

        if (score > 90) bonus = 10;
        else if (score > 80) bonus = 5;

        if (score < 70) penalty = 15;
        else if (score < 80) penalty = 5;

        const final = base + (base * (bonus / 100)) - (base * (penalty / 100));

        return {
            final: Math.round(final),
            bonus,
            penalty
        };
    }
}
