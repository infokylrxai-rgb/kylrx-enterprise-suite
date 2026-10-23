// Shared Application Configuration
// Defaults to window.location.origin in the browser
const API_BASE = (typeof window !== 'undefined' && window.location && window.location.origin)
    ? window.location.origin
    : (typeof process !== 'undefined' && process.env && process.env.API_BASE)
        ? process.env.API_BASE
        : 'http://localhost:3000';

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

if (typeof window !== 'undefined') {
    window.API_BASE = API_BASE;
    window.escapeHtml = escapeHtml;

    // Chromium WebGPU Windows powerPreference warning fix (crbug.com/369219127)
    if (typeof navigator !== 'undefined' && navigator.gpu && typeof navigator.gpu.requestAdapter === 'function') {
        try {
            const _origRequestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
            navigator.gpu.requestAdapter = function(options) {
                if (options && options.powerPreference) {
                    const cleanOptions = { ...options };
                    delete cleanOptions.powerPreference;
                    return _origRequestAdapter(cleanOptions);
                }
                return _origRequestAdapter(options);
            };
        } catch (_) {}
    }

    // Console interceptor for internal WebGPU diagnostic warnings
    if (typeof console !== 'undefined') {
        const isGpuWarning = (arg) => {
            const s = String(arg || '');
            return s.includes('powerPreference') || s.includes('requestAdapter') || s.includes('369219127');
        };
        ['warn', 'error', 'info', 'log'].forEach(method => {
            if (typeof console[method] === 'function') {
                const original = console[method];
                console[method] = function(...args) {
                    if (args.some(isGpuWarning)) return;
                    original.apply(console, args);
                };
            }
        });
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_BASE, escapeHtml };
}

