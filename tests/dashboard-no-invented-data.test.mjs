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

/**
 * The Command Centre was worse than the main dashboard. When its API could not be
 * reached it rendered a complete invented organisation - 950 headcount, 142 new hires,
 * 8.4% attrition, Rs 142.8 Lakhs of payroll across four made-up business units - and the
 * badges beside those figures read "(Firebase)", so they looked like they had come from
 * the database. A customer with two employees saw a company of 950.
 */
const central = fs.readFileSync(path.join(ROOT, 'admin-central-dashboard.js'), 'utf8');
const centralHtml = fs.readFileSync(path.join(ROOT, 'admin-central-dashboard.html'), 'utf8');

describe('the command centre invents no organisation', () => {
  it('has no fabricated headcount, payroll or attrition', () => {
    const code = central.replace(/\/\*[\s\S]*?\*\//g, '');   // ignore the comment explaining this
    for (const figure of ['950', '142.8', "8.4%", "94.2%"]) {
      assert.ok(!code.includes(figure), `the invented figure ${figure} is still present`);
    }
  });

  it('invents no business units to put on a chart', () => {
    assert.ok(!/'Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'/.test(central));
  });

  it('says the figures could not be loaded, rather than showing silent zeroes', () => {
    assert.match(central, /dashboardUnavailableNotice/);
    assert.match(central, /not your real numbers/i);
    assert.ok(centralHtml.includes('id="dashboardUnavailableNotice"'),
      'the notice needs somewhere to appear');
  });
});

describe('the greeting does not change under the reader', () => {
  // The pre-paint greeting moved out of the theme layer when that was removed.
  const theme = fs.readFileSync(path.join(ROOT, 'kylrx-greeting.js'), 'utf8');

  it('ships no placeholder word in the markup', () => {
    for (const f of ['admin-dashboard.html', 'admin-pms.html']) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.match(s, /<span id="welcomeUserName"><\/span>/,
        f + ': a placeholder name is what flashes before the real one');
    }
  });

  it('fills the name from the last session before the page paints', () => {
    assert.match(theme, /paintGreeting/);
    assert.match(theme, /welcomeUserName/);
  });

  it('never shows an email address as a name', () => {
    assert.match(theme, /indexOf\('@'\) > -1/);
  });

  it('updates only the name, not the whole heading', () => {
    // Replacing the <h1> swaps the element out and the greeting visibly jumps.
    assert.ok(!/welcomeText\.innerHTML = \(firstName \?/.test(app),
      'the heading must not be rewritten on load');
  });
});

describe('charts say what is going on', () => {
  /**
   * With nothing to plot, Chart.js draws an empty canvas - a blank rectangle the reader
   * cannot tell apart from a chart that failed to load or a broken layout. For a new
   * organisation that is the normal state, so it should read as such.
   */
  it('shows a message instead of a blank canvas', () => {
    assert.match(central, /function showChartMessage/);
    assert.match(central, /No data yet/);
  });

  it('separates having no data from having only zeroes', () => {
    assert.match(central, /Nothing recorded for this period/);
  });

  it('says so when the charting library itself is missing', () => {
    assert.match(central, /typeof Chart === 'undefined'/);
    assert.match(central, /Charts could not be loaded/);
  });

  it('clears the message once there is something to draw', () => {
    assert.match(central, /function hideChartMessage/);
  });
});

/*
 * The first theme attempt (kylrx-theme.js) was a stylesheet layered over thousands of
 * hard-coded colours it could not override, so it only partly applied and was removed.
 * The overhaul brief then asked for a full dark/light system, which now exists in a
 * different form: kylrx-theme-init.js plus token-based colours throughout (see
 * tests/theme-system.test.mjs). What must stay gone is the old partial layer.
 */
describe('the old partial theme layer is gone', () => {
  it('no page loads kylrx-theme.js', () => {
    const left = fs.readdirSync(ROOT)
      .filter(f => /\.html$/.test(f))
      .filter(f => /src="kylrx-theme\.js"/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    assert.deepEqual(left, [], 'these pages still load the removed partial theme');
    assert.ok(!fs.existsSync(path.join(ROOT, 'kylrx-theme.js')));
  });

  it('but the greeting fix it carried is kept', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'kylrx-greeting.js')),
      'the pre-paint greeting is not about appearance and should outlive the theme');
  });
});
