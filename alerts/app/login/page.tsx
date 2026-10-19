import Link from 'next/link';
import { AuthForm } from '../auth-form';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="auth-page">
      <div className="page-head">
        <h1>Log in</h1>
        <p>Actionable Alerts · Team ALTO PALS. Use the same invite code as the copilot; accounts here are separate. Demo accounts only; a real rollout uses company single sign-on.</p>
      </div>
      <AuthForm mode="login" />
      <p className="hint">No account yet? <Link href="/signup">Create one with an invite code</Link>.</p>
    </main>
  );
}
