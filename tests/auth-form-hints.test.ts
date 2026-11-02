// The sign-in form's hints sit with the fields they describe and are read out with them (UX review, Nov 2, RD).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuthForm, type InviteField } from '../app/auth-form';

const form = (invite: InviteField, creating: boolean, prompt?: string, account?: string) =>
  renderToStaticMarkup(
    createElement(AuthForm, {
      ref: null,
      id: 'f',
      invite,
      creating,
      action: () => {},
      pending: false,
      errorKey: 0,
      username: '',
      inviteCode: '',
      onUsername: () => {},
      onInput: () => {},
      onReset: () => {},
      prompt,
      account,
    }),
  );
const passwordInput = (html: string) => html.match(/<input[^>]*id="password"[^>]*>/)?.[0] ?? '';
const hint = (html: string, id: string) => html.match(new RegExp(`<p class="hint" id="${id}">([^<]*)</p>`))?.[1];

describe('the password rule', () => {
  it('is under the password field on sign-up, and the field is described by it', () => {
    const html = form('required', true);
    expect(passwordInput(html)).toContain('aria-describedby="password-hint"');
    expect(hint(html, 'password-hint')).toBe('At least 12 characters.');
    // It comes straight after the password field, before the invite code.
    expect(html.indexOf('id="password-hint"')).toBeGreaterThan(html.indexOf('id="password"'));
    expect(html.indexOf('id="password-hint"')).toBeLessThan(html.indexOf('for="invite"'));
  });

  it('says it is for new accounts on the log-in page, and the invite hints no longer mention passwords', () => {
    for (const creating of [false, true]) {
      const html = form('optional', creating);
      expect(passwordInput(html)).toContain('aria-describedby="password-hint"');
      expect(hint(html, 'password-hint')).toBe('New accounts need at least 12 characters.');
      expect(hint(html, 'invite-hint')).not.toMatch(/password|12/i);
    }
    expect(hint(form('required', true), 'invite-hint')).not.toMatch(/password|12/i);
  });

  it('is absent where nobody can create an account', () => {
    const html = form('off', false);
    expect(passwordInput(html)).not.toContain('aria-describedby');
    expect(html).not.toContain('password-hint');
  });
});

describe('the alert question and account ids (UX row 10)', () => {
  it('are posted as hidden fields only when the page passes them', () => {
    const html = form('optional', false, 'cxo_engagement', 'acc_acme_corporation');
    expect(html).toContain('<input type="hidden" name="prompt" value="cxo_engagement"/>');
    expect(html).toContain('<input type="hidden" name="account" value="acc_acme_corporation"/>');
    expect(form('optional', false)).not.toMatch(/name="(prompt|account)"/);
  });
});
