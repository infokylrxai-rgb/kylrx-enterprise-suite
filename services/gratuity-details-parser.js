/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - GRATUITY STATUTORY MASTER PARSER
 * (Services Directory Proxy / Mirror)
 * ============================================================================
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxGratuityDetailsParser = factory();
        root.gratuityDetailsParser = root.KylrxGratuityDetailsParser;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../gratuityDetailsParser.js');
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.KylrxGratuityDetailsParser) {
        return window.KylrxGratuityDetailsParser;
    }
    return {};
}));
