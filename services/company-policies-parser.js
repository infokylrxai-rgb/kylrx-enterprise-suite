/**
 * Services export wrapper for companyPoliciesParser.js
 */
const path = require('path');
const rootModulePath = path.resolve(__dirname, '../companyPoliciesParser.js');
module.exports = require(rootModulePath);
