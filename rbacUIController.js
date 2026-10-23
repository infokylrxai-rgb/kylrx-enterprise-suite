/**
 * Root wrapper for services/rbac-ui-controller.js
 */
const fs = require('fs');
const path = require('path');

const servicePath = path.resolve(__dirname, 'services/rbac-ui-controller.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');

const rbacUIModule = { exports: {} };
const fn = new Function('module', 'exports', 'require', serviceContent);
fn(rbacUIModule, rbacUIModule.exports, require);

module.exports = rbacUIModule.exports;
