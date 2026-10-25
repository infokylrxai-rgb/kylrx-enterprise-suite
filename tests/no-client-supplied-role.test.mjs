/**
 * Authorization decisions must use the verified identity (req.user), never a role or user id the
 * client sends in a header, query string or body. The only allowed exception is the development-only
 * fallback inside middleware/authMiddleware.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIRS = ['routes', 'services', 'controllers', 'middleware'];
const FORBIDDEN = /x-user-role|x-user-id|req\.query\.(user_|actor)?role|req\.query\.actorRole|req\.body\??\.actor_role/;

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p);
    return /\.(js|mjs)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe('no client-supplied role or actor in server code', () => {
  it('routes, services, controllers and middleware never read role/user id from the request', () => {
    const hits = [];
    for (const d of SERVER_DIRS) {
      for (const f of walk(path.join(root, d))) {
        if (f.endsWith(path.join('middleware', 'authMiddleware.js'))) continue; // dev-only fallback
        readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (FORBIDDEN.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    assert.deepEqual(hits, []);
  });
});
