/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - ESIC STATUTORY MASTER PARSER & VALIDATOR
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxEsicDetailsParser = factory();
        root.esicDetailsParser = root.KylrxEsicDetailsParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../esicDetailsParser.js');
        } catch (e) {
            // fallback
        }
    }
    if (typeof window !== 'undefined' && window.KylrxEsicDetailsParser) {
        return window.KylrxEsicDetailsParser;
    }
    return {};
}));
