/**
 * Services export wrapper for companyPolicyService.js
 */
const path = require('path');
const rootModulePath = path.resolve(__dirname, '../companyPolicyService.js');
module.exports = require(rootModulePath);
