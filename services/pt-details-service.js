/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PROFESSIONAL TAX STATUTORY SERVICE MODULE
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxPtDetailsService = factory();
        root.ptDetailsService = root.KylrxPtDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../ptDetailsService.js');
        } catch (e) {
            // fallback
        }
    }
    if (typeof window !== 'undefined' && window.KylrxPtDetailsService) {
        return window.KylrxPtDetailsService;
    }
    return {};
}));
