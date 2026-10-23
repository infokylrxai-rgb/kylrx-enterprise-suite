/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - EPFO / PF & UAN STATUTORY MASTER SERVICE MODULE
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxPfDetailsService = factory();
        root.pfDetailsService = root.KylrxPfDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../pfDetailsService.js');
        } catch (e) {
            // fallback
        }
    }
    if (typeof window !== 'undefined' && window.KylrxPfDetailsService) {
        return window.KylrxPfDetailsService;
    }
    return {};
}));
