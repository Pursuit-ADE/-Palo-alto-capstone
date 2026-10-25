// The sign-up form checks the username in the browser with the same rule the server applies after trimming and
// lowercasing, so a name with a space or an @ is caught before the form is sent (reported Oct 24: 12 failed sign-ups
// in a row). The alerts app's copy of the form must stay identical.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { USERNAME_PATTERN } from '../app/auth-form';
import { USERNAME } from '@/server/auth';

// Browsers compile `pattern` as ^(?:pattern)$ with the Unicode-sets flag.
const browser = new RegExp(`^(?:${USERNAME_PATTERN})$`, 'v');
// The server's own rule, imported so a change there fails here instead of drifting silently.
const server = (u: string) => USERNAME.test(u.trim().toLowerCase());

describe('username pattern on the sign-up form', () => {
  it('compiles in Unicode-sets mode, as browsers require', () => {
    expect(() => new RegExp(`^(?:${USERNAME_PATTERN})$`, 'v')).not.toThrow();
  });

  it.each([
    'mira.k',
    'Mira_K',
    'jordan-lee',
    'abc',
    'a'.repeat(32),
    'mira.k ', // a phone keyboard's trailing space: the server trims it, so the form must allow it
    ' mira.k',
    'Mira K',
    'mira@pursuit.org',
    'ab',
    'a'.repeat(33),
    'mira/k',
  ])('agrees with the server on "%s"', (u) => {
    expect(browser.test(u)).toBe(server(u));
  });

  it('is the same form in the copilot and the alerts app', () => {
    expect(fs.readFileSync('alerts/app/auth-form.tsx', 'utf8')).toBe(fs.readFileSync('app/auth-form.tsx', 'utf8'));
  });
});
