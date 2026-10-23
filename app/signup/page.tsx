import Link from 'next/link';
import { authStageInfo } from '../auth-info';
import { AuthStage } from '../auth-stage';
import { SyntheticBadge } from '../synthetic-badge';
import { activeDatasetLabel } from '@/db/seed';

export const dynamic = 'force-dynamic';

export default function SignUpPage() {
  return (
    <AuthStage
      mode="signup"
      info={authStageInfo()}
      badge={<SyntheticBadge dataset={activeDatasetLabel()} />}
      title="Create an account"
      intro="For the demo only. Your invite code sets which demo person you are, so your role and data access come from it, not from anything you type."
      signupEnabled={Boolean(process.env.DEMO_INVITE_SECRET)}
      disabledNote="Sign-up is turned off here. Set DEMO_INVITE_SECRET to turn it on."
      foot={<>Already have an account? <Link href="/login">Log in</Link>.</>}
    />
  );
}
