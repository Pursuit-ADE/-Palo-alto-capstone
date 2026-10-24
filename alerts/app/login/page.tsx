import Link from 'next/link';
import { authStageInfo } from '../auth-info';
import { AuthStage } from '../auth-stage';
import { SyntheticBadge } from '../synthetic-badge';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  const signupEnabled = Boolean(process.env.DEMO_INVITE_SECRET);
  return (
    <AuthStage
      mode="login"
      info={authStageInfo()}
      badge={<SyntheticBadge />}
      title="Log in"
      intro={`Use the same invite code as the copilot; accounts here are separate. Demo accounts only; a real rollout uses company single sign-on.${signupEnabled ? ' First time here? Add your invite code below.' : ''}`}
      signupEnabled={signupEnabled}
      foot={signupEnabled ? <>Prefer a separate page? <Link href="/signup">Create an account</Link>.</> : <>Sign-up is turned off here, so ask for an account.</>}
    />
  );
}
