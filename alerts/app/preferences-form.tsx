'use client';

import { useActionState } from 'react';
import { saveSubscription, type SaveResult } from './actions';

interface Sub {
  frequency: string;
  quietStartHour: number | null;
  quietEndHour: number | null;
  criticalBypass: boolean;
  channel: string;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const FREQUENCY_LABELS: [string, string][] = [
  ['realtime', 'Right away'],
  ['daily', 'Daily digest'],
  ['weekly', 'Weekly digest (Mondays)'],
  ['monthly', 'Monthly digest (the 1st)'],
];

// etHours[h] is UTC hour h in Eastern for today, worked out on the server so it follows daylight saving (UX review Nov 2, OPT 5).
// has says which of the person's own destinations an admin has set up. A channel without one is still listed, so a saved
// choice still shows, but says what's missing before Save refuses it (UX review Nov 2, OPT 6).
export function PreferencesForm({ user, ruleId, ruleName, critical, sub, etHours, has }: { user: string; ruleId: string; ruleName: string; critical: boolean; sub: Sub | null; etHours: string[]; has: { slack: boolean; email: boolean } }) {
  const [state, action, pending] = useActionState<SaveResult, FormData>(saveSubscription, null);
  const freq = sub?.frequency === 'digest' ? 'daily' : (sub?.frequency ?? 'realtime');
  const id = (k: string) => `${ruleId}-${k}`;
  return (
    // Keyed by the saved settings: React resets a form after its action, which put the selects back to the values the
    // page first rendered with, so a saved "Slack" looked like "In-app inbox" (demo prep, Nov 3). A new key remounts the
    // form with the freshly saved values instead.
    <form key={JSON.stringify(sub)} action={action} className="pref">
      <input type="hidden" name="user" value={user} />
      <input type="hidden" name="ruleId" value={ruleId} />
      <label className="pref-sub" htmlFor={id('subscribed')}>
        <input id={id('subscribed')} type="checkbox" name="subscribed" defaultChecked={!!sub} /> <b>{ruleName}</b>
      </label>
      <div className="pref-grid">
        <label htmlFor={id('frequency')}>How often
          <select id={id('frequency')} name="frequency" defaultValue={freq}>
            {FREQUENCY_LABELS.map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
          </select>
        </label>
        <label htmlFor={id('channel')}>Where
          <select id={id('channel')} name="channel" defaultValue={sub?.channel ?? 'inbox'}>
            <option value="inbox">In-app inbox</option>
            <option value="slack">{has.slack ? 'Slack (your own link)' : 'Slack: not set up yet, an admin adds your link'}</option>
            <option value="email">{has.email ? 'Email (your own address)' : 'Email: not set up yet, an admin adds your address'}</option>
            <option value="slack_email">{has.slack && has.email ? 'Slack and email' : 'Slack and email: needs both set up'}</option>
          </select>
        </label>
        <label htmlFor={id('quietStartHour')}>Quiet from (UTC)
          <select id={id('quietStartHour')} name="quietStartHour" defaultValue={sub?.quietStartHour ?? ''}>
            <option value="">No quiet hours</option>
            {HOURS.map((h) => (<option key={h} value={h}>{String(h).padStart(2, '0')}:00 ({etHours[h]} ET)</option>))}
          </select>
        </label>
        <label htmlFor={id('quietEndHour')}>Quiet until (UTC)
          <select id={id('quietEndHour')} name="quietEndHour" defaultValue={sub?.quietEndHour ?? ''}>
            <option value="">No quiet hours</option>
            {HOURS.map((h) => (<option key={h} value={h}>{String(h).padStart(2, '0')}:00 ({etHours[h]} ET)</option>))}
          </select>
        </label>
      </div>
      {critical && (
        <label className="pref-sub" htmlFor={id('criticalBypass')}>
          <input id={id('criticalBypass')} type="checkbox" name="criticalBypass" defaultChecked={sub?.criticalBypass ?? false} /> Let P1 (critical) cases through quiet hours and digests
        </label>
      )}
      <div className="pref-actions">
        <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
        {state && <span role="status" className={state.ok ? 'ok-text' : 'err-text'}>{state.message}</span>}
      </div>
    </form>
  );
}
