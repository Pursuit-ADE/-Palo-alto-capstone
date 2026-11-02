import Link from 'next/link';
import { redirect } from 'next/navigation';
import { authStageInfo } from '../auth-info';
import { AuthStage } from '../auth-stage';
import { SyntheticBadge } from '../synthetic-badge';
import { activeDatasetLabel } from '@/db/seed';
import { homePath, safePromptId, signupPath } from '@/server/return-to';
import { isAlertAccount } from '@/server/prompts';
import { currentSession } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ prompt?: string; account?: string }> }) {
  // Already signed in (UX review, Nov 2): go to the overview rather than show the form again.
  const params = await searchParams;
  if (await currentSession()) redirect(homePath(params));
  const signupEnabled = Boolean(process.env.DEMO_INVITE_SECRET);
  return (
    <AuthStage
      mode="login"
      info={authStageInfo()}
      badge={<SyntheticBadge dataset={activeDatasetLabel()} />}
      title="Log in"
      intro={`Demo accounts only; a real rollout uses company single sign-on.${signupEnabled ? ' First time here? Add your invite code below.' : ''}`}
      prompt={safePromptId(params.prompt)}
      account={safePromptId(params.prompt) && isAlertAccount(params.account) ? params.account : undefined}
      signupEnabled={signupEnabled}
      foot={signupEnabled ? <>Prefer a separate page? <Link href={signupPath(params)}>Create an account</Link>.</> : <>Sign-up is turned off here, so ask for an account.</>}
    />
  );
}
