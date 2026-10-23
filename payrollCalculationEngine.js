/**
 * Root export wrapper for services/payroll/payrollCalculationEngine.js
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./services/payroll/payrollCalculationEngine'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = require('./services/payroll/payrollCalculationEngine');
    } else {
        // In browser, services/payroll/payrollCalculationEngine.js sets root.KylrxPayrollCalculationEngine
        if (root.KylrxPayrollCalculationEngine) {
            root.payrollCalculationEngine = root.KylrxPayrollCalculationEngine;
        }
    }
}(typeof self !== 'undefined' ? self : this, function (engine) {
    return engine;
}));
