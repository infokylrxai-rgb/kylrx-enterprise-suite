/**
 * Services export wrapper for rbacService.js
 */
const fs = require('fs');
const path = require('path');

const rootModulePath = path.resolve(__dirname, '../rbacService.js');
const rootContent = fs.readFileSync(rootModulePath, 'utf8');

const rbacModule = { exports: {} };
const fn = new Function('module', 'exports', 'require', rootContent);
fn(rbacModule, rbacModule.exports, require);

module.exports = rbacModule.exports;
