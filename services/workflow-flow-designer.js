/**
 * Services export wrapper for workflowFlowDesigner.js
 */
const path = require('path');
const rootModulePath = path.resolve(__dirname, '../workflowFlowDesigner.js');
module.exports = require(rootModulePath);
