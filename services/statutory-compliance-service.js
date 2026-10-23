/**
 * Services export wrapper for statutoryComplianceService.js
 */
const fs = require('fs');
const path = require('path');

const rootModulePath = path.resolve(__dirname, '../statutoryComplianceService.js');
const rootContent = fs.readFileSync(rootModulePath, 'utf8');

const serviceModule = { exports: {} };
const fn = new Function('module', 'exports', 'require', rootContent);
fn(serviceModule, serviceModule.exports, require);

module.exports = serviceModule.exports;
