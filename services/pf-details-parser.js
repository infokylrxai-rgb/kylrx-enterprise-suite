/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - EPFO / PF & UAN STATUTORY MASTER PARSER & VALIDATOR
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxPfDetailsParser = factory();
        root.pfDetailsParser = root.KylrxPfDetailsParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../pfDetailsParser.js');
        } catch (e) {
            // fallback
        }
    }
    if (typeof window !== 'undefined' && window.KylrxPfDetailsParser) {
        return window.KylrxPfDetailsParser;
    }
    return {};
}));
