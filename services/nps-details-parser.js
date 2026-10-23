/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - NATIONAL PENSION SYSTEM (NPS) STATUTORY PARSER
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxNpsDetailsParser = factory();
        root.npsDetailsParser = root.KylrxNpsDetailsParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../npsDetailsParser.js');
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.KylrxNpsDetailsParser) {
        return window.KylrxNpsDetailsParser;
    }
    return {};
}));
