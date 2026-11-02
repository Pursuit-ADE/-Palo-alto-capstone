import Link from 'next/link';
import { redirect } from 'next/navigation';
import { authStageInfo } from '../auth-info';
import { AuthStage } from '../auth-stage';
import { SyntheticBadge } from '../synthetic-badge';
import { activeDatasetLabel } from '@/db/seed';
import { homePath, loginPath } from '@/server/return-to';
import { currentSession } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ prompt?: string }> }) {
  // Already signed in (UX review, Nov 2): go to the overview rather than show the form again.
  const params = await searchParams;
  if (await currentSession()) redirect(homePath(params));
  return (
    <AuthStage
      mode="signup"
      info={authStageInfo()}
      badge={<SyntheticBadge dataset={activeDatasetLabel()} />}
      title="Create an account"
      intro="For the demo only. Your invite code sets which demo person you are, so your role and data access come from it, not from anything you type."
      signupEnabled={Boolean(process.env.DEMO_INVITE_SECRET)}
      disabledNote="Sign-up is turned off here. Set DEMO_INVITE_SECRET to turn it on."
      foot={<>Already have an account? <Link href={loginPath(params)}>Log in</Link>.</>}
    />
  );
}
