/**
 * A brand-new organisation opened the dashboard and saw six departments it had never
 * created, a productivity chart padded out with random scores, and a reporting-line
 * dropdown offering two people who do not exist. Each was a fallback that filled an
 * empty screen with something plausible rather than showing it as empty.
 *
 * That matters more than it looks: a department you can assign somebody to, but which
 * is not in the database, and a manager you can pick, but who has no record, both
 * produce data referring to nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'admin-app.js'), 'utf8');
const dashboard = fs.readFileSync(path.join(ROOT, 'admin-dashboard.html'), 'utf8');

describe('the dashboard shows real data or nothing', () => {
  it('invents no departments when the organisation has none', () => {
    assert.ok(!/departmentId: 'engineering'/.test(app), 'the six-department fallback must be gone');
    assert.ok(!/departmentId: 'cybersecurity'/.test(app));
    assert.ok(!/departmentId: 'human-resources'/.test(app));
  });

  it('invents no managers for the reporting-line dropdown', () => {
    assert.ok(!/name: 'John Doe'/.test(app), 'the invented manager must be gone');
    assert.ok(/No managers yet/.test(app), 'an empty list should say so');
  });

  it('does not pad a chart with random numbers', () => {
    assert.ok(!/data\.push\(80 \+ Math\.floor\(Math\.random/.test(app),
      'a short history must render short, not be filled out with invented scores');
  });

  it('claims no leading department when there are no departments', () => {
    assert.ok(!/state\.departments\[0\]\?\.name \|\| 'Engineering'/.test(app));
  });

  it('builds no chart from invented labels and scores', () => {
    assert.ok(!/labels\.push\('Engineering', 'Marketing'\); data\.push\(92, 85\)/.test(app));
  });
});

describe('no password is displayed in the employee list', () => {
  /**
   * The list had a click-to-reveal password cell. Plaintext passwords are no longer
   * stored so it could only show "---", but it would still have revealed any legacy
   * value to everyone who can see the list - which now includes the read-only Auditor.
   */
  it('the column is gone from the table', () => {
    assert.ok(!/<th style="padding: 12px 16px;">Password<\/th>/.test(dashboard));
  });

  it('no cell renders a stored password', () => {
    assert.ok(!/class="password-cell"/.test(app));
    assert.ok(!/emp\.password \|\| emp\.tempPassword/.test(app));
  });
});

describe('passwords generated in the browser are not predictable', () => {
  it('uses crypto rather than Math.random', () => {
    assert.ok(!/const randomPart = Math\.random\(\)/.test(app),
      'Math.random is predictable from earlier samples');
    assert.match(app, /crypto\.getRandomValues/);
  });
});
