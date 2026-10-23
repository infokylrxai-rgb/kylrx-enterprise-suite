/**
 * Services export wrapper for lwfProfileUIController.js
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxLwfProfileUIController = factory();
        root.lwfProfileUIController = root.KylrxLwfProfileUIController;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    if (typeof require === 'function') {
        try {
            return require('../lwfProfileUIController.js');
        } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.KylrxLwfProfileUIController) {
        return window.KylrxLwfProfileUIController;
    }
    return {};
}));
