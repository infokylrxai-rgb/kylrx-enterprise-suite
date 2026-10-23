/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - GRATUITY STATUTORY SERVICE & SETTLEMENT ENGINE
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxGratuityDetailsService = factory();
        root.gratuityDetailsService = root.KylrxGratuityDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../gratuityDetailsService.js');
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.KylrxGratuityDetailsService) {
        return window.KylrxGratuityDetailsService;
    }
    return {};
}));
