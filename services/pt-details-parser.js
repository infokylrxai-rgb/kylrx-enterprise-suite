/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PROFESSIONAL TAX STATUTORY MASTER PARSER
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxPtDetailsParser = factory();
        root.ptDetailsParser = root.KylrxPtDetailsParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../ptDetailsParser.js');
        } catch (e) {
            // fallback
        }
    }
    if (typeof window !== 'undefined' && window.KylrxPtDetailsParser) {
        return window.KylrxPtDetailsParser;
    }
    return {};
}));
