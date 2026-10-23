/**
 * Services export wrapper for workflowRulesParser.js
 */
const path = require('path');
const rootModulePath = path.resolve(__dirname, '../workflowRulesParser.js');
module.exports = require(rootModulePath);
