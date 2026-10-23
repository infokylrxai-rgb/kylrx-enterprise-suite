/**
 * Services export wrapper for gratuityProfileUIController.js
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxGratuityProfileUIController = factory();
        root.gratuityProfileUIController = root.KylrxGratuityProfileUIController;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../gratuityProfileUIController.js');
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.KylrxGratuityProfileUIController) {
        return window.KylrxGratuityProfileUIController;
    }
    return {};
}));
