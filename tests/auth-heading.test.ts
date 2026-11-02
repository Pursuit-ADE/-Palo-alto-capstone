// The log-in page's heading follows its button: with an invite code typed, both say the account is being created
// (UX review, Nov 2, REC).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { headingFor } from '../app/auth-form';

it('says "Create an account" on the log-in page once the form creates one, and the page title otherwise', () => {
  expect(headingFor('login', false, 'Log in')).toBe('Log in');
  expect(headingFor('login', true, 'Log in')).toBe('Create an account');
  expect(headingFor('signup', true, 'Create an account')).toBe('Create an account');
});

it('is what both apps put in the page heading', () => {
  for (const file of ['app/auth-stage.tsx', 'alerts/app/auth-stage.tsx']) {
    expect(readFileSync(file, 'utf8')).toContain('<h1 id="auth-title">{headingFor(mode, creating, title)}</h1>');
  }
});
