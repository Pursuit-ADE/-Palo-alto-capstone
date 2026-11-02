'use client';

import type { FormEventHandler, Ref } from 'react';

/** The invite code box: required on the sign-up page, optional on the log-in page (filled in, it creates the account). */
export type InviteField = 'required' | 'optional' | 'off';

/**
 * The server's username rule (src/server/auth.ts USERNAME) as the browser sees the raw input: capitals are fine (the server
 * lowercases) and so are spaces around the name (the server trims; phone keyboards often add one). Browsers compile
 * `pattern` in Unicode-sets mode, where a literal hyphen must be escaped. tests/username-pattern.test.ts keeps them in step.
 */
export const USERNAME_PATTERN = String.raw`\s*[A-Za-z0-9._\-]{3,32}\s*`;

/**
 * Which action the form posts. On the sign-up page, and on the log-in page once the invite code box has text, it is the
 * sign-up action, so the code gets its rate limit, auth audit, and server-side password and invite checks. The log-in
 * action would ignore the code.
 */
export function formAction<A>(mode: 'login' | 'signup', inviteCode: string, actions: { logIn: A; signUp: A }): A {
  return mode === 'signup' || inviteCode.trim() !== '' ? actions.signUp : actions.logIn;
}

/**
 * The hints under the password and invite fields, by how the invite box works on this page; null where sign-up is off.
 * The 12-character rule sits with the field it governs and is read out with it. It used to be the last sentence of the
 * invite hint, two fields further down, and the password field described nothing (UX review, Nov 2, RD).
 */
function fieldHints(invite: InviteField): { password: string; invite: string } | null {
  if (invite === 'off') return null;
  return invite === 'optional'
    ? { password: 'New accounts need at least 12 characters.', invite: 'New here? Add the code you were given and this creates your account. It decides your demo person and role.' }
    : { password: 'At least 12 characters.', invite: 'The invite code decides which demo person and role your account gets.' };
}

/**
 * The page's heading. Typing an invite code on the log-in page makes the form create the account, and the button says so,
 * so the heading says so too instead of "Log in" over "Create account" (UX review, Nov 2, REC).
 */
export function headingFor(mode: 'login' | 'signup', creating: boolean, title: string): string {
  return mode === 'login' && creating ? 'Create an account' : title;
}

/**
 * An alert's question and account ids, posted with the form so signing in brings that question back (UX row 10). The
 * action only sees what the form posts, and checks both ids with prompts.ts again before redirecting with them.
 */
function AlertFields({ prompt, account }: { prompt?: string; account?: string }) {
  return (
    <>
      {prompt ? <input type="hidden" name="prompt" value={prompt} /> : null}
      {account ? <input type="hidden" name="account" value={account} /> : null}
    </>
  );
}

// The fields themselves. State lives in AuthStage, which also lets the name card submit this form.
export function AuthForm({ ref, id, invite, creating, action, pending, error, errorKey, username, inviteCode, onUsername, onInput, onReset, prompt, account }: {
  ref: Ref<HTMLFormElement>;
  id: string;
  invite: InviteField;
  creating: boolean;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: string;
  errorKey: number; // changes on every refused attempt, so a repeated message is announced again
  username: string;
  inviteCode: string;
  onUsername: (value: string) => void;
  onInput: FormEventHandler<HTMLFormElement>;
  onReset: FormEventHandler<HTMLFormElement>;
  prompt?: string;
  account?: string;
}) {
  const hints = fieldHints(invite);
  return (
    <form ref={ref} id={id} action={action} className="auth-form" onInput={onInput} onReset={onReset}>
      <AlertFields prompt={prompt} account={account} />
      <label htmlFor="username">Username</label>
      {/* Uncontrolled, so text typed before hydration or filled by a password manager is never overwritten. defaultValue
          follows what was typed, so the form reset React does after each attempt keeps the username (and invite code). */}
      {/* The same rule the server applies (src/server/auth.ts USERNAME), so a name with a space or an @ is caught before
          the form is sent, and the password typed alongside it isn't lost. Capitals are fine: the server lowercases. */}
      <input id="username" name="username" autoComplete="username" required minLength={3} maxLength={32} autoCapitalize="none" spellCheck={false} defaultValue={username} onChange={(e) => onUsername(e.target.value)} pattern={creating ? USERNAME_PATTERN : undefined} title={creating ? 'Letters, numbers, dots, dashes or underscores. No spaces.' : undefined} aria-describedby={creating ? 'username-hint' : undefined} />
      {creating && <p className="hint" id="username-hint">Letters, numbers, dots, dashes or underscores only. No spaces. For example: mira.k</p>}
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? 12 : 1} maxLength={128} aria-describedby={hints ? 'password-hint' : undefined} />
      {hints && <p className="hint" id="password-hint">{hints.password}</p>}
      {hints && (
        <>
          <label htmlFor="invite">
            Invite code{invite === 'optional' && <span className="optional"> (first time only)</span>}
          </label>
          <input id="invite" name="invite" autoComplete="off" required={invite === 'required'} placeholder="XXXX-XXXX-XXXX" maxLength={20} aria-describedby="invite-hint" defaultValue={inviteCode} />
          <p className="hint" id="invite-hint">{hints.invite}</p>
        </>
      )}
      {error && <p key={errorKey} className="auth-error" role="alert">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Working…' : creating ? 'Create account' : 'Log in'}</button>
    </form>
  );
}
