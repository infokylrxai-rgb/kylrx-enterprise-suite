/**
 * Services export wrapper for npsProfileUIController.js
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxNpsProfileUIController = factory();
        root.npsProfileUIController = root.KylrxNpsProfileUIController;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../npsProfileUIController.js');
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.KylrxNpsProfileUIController) {
        return window.KylrxNpsProfileUIController;
    }
    return {};
}));
