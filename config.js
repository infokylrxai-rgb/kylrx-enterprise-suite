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

    // Hide only Chromium's one-off WebGPU warning (crbug.com/369219127); every other console call passes through
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        const GPU_WARNING = /powerPreference option is currently ignored when calling requestAdapter/;
        const originalWarn = console.warn;
        console.warn = function(...args) {
            if (typeof args[0] === 'string' && GPU_WARNING.test(args[0])) return;
            originalWarn.apply(console, args);
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { API_BASE, escapeHtml };
}

