/**
 * Engineering Focus Detector
 * Tracks tab visibility and manages the tiered warning system.
 */

export class FocusDetector {
    constructor(callbacks) {
        this.warningCount = 0;
        this.isFocused = true;
        this.callbacks = callbacks;
        this.restrictedTime = 0;
        this.checkInterval = null;
        
        this.init();
    }

    init() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.handleFocusLoss();
            } else {
                this.handleFocusGain();
            }
        });

        // Initialize clock
        setInterval(() => {
            const now = new Date();
            const clock = document.getElementById('systemClock');
            if (clock) clock.textContent = now.toLocaleTimeString();
        }, 1000);
    }

    handleFocusLoss() {
        this.isFocused = false;
        this.warningCount++;
        this.callbacks.onFocusChange(false, this.warningCount);
        
        // Start tracking time away
        this.restrictedTime = 0;
        this.checkInterval = setInterval(() => {
            this.restrictedTime++;
            if (this.restrictedTime > 5) { // 5 seconds threshold for "distraction"
                this.callbacks.onDistraction(this.warningCount);
            }
        }, 1000);
    }

    handleFocusGain() {
        this.isFocused = true;
        clearInterval(this.checkInterval);
        this.callbacks.onFocusChange(true, this.warningCount);
        
        if (this.warningCount > 0) {
            this.triggerWarningUI();
        }
    }

    triggerWarningUI() {
        const overlay = document.getElementById('warningOverlay');
        const msg = document.getElementById('warningMsg');
        
        if (!overlay || !msg) return;

        overlay.classList.add('active');

        if (this.warningCount === 1) {
            msg.textContent = "Soft Warning: We noticed you left the development environment. Please stay focused on your tasks.";
        } else if (this.warningCount === 2) {
            msg.textContent = "Strong Warning: Continued distractions will result in a productivity penalty. Access to restricted sites is being logged.";
        } else if (this.warningCount === 3) {
            msg.textContent = "Final Warning: Fullscreen monitoring active. Further distractions will immediately impact your final salary calculation.";
        } else {
            msg.textContent = "Productivity Penalty Active: Your focus score has dropped below the threshold. Performance penalties are now being applied to your payroll.";
        }
    }

    resetWarning() {
        const overlay = document.getElementById('warningOverlay');
        if (overlay) overlay.classList.remove('active');
    }
}
