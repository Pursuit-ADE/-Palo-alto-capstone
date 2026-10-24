'use client';

import type { FormEventHandler, Ref } from 'react';

/** The invite code box: required on the sign-up page, optional on the log-in page (filled in, it creates the account). */
export type InviteField = 'required' | 'optional' | 'off';

/**
 * Which action the form posts. On the sign-up page, and on the log-in page once the invite code box has text, it is the
 * sign-up action, so the code gets its rate limit, auth audit, and server-side password and invite checks. The log-in
 * action would ignore the code.
 */
export function formAction<A>(mode: 'login' | 'signup', inviteCode: string, actions: { logIn: A; signUp: A }): A {
  return mode === 'signup' || inviteCode.trim() !== '' ? actions.signUp : actions.logIn;
}

// The fields themselves. State lives in AuthStage, which also lets the name card submit this form.
export function AuthForm({ ref, id, invite, creating, action, pending, error, errorKey, username, inviteCode, onUsername, onInput, onReset }: {
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
}) {
  return (
    <form ref={ref} id={id} action={action} className="auth-form" onInput={onInput} onReset={onReset}>
      <label htmlFor="username">Username</label>
      {/* Uncontrolled, so text typed before hydration or filled by a password manager is never overwritten. defaultValue
          follows what was typed, so the form reset React does after each attempt keeps the username (and invite code). */}
      <input id="username" name="username" autoComplete="username" required minLength={3} maxLength={32} autoCapitalize="none" spellCheck={false} defaultValue={username} onChange={(e) => onUsername(e.target.value)} />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete={creating ? 'new-password' : 'current-password'} required minLength={creating ? 12 : 1} maxLength={128} />
      {invite !== 'off' && (
        <>
          <label htmlFor="invite">
            Invite code{invite === 'optional' && <span className="optional"> (first time only)</span>}
          </label>
          <input id="invite" name="invite" autoComplete="off" required={invite === 'required'} placeholder="XXXX-XXXX-XXXX" maxLength={20} aria-describedby="invite-hint" defaultValue={inviteCode} />
          <p className="hint" id="invite-hint">
            {invite === 'optional'
              ? 'New here? Add the code you were given and this creates your account. It decides your demo person and role. Passwords need at least 12 characters.'
              : 'The invite code decides which demo person and role your account gets. At least 12 characters for the password.'}
          </p>
        </>
      )}
      {error && <p key={errorKey} className="auth-error" role="alert">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Working…' : creating ? 'Create account' : 'Log in'}</button>
    </form>
  );
}
