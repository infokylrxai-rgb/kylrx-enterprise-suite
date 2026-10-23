/**
 * Services export wrapper for payrollComponentService.js
 */
const path = require('path');
const rootModulePath = path.resolve(__dirname, '../payrollComponentService.js');
module.exports = require(rootModulePath);
