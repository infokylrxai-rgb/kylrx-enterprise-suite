/**
 * Services export wrapper for statutoryComplianceParser.js
 */
const fs = require('fs');
const path = require('path');

const rootModulePath = path.resolve(__dirname, '../statutoryComplianceParser.js');
const rootContent = fs.readFileSync(rootModulePath, 'utf8');

const parserModule = { exports: {} };
const fn = new Function('module', 'exports', 'require', rootContent);
fn(parserModule, parserModule.exports, require);

module.exports = parserModule.exports;
