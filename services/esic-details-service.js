/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - ESIC STATUTORY MASTER SERVICE MODULE
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxEsicDetailsService = factory();
        root.esicDetailsService = root.KylrxEsicDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../esicDetailsService.js');
        } catch (e) {
            // fallback
        }
    }
    if (typeof window !== 'undefined' && window.KylrxEsicDetailsService) {
        return window.KylrxEsicDetailsService;
    }
    return {};
}));
