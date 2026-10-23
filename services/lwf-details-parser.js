/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - LABOUR WELFARE FUND (LWF) STATUTORY PARSER
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxLwfDetailsParser = factory();
        root.lwfDetailsParser = root.KylrxLwfDetailsParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../lwfDetailsParser.js');
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.KylrxLwfDetailsParser) {
        return window.KylrxLwfDetailsParser;
    }
    return {};
}));
