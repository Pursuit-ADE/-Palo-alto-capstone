import Link from 'next/link';
import { AuthForm } from '../auth-form';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  const enabled = Boolean(process.env.DEMO_INVITE_SECRET);
  return (
    <main className="auth-page">
      <div className="page-head">
        <h1>Create an account</h1>
        <p>For the demo only. Your invite code sets which demo person you are, so your role and data access come from it, not from anything you type.</p>
      </div>
      {enabled ? <AuthForm mode="signup" /> : <p className="auth-error">Sign-up is turned off here. Set DEMO_INVITE_SECRET to turn it on.</p>}
      <p className="hint">Already have an account? <Link href="/login">Log in</Link>.</p>
    </main>
  );
}
