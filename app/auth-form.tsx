'use client';

import { useActionState } from 'react';
import { logInAction, signUpAction, type AuthState } from './auth-actions';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === 'login' ? logInAction : signUpAction, null);
  return (
    <form action={action} className="auth-form">
      <label htmlFor="username">Username</label>
      <input id="username" name="username" autoComplete="username" required minLength={3} maxLength={32} />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'signup' ? 12 : 1} maxLength={128} />
      {mode === 'signup' && (
        <>
          <label htmlFor="invite">Invite code</label>
          <input id="invite" name="invite" autoComplete="off" required placeholder="XXXX-XXXX-XXXX" maxLength={20} />
          <p className="hint">The invite code decides which demo person and role your account gets. At least 12 characters for the password.</p>
        </>
      )}
      {state?.error && <p className="auth-error" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
    </form>
  );
}
