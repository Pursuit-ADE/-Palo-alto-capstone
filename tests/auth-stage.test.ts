// The sign-in form's invite switch (app/auth-form.tsx, app/auth-stage.tsx): the log-in page creates the account when the
// invite code box has text, and that has to go through signUpAction, because logInAction ignores the code.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { logInAction, signUpAction } from '../app/auth-actions';
import { formAction } from '../app/auth-form';

const actions = { logIn: logInAction, signUp: signUpAction };

describe('invite switch', () => {
  it('a filled invite on the log-in page posts signUpAction; an empty one stays on logInAction', () => {
    expect(formAction('login', 'ABCD-EFGH-JKLM', actions)).toBe(signUpAction);
    expect(formAction('login', ' ABCD ', actions)).toBe(signUpAction);
    expect(formAction('login', '', actions)).toBe(logInAction);
    expect(formAction('login', '   ', actions)).toBe(logInAction); // spaces are not a code
    expect(formAction('signup', '', actions)).toBe(signUpAction); // the sign-up page always signs up
  });

  it('the form posts what formAction picks, and the button and password rules follow it', () => {
    const stage = readFileSync('app/auth-stage.tsx', 'utf8');
    expect(stage).toMatch(/\[loginState, loginAction, loginPending\] = useActionState<AuthState, FormData>\(logInAction, null\)/);
    expect(stage).toMatch(/\[signupState, signupAction, signupPending\] = useActionState<AuthState, FormData>\(signUpAction, null\)/);
    expect(stage).toMatch(/const action = formAction\(mode, inviteCode, \{ logIn: loginAction, signUp: signupAction \}\);/);
    expect(stage).toMatch(/const creating = action === signupAction;/);
    expect(stage.match(/\baction=\{[^}]*\}/g)).toEqual(['action={action}']);
  });
});
