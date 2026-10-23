/**
 * Root export wrapper for services/payroll-components-ui-controller.js
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./services/payroll-components-ui-controller'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = require('./services/payroll-components-ui-controller');
    } else {
        if (root.KylrxPayrollComponentsUIController) {
            root.payrollComponentsUIController = root.KylrxPayrollComponentsUIController;
        }
    }
}(typeof self !== 'undefined' ? self : this, function (ctrl) {
    return ctrl;
}));
