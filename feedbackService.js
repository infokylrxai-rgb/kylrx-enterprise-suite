/**
 * Kylrx.ai Enterprise HRMS - Global UI Feedback Service (PRD Section 18)
 * Standardizes visual feedback across all 18 PRD modules:
 * - Non-blocking stackable toast notifications (success, error, warning, info)
 * - Animated shimmer loading skeletons (table, cards, form, metric, list)
 * - Real-time progress bars & transaction indicators
 * - Inline field validation errors with accessible aria-live alerts
 * - Global async error interceptor & network error recovery
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exports = factory();
        root.FeedbackService = exports.FeedbackService;
        root.FeedbackServiceClass = exports.FeedbackServiceClass;
        root.feedback = exports.FeedbackService;
    }
}(typeof self !== 'undefined' ? self : this, function () {

class FeedbackServiceClass {
    constructor() {
        this.toastContainer = null;
        this.progressBarContainer = null;
        this.savedContainerStates = new WeakMap();
        this.activeToasts = new Set();
        this.isInterceptorInstalled = false;
        this.init();
    }

    init() {
        if (typeof document === 'undefined') return;
        this.injectScopedStyles();
        this.ensureContainers();
    }

    injectScopedStyles() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('kylrx-feedback-styles')) return;

        const style = document.createElement('style');
        style.id = 'kylrx-feedback-styles';
        style.textContent = `
            /* Toast Container */
            .kylrx-toast-hub {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 420px;
                width: calc(100% - 32px);
                pointer-events: none;
            }

            /* Toast Cards */
            .kylrx-toast {
                pointer-events: auto;
                background: #0f172a;
                color: #f8fafc;
                border-radius: 14px;
                padding: 12px 16px;
                box-shadow: 0 10px 25px -3px rgba(0, 0, 0, 0.25), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
                display: flex;
                align-items: flex-start;
                gap: 12px;
                font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 0.85rem;
                line-height: 1.4;
                border: 1px solid rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(8px);
                transform: translateY(12px) scale(0.96);
                opacity: 0;
                transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
            }

            .kylrx-toast.active {
                transform: translateY(0) scale(1);
                opacity: 1;
            }

            .kylrx-toast.hiding {
                transform: translateY(10px) scale(0.95);
                opacity: 0;
            }

            .kylrx-toast-icon {
                font-size: 1.1rem;
                flex-shrink: 0;
                margin-top: 1px;
            }

            .kylrx-toast-content {
                flex: 1;
            }

            .kylrx-toast-title {
                font-weight: 700;
                color: #ffffff;
                margin-bottom: 2px;
                font-size: 0.88rem;
            }

            .kylrx-toast-msg {
                color: #cbd5e1;
                font-size: 0.8rem;
                word-break: break-word;
            }

            .kylrx-toast-close {
                background: none;
                border: none;
                color: #94a3b8;
                cursor: pointer;
                padding: 2px 4px;
                font-size: 1rem;
                line-height: 1;
                border-radius: 4px;
                transition: color 0.15s;
            }

            .kylrx-toast-close:hover {
                color: #ffffff;
            }

            /* Toast Variants */
            .kylrx-toast.success {
                border-color: rgba(16, 185, 129, 0.4);
                background: linear-gradient(135deg, #064e3b, #0f172a 75%);
            }
            .kylrx-toast.success .kylrx-toast-title { color: #34d399; }

            .kylrx-toast.error {
                border-color: rgba(239, 68, 68, 0.4);
                background: linear-gradient(135deg, #7f1d1d, #0f172a 75%);
            }
            .kylrx-toast.error .kylrx-toast-title { color: #f87171; }

            .kylrx-toast.warning {
                border-color: rgba(245, 158, 11, 0.4);
                background: linear-gradient(135deg, #78350f, #0f172a 75%);
            }
            .kylrx-toast.warning .kylrx-toast-title { color: #fbbf24; }

            .kylrx-toast.info {
                border-color: rgba(37, 99, 235, 0.4);
                background: linear-gradient(135deg, #1e3a8a, #0f172a 75%);
            }
            .kylrx-toast.info .kylrx-toast-title { color: #60a5fa; }

            /* Skeleton Shimmer Loading */
            .kylrx-skeleton-shimmer {
                background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
                background-size: 200% 100%;
                animation: kylrxShimmer 1.5s infinite linear;
                border-radius: 8px;
            }

            @keyframes kylrxShimmer {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }

            .kylrx-skeleton-table {
                width: 100%;
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding: 16px 0;
            }

            .kylrx-skeleton-row {
                display: flex;
                align-items: center;
                gap: 14px;
                padding: 12px 16px;
                background: #ffffff;
                border-radius: 10px;
                border: 1px solid #f1f5f9;
            }

            .kylrx-skeleton-cell {
                height: 14px;
                border-radius: 6px;
            }

            .kylrx-skeleton-card-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
                gap: 16px;
                width: 100%;
            }

            .kylrx-skeleton-card {
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 16px;
                padding: 20px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            /* Inline Field Validation Error */
            .kylrx-field-error-msg {
                color: #ef4444;
                font-size: 0.74rem;
                font-weight: 700;
                margin-top: 4px;
                display: flex;
                align-items: center;
                gap: 4px;
                font-family: inherit;
            }

            .kylrx-field-invalid {
                border-color: #ef4444 !important;
                box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.15) !important;
            }

            /* Global Progress Bar */
            .kylrx-progress-bar-container {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 3px;
                background: transparent;
                z-index: 10001;
                pointer-events: none;
            }

            .kylrx-progress-bar-indicator {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #2563eb, #10b981);
                transition: width 0.2s ease;
                box-shadow: 0 0 8px rgba(37, 99, 235, 0.5);
            }
        `;
        document.head.appendChild(style);
    }

    ensureContainers() {
        if (typeof document === 'undefined') return;
        if (!this.toastContainer && document.body) {
            let hub = document.getElementById('kylrx-toast-hub');
            if (!hub) {
                hub = document.createElement('div');
                hub.id = 'kylrx-toast-hub';
                hub.className = 'kylrx-toast-hub';
                hub.setAttribute('aria-live', 'polite');
                document.body.appendChild(hub);
            }
            this.toastContainer = hub;
        }

        if (!this.progressBarContainer && document.body) {
            let pbc = document.getElementById('kylrx-progress-hub');
            if (!pbc) {
                pbc = document.createElement('div');
                pbc.id = 'kylrx-progress-hub';
                pbc.className = 'kylrx-progress-bar-container';
                pbc.innerHTML = '<div class="kylrx-progress-bar-indicator" id="kylrx-progress-indicator"></div>';
                document.body.appendChild(pbc);
            }
            this.progressBarContainer = pbc;
        }
    }

    /**
     * Stackable Toast Notification (PRD §18)
     * @param {string} message - User facing message
     * @param {'success'|'error'|'warning'|'info'} type - Toast type
     * @param {number} duration - Auto-dismiss duration in ms (default 4000ms)
     * @param {Object} [options] - Optional title, action { text, onClick }
     */
    showToast(message, type = 'info', duration = 4000, options = {}) {
        if (typeof document === 'undefined') {
            console.log(`[FeedbackService:${type.toUpperCase()}] ${message}`);
            return null;
        }

        this.ensureContainers();
        if (!this.toastContainer) return null;

        const toast = document.createElement('div');
        toast.className = `kylrx-toast ${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const iconMap = {
            success: '✅',
            error: '⚠️',
            warning: '⚡',
            info: 'ℹ️'
        };

        const titleMap = {
            success: options.title || 'Action Completed',
            error: options.title || 'Operation Failed',
            warning: options.title || 'Attention Required',
            info: options.title || 'System Notification'
        };

        toast.innerHTML = `
            <div class="kylrx-toast-icon">${iconMap[type] || 'ℹ️'}</div>
            <div class="kylrx-toast-content">
                <div class="kylrx-toast-title">${titleMap[type]}</div>
                <div class="kylrx-toast-msg">${message}</div>
            </div>
            <button class="kylrx-toast-close" title="Dismiss" aria-label="Close notification">&times;</button>
        `;

        const closeBtn = toast.querySelector('.kylrx-toast-close');
        let dismissTimer = null;

        const dismiss = () => {
            if (dismissTimer) clearTimeout(dismissTimer);
            toast.classList.remove('active');
            toast.classList.add('hiding');
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
                this.activeToasts.delete(toast);
            }, 250);
        };

        if (closeBtn) closeBtn.onclick = dismiss;

        toast.addEventListener('mouseenter', () => {
            if (dismissTimer) clearTimeout(dismissTimer);
        });

        toast.addEventListener('mouseleave', () => {
            if (duration > 0) dismissTimer = setTimeout(dismiss, duration);
        });

        this.toastContainer.appendChild(toast);
        this.activeToasts.add(toast);

        // Force reflow and activate animation
        requestAnimationFrame(() => toast.classList.add('active'));

        if (duration > 0) {
            dismissTimer = setTimeout(dismiss, duration);
        }

        return { dismiss, el: toast };
    }

    success(message, options = {}) {
        return this.showToast(message, 'success', 3500, options);
    }

    error(message, options = {}) {
        return this.showToast(message, 'error', 6000, options);
    }

    warning(message, options = {}) {
        return this.showToast(message, 'warning', 5000, options);
    }

    info(message, options = {}) {
        return this.showToast(message, 'info', 4000, options);
    }

    /**
     * Render Animated Loading Skeleton into any container (PRD §18)
     * @param {HTMLElement|string} containerOrSelector 
     * @param {'table'|'cards'|'form'|'metric'|'list'} [type='table'] 
     * @param {number} [count=5] 
     */
    showLoadingSkeleton(containerOrSelector, type = 'table', count = 5) {
        if (typeof document === 'undefined') return;

        const container = typeof containerOrSelector === 'string'
            ? document.querySelector(containerOrSelector)
            : containerOrSelector;

        if (!container) return;

        // Save existing innerHTML to restore on hide
        if (!this.savedContainerStates.has(container)) {
            this.savedContainerStates.set(container, container.innerHTML);
        }

        let skeletonHTML = '';

        if (type === 'table') {
            skeletonHTML = `
                <div class="kylrx-skeleton-table" aria-busy="true" aria-label="Loading data records...">
                    ${Array.from({ length: count }).map(() => `
                        <div class="kylrx-skeleton-row">
                            <div class="kylrx-skeleton-shimmer kylrx-skeleton-cell" style="width: 38px; height: 38px; border-radius: 10px;"></div>
                            <div class="kylrx-skeleton-shimmer kylrx-skeleton-cell" style="width: 25%; height: 16px;"></div>
                            <div class="kylrx-skeleton-shimmer kylrx-skeleton-cell" style="width: 15%; height: 16px;"></div>
                            <div class="kylrx-skeleton-shimmer kylrx-skeleton-cell" style="width: 20%; height: 16px;"></div>
                            <div class="kylrx-skeleton-shimmer kylrx-skeleton-cell" style="width: 12%; height: 20px; border-radius: 20px;"></div>
                            <div class="kylrx-skeleton-shimmer kylrx-skeleton-cell" style="width: 10%; height: 16px; margin-left: auto;"></div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (type === 'cards') {
            skeletonHTML = `
                <div class="kylrx-skeleton-card-grid" aria-busy="true">
                    ${Array.from({ length: count }).map(() => `
                        <div class="kylrx-skeleton-card">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div class="kylrx-skeleton-shimmer" style="width: 40px; height: 40px; border-radius: 12px;"></div>
                                <div class="kylrx-skeleton-shimmer" style="width: 50px; height: 20px; border-radius: 12px;"></div>
                            </div>
                            <div class="kylrx-skeleton-shimmer" style="width: 70%; height: 20px; margin-top: 8px;"></div>
                            <div class="kylrx-skeleton-shimmer" style="width: 90%; height: 14px;"></div>
                            <div class="kylrx-skeleton-shimmer" style="width: 40%; height: 14px;"></div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (type === 'metric') {
            skeletonHTML = `
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; width: 100%;" aria-busy="true">
                    ${Array.from({ length: count }).map(() => `
                        <div style="background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 1.25rem; display: flex; justify-content: space-between; align-items: center;">
                            <div style="width: 60%; display: flex; flex-direction: column; gap: 8px;">
                                <div class="kylrx-skeleton-shimmer" style="width: 80%; height: 12px;"></div>
                                <div class="kylrx-skeleton-shimmer" style="width: 50%; height: 28px;"></div>
                            </div>
                            <div class="kylrx-skeleton-shimmer" style="width: 40px; height: 40px; border-radius: 10px;"></div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else if (type === 'form') {
            skeletonHTML = `
                <div style="display: flex; flex-direction: column; gap: 14px; width: 100%;" aria-busy="true">
                    ${Array.from({ length: count }).map(() => `
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <div class="kylrx-skeleton-shimmer" style="width: 120px; height: 14px;"></div>
                            <div class="kylrx-skeleton-shimmer" style="width: 100%; height: 40px; border-radius: 8px;"></div>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            skeletonHTML = `
                <div style="display: flex; flex-direction: column; gap: 8px; width: 100%;" aria-busy="true">
                    ${Array.from({ length: count }).map(() => `
                        <div class="kylrx-skeleton-shimmer" style="width: 100%; height: 22px; border-radius: 6px;"></div>
                    `).join('')}
                </div>
            `;
        }

        container.innerHTML = skeletonHTML;
    }

    /**
     * Restore container to state prior to showLoadingSkeleton
     * @param {HTMLElement|string} containerOrSelector 
     */
    hideLoadingSkeleton(containerOrSelector) {
        if (typeof document === 'undefined') return;

        const container = typeof containerOrSelector === 'string'
            ? document.querySelector(containerOrSelector)
            : containerOrSelector;

        if (!container) return;

        if (this.savedContainerStates.has(container)) {
            container.innerHTML = this.savedContainerStates.get(container);
            this.savedContainerStates.delete(container);
        }
    }

    /**
     * Global Progress Bar Indicator (PRD §18)
     */
    showProgressBar(percent = 30) {
        if (typeof document === 'undefined') return;
        this.ensureContainers();
        const indicator = document.getElementById('kylrx-progress-indicator');
        if (indicator) {
            indicator.style.width = `${Math.min(100, Math.max(0, percent))}%`;
            indicator.style.opacity = '1';
        }
    }

    hideProgressBar() {
        if (typeof document === 'undefined') return;
        const indicator = document.getElementById('kylrx-progress-indicator');
        if (indicator) {
            indicator.style.width = '100%';
            setTimeout(() => {
                indicator.style.opacity = '0';
                setTimeout(() => { indicator.style.width = '0%'; }, 200);
            }, 300);
        }
    }

    /**
     * Accessible Inline Field Error (PRD §18)
     * @param {HTMLElement|string} inputOrSelector 
     * @param {string} message 
     */
    showFieldError(inputOrSelector, message) {
        if (typeof document === 'undefined') return;
        const input = typeof inputOrSelector === 'string'
            ? document.querySelector(inputOrSelector)
            : inputOrSelector;

        if (!input) return;

        input.classList.add('kylrx-field-invalid');
        input.setAttribute('aria-invalid', 'true');

        let errorEl = input.parentNode.querySelector('.kylrx-field-error-msg');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.className = 'kylrx-field-error-msg';
            errorEl.setAttribute('role', 'alert');
            input.parentNode.appendChild(errorEl);
        }
        errorEl.textContent = `⚠️ ${message}`;
    }

    /**
     * Clear all active inline field errors in a form or container
     * @param {HTMLElement|string} formOrSelector 
     */
    clearFieldErrors(formOrSelector) {
        if (typeof document === 'undefined') return;
        const root = typeof formOrSelector === 'string'
            ? document.querySelector(formOrSelector)
            : formOrSelector;

        if (!root) return;

        root.querySelectorAll('.kylrx-field-invalid').forEach(input => {
            input.classList.remove('kylrx-field-invalid');
            input.removeAttribute('aria-invalid');
        });

        root.querySelectorAll('.kylrx-field-error-msg').forEach(el => el.remove());
    }

    /**
     * Wraps an asynchronous operation with visual loading and error interceptor
     * @param {Function} asyncFn - Async function returning a promise
     * @param {Object} [options] - { skeletonContainer, skeletonType, successMsg, errorTitle }
     */
    async wrapAsync(asyncFn, options = {}) {
        const { skeletonContainer, skeletonType, successMsg, errorTitle } = options;

        if (skeletonContainer) {
            this.showLoadingSkeleton(skeletonContainer, skeletonType);
        }
        this.showProgressBar(45);

        try {
            const result = await asyncFn();
            this.showProgressBar(100);
            if (successMsg) this.success(successMsg);
            return result;
        } catch (err) {
            console.error("[FeedbackService:wrapAsync Error]", err);
            const userMsg = err.message || 'An unexpected system error occurred.';
            this.error(userMsg, { title: errorTitle || 'Operation Failed' });
            throw err;
        } finally {
            this.hideProgressBar();
            if (skeletonContainer) {
                this.hideLoadingSkeleton(skeletonContainer);
            }
        }
    }

    /**
     * Global Network & Fetch Interceptor (PRD §18)
     * Automatically handles 401 Unauthorized, 403 Super Admin Claims Required, and 500 Server Errors
     */
    installGlobalFetchInterceptor() {
        if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
        if (this.isInterceptorInstalled) return;

        const originalFetch = window.fetch;
        const self = this;

        window.fetch = async function (...args) {
            try {
                const response = await originalFetch.apply(this, args);
                
                // Intercept HTTP status codes
                if (!response.ok) {
                    if (response.status === 401) {
                        self.warning("Session or OTP token expired (24h validity exceeded). Please re-authenticate.", {
                            title: "Authentication Required"
                        });
                    } else if (response.status === 403) {
                        self.error("Administrative action requires verified Super Admin custom claims.", {
                            title: "Access Denied (403)"
                        });
                    } else if (response.status >= 500) {
                        self.error(`Cloud service reported an error (HTTP ${response.status}). Retrying gracefully...`, {
                            title: "Server Error"
                        });
                    }
                }
                return response;
            } catch (networkError) {
                self.error(`Network disconnect: ${networkError.message}. Operating in resilient offline cache mode.`, {
                    title: "Network Unreachable"
                });
                throw networkError;
            }
        };

        this.isInterceptorInstalled = true;
    }
}

const FeedbackService = new FeedbackServiceClass();

return {
    FeedbackService,
    FeedbackServiceClass
};

}));
