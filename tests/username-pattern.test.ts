// The sign-up form checks the username in the browser with the same rule the server applies after lowercasing,
// so a name with a space or an @ is caught before the form is sent (reported Oct 24: 12 failed sign-ups in a row).
import { describe, expect, it } from 'vitest';
import { USERNAME_PATTERN } from '../app/auth-form';

// Browsers compile `pattern` as ^(?:pattern)$ with the Unicode-sets flag.
const browser = new RegExp(`^(?:${USERNAME_PATTERN})$`, 'v');
const server = (u: string) => /^[a-z0-9._-]{3,32}$/.test(u.trim().toLowerCase());

describe('username pattern on the sign-up form', () => {
  it('compiles in Unicode-sets mode, as browsers require', () => {
    expect(() => new RegExp(`^(?:${USERNAME_PATTERN})$`, 'v')).not.toThrow();
  });

  it.each(['mira.k', 'Mira_K', 'jordan-lee', 'abc', 'a'.repeat(32), 'Mira K', 'mira@pursuit.org', 'ab', 'a'.repeat(33), 'mira/k'])(
    'agrees with the server on "%s"',
    (u) => {
      expect(browser.test(u)).toBe(server(u));
    },
  );
});
