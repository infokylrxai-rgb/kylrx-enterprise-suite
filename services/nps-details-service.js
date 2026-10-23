/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - NATIONAL PENSION SYSTEM (NPS) STATUTORY SERVICE
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxNpsDetailsService = factory();
        root.npsDetailsService = root.KylrxNpsDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../npsDetailsService.js');
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.KylrxNpsDetailsService) {
        return window.KylrxNpsDetailsService;
    }
    return {};
}));
