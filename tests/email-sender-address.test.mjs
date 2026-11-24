/**
 * The Resend path hardcoded `from: 'HRFlow <onboarding@resend.dev>'`, so EMAIL_FROM -
 * documented in .env.example and listed by check-env as recommended - was silently
 * ignored. Onboarding invites would have gone out from Resend's shared test domain
 * instead of the customer's, which cannot carry their branding and which Resend
 * restricts delivery for.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(fileURLToPath(new URL('../utils/email.js', import.meta.url)), 'utf8');

describe('outbound email sender address', () => {
  it('uses EMAIL_FROM on the Resend path', () => {
    assert.match(src, /from:\s*fromAddress/, 'Resend send() must use the resolved sender');
    assert.match(src, /process\.env\.EMAIL_FROM/, 'EMAIL_FROM must be read');
  });

  it('applies EMAIL_SENDER_NAME to the display name', () => {
    assert.match(src, /process\.env\.EMAIL_SENDER_NAME/);
  });

  it('still falls back to the test domain when nothing is configured', () => {
    assert.match(src, /onboarding@resend\.dev/, 'a fallback sender must remain');
  });

  it('does not pass the test domain directly as the send() sender', () => {
    assert.ok(
      !/from:\s*'HRFlow <onboarding@resend\.dev>'/.test(src),
      'the hardcoded sender is back - EMAIL_FROM would be ignored again'
    );
  });

  it('throws a clear error when no transport is configured at all', () => {
    assert.match(src, /No email transport configured/);
  });

  it('reads the Gmail app password with spaces stripped', () => {
    // Google displays app passwords in 4-char groups; pasting them verbatim is the norm.
    assert.match(src, /SMTP_PASS\.replace\(/);
  });
});

describe('SMTP transport is not locked to Gmail', () => {
  it('uses SMTP_HOST when one is configured', () => {
    assert.match(src, /process\.env\.SMTP_HOST/, 'SMTP_HOST must select the provider');
    assert.match(src, /host:\s*process\.env\.SMTP_HOST/);
  });

  it('still defaults to Gmail when SMTP_HOST is absent', () => {
    assert.match(src, /service:\s*'gmail'/, 'the Gmail default must remain for existing setups');
  });

  it('defaults the port to 587 and derives TLS from it', () => {
    assert.match(src, /SMTP_PORT\s*\|\|\s*587/);
    assert.match(src, /secure:/);
  });

  it('sends as EMAIL_FROM on a real relay, but as the account on Gmail', () => {
    assert.match(src, /const smtpFrom\s*=\s*\(process\.env\.SMTP_HOST && process\.env\.EMAIL_FROM\) \|\| process\.env\.SMTP_USER/);
    assert.match(src, /from:\s*`"\$\{senderName\}" <\$\{smtpFrom\}>`/);
  });

  it('does not hardcode Gmail as the only transport', () => {
    assert.ok(
      !/createTransport\(\{\s*service:\s*'gmail'/.test(src),
      'transport is hardcoded to Gmail again - other providers would authenticate against Google'
    );
  });
});
