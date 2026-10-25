// firebase-config.js imports Firebase from https URLs and cannot be loaded in Node, so this checks the
// source: a permission-denied getDocs must be reported with the collection name and flagged on the result.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../firebase-config.js', import.meta.url), 'utf8');
const getDocsBody = src.slice(src.indexOf('const getDocs = async'), src.indexOf('const getDoc = async'));

describe('firebase-config getDocs permission handling', () => {
  it('logs permission-denied with the target path, bypassing the filtered console.error', () => {
    assert.match(src, /function reportPermissionDenied[\s\S]*?_origConsoleError\.call\(console, `\[Firestore\] permission-denied reading "\$\{name\}"/);
    assert.match(getDocsBody, /if \(isPermission\) reportPermissionDenied\(q, err\)/);
  });
  it('returns an explicit error state instead of a plain empty result', () => {
    assert.match(getDocsBody, /permissionDenied: isPermission/);
    assert.match(getDocsBody, /error: isPermission \? err : undefined/);
  });
  it('notifies the page through a window event', () => {
    assert.match(src, /new CustomEvent\('firestore-permission-denied'/);
  });
});
