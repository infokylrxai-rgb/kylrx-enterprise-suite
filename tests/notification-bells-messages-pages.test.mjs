/**
 * admin-dashboard, admin-message, hrms-message, manager-message: runs each page's real module
 * script in jsdom against stubbed Firebase and checks that
 *  - the bell uses the shared, organization-scoped helper with the right audience rule,
 *  - no notifications query is built directly any more,
 *  - every messages / directory query carries the organization filter, and none runs before the
 *    organization is known,
 *  - admin-message has no hard-coded contacts.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const root = (f) => fileURLToPath(new URL(`../${f}`, import.meta.url));
const rsSource = fs.readFileSync(root('notification-read-state.js'), 'utf8');
const readState = new Function(rsSource.replace(/^export /gm, '') +
  `\nreturn { ${[...rsSource.matchAll(/^export (?:const|function) (\w+)/gm)].map(m => m[1]).join(', ')} };`)();

const ME = { uid: 'user-1', orgId: 'org_a', role: 'Super Admin' };
const SCOPED = ['messages', 'users', 'command_centers', 'department_teams'];
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

function boot(page) {
  const html = fs.readFileSync(root(page), 'utf8').replace(/\r\n/g, '\n');
  // the module script that holds the header badges (the page may have several module scripts)
  const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const moduleSource = scripts.find(s => s.includes('watchNotificationBadge'));
  assert.ok(moduleSource, `${page}: no module script uses watchNotificationBadge`);
  const importedNames = [...moduleSource.matchAll(/^\s*import \{([^}]*)\} from/gm)]
    .flatMap(m => m[1].split(',').map(x => x.trim()).filter(Boolean)).map(x => x.split(/\s+as\s+/).pop());
  const body = moduleSource.replace(/^\s*import .*$/gm, '');

  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), { url: `http://localhost/${page}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  let resolveTenant;
  const tenantReady = new Promise((resolve) => { resolveTenant = resolve; });
  const record = { queries: [], badge: [], notificationQueries: 0 };

  const stubs = Object.fromEntries(importedNames.map(n => [n, () => ({})]));
  Object.assign(stubs, {
    db: {}, auth: { currentUser: { uid: ME.uid } },
    tenantReady,
    collection: (_db, col) => { if (col === 'notifications') record.notificationQueries++; return { col }; },
    doc: (_db, col, id) => ({ path: `${col}/${id}` }),
    where: (...w) => ({ where: w }),
    whereMyOrg: () => ({ where: ['orgId', '==', ME.orgId], mine: true }),
    query: (base, ...constraints) => { const q = { col: base && base.col, constraints }; record.queries.push(q); return q; },
    orderBy: () => ({}), limit: () => ({}),
    onAuthStateChanged: (_a, cb) => { cb({ uid: ME.uid }); },
    onSnapshot: () => () => {},
    getDoc: async () => ({ exists: () => false, data: () => ({}) }),
    getDocs: async () => ({ docs: [], forEach() {} }),
    watchNotificationBadge: async (badge, pred) => { record.badge.push({ badge, pred }); },
    isHrmsNotification: readState.isHrmsNotification,
    isManagerNotification: readState.isManagerNotification
  });
  window.__stubs = stubs;
  window.lucide = { createIcons: () => {} };
  window.renderLucideIcons = () => {}; // defined by a classic script in the page head
  window.eval(`(function () { const { ${Object.keys(stubs).join(', ')} } = window.__stubs; ${body} })();`);
  return { window, document: window.document, record, resolveTenant };
}

const scopedQueries = (record) => record.queries.filter(q => SCOPED.includes(q.col));
const hasOrgFilter = (q) => q.constraints.some(c => c && c.mine);

for (const [page, audience] of [
  ['admin-dashboard.html', 'default'],
  ['admin-message.html', 'default'],
  ['hrms-message.html', 'hrms'],
  ['manager-message.html', 'manager']
]) {
  describe(page, () => {
    it('waits for the organization, then scopes every messages / directory query and uses the shared bell', async () => {
      const { record, resolveTenant, document } = boot(page);
      await tick();
      assert.equal(scopedQueries(record).length, 0, 'a messages/directory query ran before the organization was known');
      assert.equal(record.badge.length, 0, 'the bell started before the organization was known');

      resolveTenant();
      await tick();
      const scoped = scopedQueries(record);
      assert.ok(scoped.length > 0, 'no messages/directory query after sign-in');
      const unscoped = scoped.filter(q => !hasOrgFilter(q));
      assert.deepEqual(unscoped.map(q => q.col), [], 'queries without the organization filter');

      assert.equal(record.notificationQueries, 0, 'the page still builds its own notifications query');
      assert.equal(record.badge.length, 1);
      assert.equal(record.badge[0].badge, document.getElementById('headerNotifBadge'));
      const pred = record.badge[0].pred;
      if (audience === 'default') assert.equal(pred, undefined, 'admin bells use the default audience (addressed to me, my role or all)');
      if (audience === 'hrms') { assert.equal(pred({ target: 'hrms' }, ME), true); assert.equal(pred({ target: 'manager' }, ME), false); }
      if (audience === 'manager') { assert.equal(pred({ target: 'manager' }, ME), true); assert.equal(pred({ target: 'employee' }, ME), false); }
    });
  });
}

describe('admin-message.html contacts', () => {
  it('has no hard-coded contacts and nobody pre-selected', async () => {
    const { window, resolveTenant } = boot('admin-message.html');
    resolveTenant();
    await tick();
    assert.equal(window.users.length, 0);
    assert.equal(window.selectedUserIds.size, 0);
    assert.doesNotMatch(window.document.body.innerHTML, /EMP_1789230184645|Marry/);
  });
});
