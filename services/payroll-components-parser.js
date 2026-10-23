/**
 * Services export wrapper for payrollComponentsParser.js
 */
const path = require('path');
const rootModulePath = path.resolve(__dirname, '../payrollComponentsParser.js');
module.exports = require(rootModulePath);
