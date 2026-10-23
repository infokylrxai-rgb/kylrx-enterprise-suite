/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - LABOUR WELFARE FUND (LWF) STATUTORY SERVICE
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxLwfDetailsService = factory();
        root.lwfDetailsService = root.KylrxLwfDetailsService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../lwfDetailsService.js');
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.KylrxLwfDetailsService) {
        return window.KylrxLwfDetailsService;
    }
    return {};
}));
