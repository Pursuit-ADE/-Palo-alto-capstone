// Demo subscriptions (L3). In the product each user edits these themselves.
export const DEMO_NOW = new Date('2026-10-08T15:00:00Z');
export const DEMO_SINCE = new Date('2026-09-01T00:00:00Z');

export const DEMO_SUBSCRIPTIONS = [
  // Jordan wants case alerts right away, but not at night; a P1 still gets through.
  { userId: 'u_ts_east', ruleId: 'high_severity_case', frequency: 'realtime', channel: 'inbox', quietStartHour: 22, quietEndHour: 7, criticalBypass: true },
  // Sam prefers one daily digest for cases, with no exception for P1.
  { userId: 'u_ts_west', ruleId: 'high_severity_case', frequency: 'daily', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false },
  // Darcel gets CXO engagement alerts as they happen.
  { userId: 'u_darcel_schlecht', ruleId: 'cxo_engagement', frequency: 'realtime', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false },
  // Jordan is a technical seller on Acme's account team, and the synthetic usage data has Acme at 15% of what it bought.
  { userId: 'u_ts_east', ruleId: 'low_usage', frequency: 'realtime', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false },
  // A rep subscribed to a technical-seller rule receives nothing: the rule's audience excludes sales reps.
  { userId: 'u_darcel_schlecht', ruleId: 'high_severity_case', frequency: 'realtime', channel: 'inbox', quietStartHour: null, quietEndHour: null, criticalBypass: false },
];
