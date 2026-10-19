import Link from 'next/link';
import { AuthForm } from '../auth-form';
import { SyntheticBadge } from '../synthetic-badge';
import { activeDatasetLabel } from '@/db/seed';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="auth-page">
      <SyntheticBadge dataset={activeDatasetLabel()} />
      <div className="page-head">
        <h1>Log in</h1>
        <p>Governed Analytics Copilot · Team ALTO PALS. Demo accounts only; a real rollout uses company single sign-on.</p>
      </div>
      <AuthForm mode="login" />
      <p className="hint">No account yet? <Link href="/signup">Create one with an invite code</Link>.</p>
    </main>
  );
}
