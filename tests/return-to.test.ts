// Sign-in keeps an alert's question, and only ever a fixed prompt id (UX row 10, open-redirect check).
import { expect, it } from 'vitest';
import { homePath, loginPath, safePromptId, signupPath } from '@/server/return-to';

it('carries a known prompt id through log-in, sign-up and back to the overview', () => {
  expect(loginPath({ prompt: 'high_severity_case' })).toBe('/login?prompt=high_severity_case');
  expect(signupPath({ prompt: 'cxo_engagement' })).toBe('/signup?prompt=cxo_engagement');
  expect(homePath({ prompt: 'low_usage' })).toBe('/?prompt=low_usage');
  expect(loginPath()).toBe('/login');
  expect(homePath({ prompt: 'cxo_engagement', account: 'acc_acme_corporation' })).toBe('/?prompt=cxo_engagement&account=acc_acme_corporation');
  expect(homePath({ prompt: 'cxo_engagement', account: 'https://evil.example' })).toBe('/?prompt=cxo_engagement');
  expect(homePath({ account: 'acc_acme_corporation' })).toBe('/');
});

it('drops anything that is not a prompt id', () => {
  const forged = [undefined, null, '', 'https://evil.example', '//evil.example', '/\\evil.example', 'What is our open pipeline?', 'high_severity_case&next=//evil.example', 'toString', '__proto__', ['high_severity_case'], 42];
  for (const prompt of forged) {
    expect(safePromptId(prompt), String(prompt)).toBeUndefined();
    expect(loginPath({ prompt })).toBe('/login');
    expect(homePath({ prompt })).toBe('/');
  }
});
