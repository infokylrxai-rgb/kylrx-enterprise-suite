/**
 * Temporary passwords were `${firstName}@${randomInt(1000,9999)}#` - the holder's own public
 * name plus four digits, about 9,000 possibilities. Sign-in goes from the browser directly to
 * Firebase Authentication, so the Express rate limiter never sees those attempts and could not
 * slow a search of that space.
 *
 * They were also STORED in plaintext on users/{uid}, which firestore.rules lets every signed-in
 * member of the same organisation read, putting one employee's working credential in front of
 * all their colleagues. And re-sending an invite fell back to a hardcoded literal.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { generateSecurePassword } = require('../utils/passwordGenerator.js');
const adminSrc = fs.readFileSync(fileURLToPath(new URL('../controllers/adminController.js', import.meta.url)), 'utf8');

// Comments quote the old code verbatim to record why it was removed, so a "must not contain"
// assertion has to read the code alone or it flags its own explanation.
const adminCode = adminSrc.split(String.fromCharCode(10))
  .map(l => l.split('//')[0])
  .join(String.fromCharCode(10));

describe('temporary passwords are not guessable', () => {
  it('never contains the name it was given', () => {
    for (let i = 0; i < 500; i++) {
      const pw = generateSecurePassword('Nicole Test');
      assert.ok(!/nicole|test/i.test(pw), `password leaked the name: ${pw}`);
    }
  });

  it('is at least 16 characters', () => {
    assert.ok(generateSecurePassword('x').length >= 16);
  });

  it('is unique across many generations', () => {
    const set = new Set(Array.from({ length: 3000 }, () => generateSecurePassword('Same Name')));
    assert.ok(set.size > 2995, `only ${set.size} unique of 3000 - the space is too small`);
  });

  it('mixes upper, lower, digit and symbol', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateSecurePassword('User');
      assert.match(pw, /[A-Z]/); assert.match(pw, /[a-z]/);
      assert.match(pw, /[0-9]/); assert.match(pw, /[^A-Za-z0-9]/);
    }
  });

  it('does not use the old name-plus-four-digits shape', () => {
    const pw = generateSecurePassword('Nicole Test');
    assert.ok(!/^[A-Za-z]+@[0-9]{4}#$/.test(pw), `the old weak format is back: ${pw}`);
  });
});

describe('temporary passwords are not stored or guessed', () => {
  it('the created profile does not persist the password', () => {
    // Returning it in the response is intended - the admin needs it once. What must not happen
    // is persisting it, so inspect only the object that is written to Firestore.
    const start = adminSrc.indexOf('const employeeData = {');
    assert.ok(start > -1, 'employeeData object not found');
    const stored = adminSrc.slice(start, adminSrc.indexOf('\n        };', start));
    assert.ok(!/tempPassword[ ]*:/.test(stored),
      'tempPassword is in the object written to Firestore again');
  });

  it('resending an invite mints a new password rather than reading a stored one', () => {
    assert.match(adminSrc, /reissuedPassword/, 'resend must issue a fresh password');
    assert.match(adminSrc, /updateUser\(id, \{ password: reissuedPassword \}\)/);
  });

  it('no hardcoded fallback password remains', () => {
    // Match it being USED as a fallback value, not the comment recording why it went.
    assert.ok(!/\|\|[ ]*'TemporaryPass/.test(adminCode),
      'the hardcoded fallback would email a password that is not the user-s');
  });

  it('a failed profile write is reported, not swallowed', () => {
    assert.match(adminSrc, /profileError/, 'the persistence failure must reach the caller');
    assert.match(adminSrc, /profile_warning/);
    // A department fetch elsewhere also uses 2000ms, so target the Firestore write specifically.
    assert.ok(!/Firestore write timeout'\)\), 2000\)/.test(adminSrc),
      'the 2s cap on the only persistence is back');
    assert.match(adminSrc, /Firestore write timeout'\)\), 15000\)/);
  });
});
