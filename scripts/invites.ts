// Prints the demo invite codes, one per demo person, for DEMO_INVITE_SECRET. Share each code only with the
// person who should be that demo identity: the code decides their role and data access.
import { demoUsers } from '../src/db/seed';
import { inviteCode } from '../src/server/auth';

const secret = process.env.DEMO_INVITE_SECRET;
if (!secret) {
  console.error('Set DEMO_INVITE_SECRET first (a long random value), then run again.');
  process.exit(1);
}
for (const u of demoUsers()) console.log(`${inviteCode(u.id, secret)}  ${u.displayName}`);
