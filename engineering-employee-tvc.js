import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { doc, onSnapshot, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { FocusDetector } from "./engineering-focus-detector.js";
import { AIEngine } from "./engineering-ai-engine.js";

class TVCDashboard {
    constructor() {
        this.ai = new AIEngine();
        this.detector = null;
        this.user = null;
        this.stats = {
            codingTime: 0,
            idleTime: 0,
            breakTime: 0,
            warnings: 0,
            baseSalary: 125000 // Demo base
        };
        
        this.charts = {
            consistency: null,
            focus: null
        };

        this.init();
    }

    async init() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                this.user = user;
                document.getElementById('userName').textContent = user.displayName || user.email.split('@')[0];
                this.setupFirebaseListeners();
                this.startTimers();
                this.initCharts();
                this.initDetector();
            } else {
                // Redirect if not logged in (demo mode might bypass)
                const isDemo = localStorage.getItem('hr_logged_in') === 'true';
                if (!isDemo) window.location.href = 'index.html';
            }
        });

        document.getElementById('btnResume').addEventListener('click', () => {
            this.detector.resetWarning();
        });
    }

    initDetector() {
        this.detector = new FocusDetector({
            onFocusChange: (isFocused, count) => {
                this.stats.warnings = count;
                this.updateUI();
            },
            onDistraction: (count) => {
                this.stats.idleTime += 1;
                this.updateUI();
            }
        });
    }

    setupFirebaseListeners() {
        const sessionRef = doc(db, 'hrms_sessions', this.user.uid);
        onSnapshot(sessionRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                // Sync with global system state if needed
            }
        });

        const payrollRef = doc(db, 'payroll', this.user.uid);
        onSnapshot(payrollRef, (snapshot) => {
            if (snapshot.exists()) {
                this.stats.baseSalary = snapshot.data().baseSalary || 125000;
                this.updateUI();
            }
        });
    }

    startTimers() {
        setInterval(() => {
            if (this.detector && this.detector.isFocused) {
                this.stats.codingTime += 1;
            } else {
                this.stats.idleTime += 1;
            }
            this.updateUI();
            this.updateChartsData();
        }, 1000);
    }

    updateUI() {
        // Update Timers
        document.getElementById('activeTimer').textContent = this.formatTime(this.stats.codingTime + this.stats.idleTime);
        document.getElementById('codingTime').textContent = `${Math.floor(this.stats.codingTime / 3600)}h ${Math.floor((this.stats.codingTime % 3600) / 60)}m`;
        document.getElementById('idleTime').textContent = `${Math.floor(this.stats.idleTime / 60)}m`;
        
        // Update Score
        const score = this.ai.calculateScore(this.stats.codingTime, this.stats.idleTime, this.stats.warnings);
        document.getElementById('productivityScore').textContent = score;
        const scoreBar = document.getElementById('scoreBar');
        if (scoreBar) scoreBar.style.width = `${score}%`;
        
        // Update Label
        const label = this.ai.getLabel(score);
        const labelEl = document.getElementById('focusState');
        labelEl.textContent = label;
        labelEl.className = 'focus-state-badge ' + (score > 85 ? 'focus-active' : (score > 70 ? 'focus-warning' : 'focus-danger'));
        
        // Update Warnings
        document.getElementById('warningCount').textContent = `${this.stats.warnings} / 5`;
        
        // Update Salary
        const impact = this.ai.calculateSalaryImpact(this.stats.baseSalary, score);
        document.getElementById('finalSalary').textContent = `₹${impact.final.toLocaleString()}`;
        document.getElementById('baseSalary').textContent = `₹${this.stats.baseSalary.toLocaleString()}`;
        document.getElementById('bonusPercent').textContent = `+${impact.bonus}%`;
        document.getElementById('penaltyPercent').textContent = `-${impact.penalty}%`;

        // Update Insights
        const insights = this.ai.getInsights(score, this.stats.warnings);
        const insightContainer = document.getElementById('aiInsights');
        insightContainer.innerHTML = insights.map(i => `<span class="insight-tag">${i}</span>`).join('');
    }

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [h, m, s].map(v => v < 10 ? "0" + v : v).join(":");
    }

    initCharts() {
        const ctxConsistency = document.getElementById('consistencyChart').getContext('2d');
        this.charts.consistency = new Chart(ctxConsistency, {
            type: 'line',
            data: {
                labels: Array(10).fill(''),
                datasets: [{
                    label: 'Consistency',
                    data: Array(10).fill(0),
                    borderColor: '#38bdf8',
                    tension: 0.4,
                    fill: true,
                    backgroundColor: 'rgba(56, 189, 248, 0.1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { display: false }, x: { display: false } }
            }
        });

        const ctxFocus = document.getElementById('focusTrendChart').getContext('2d');
        this.charts.focus = new Chart(ctxFocus, {
            type: 'bar',
            data: {
                labels: Array(10).fill(''),
                datasets: [{
                    label: 'Focus',
                    data: Array(10).fill(0),
                    backgroundColor: '#10b981',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { display: false }, x: { display: false } }
            }
        });
    }

    updateChartsData() {
        if (!this.charts.consistency || !this.charts.focus) return;
        
        const score = parseInt(document.getElementById('productivityScore').textContent);
        
        // Update Consistency Chart
        this.charts.consistency.data.datasets[0].data.push(score);
        this.charts.consistency.data.datasets[0].data.shift();
        this.charts.consistency.update('none');

        // Update Focus Chart
        const focusVal = this.detector && this.detector.isFocused ? 100 : 20;
        this.charts.focus.data.datasets[0].data.push(focusVal);
        this.charts.focus.data.datasets[0].data.shift();
        this.charts.focus.update('none');
    }
}

// Start Dashboard
new TVCDashboard();
