/**
 * Services export wrapper for workflowExecutionEngine.js
 */
const path = require('path');
const rootModulePath = path.resolve(__dirname, '../workflowExecutionEngine.js');
module.exports = require(rootModulePath);
