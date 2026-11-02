// Where sign-in sends someone who arrived from an alert link while signed out (UX row 10). Only an id from
// ALERT_PROMPTS is carried, never free text or a URL, so a crafted link can't redirect anywhere but the copilot's own
// pages or pre-fill anything but one of the fixed questions (open-redirect check).
import { ALERT_PROMPTS } from './prompts';

/** What an alert link carries: the query of `/`, a hidden form field, or a page's search params. */
export type AlertParams = { prompt?: unknown };

/** The prompt id if it names a fixed alert question, else undefined. */
export function safePromptId(id: unknown): string | undefined {
  return typeof id === 'string' && Object.hasOwn(ALERT_PROMPTS, id) ? id : undefined;
}

const withAlert = (path: string, params: AlertParams | undefined) => {
  const safe = safePromptId(params?.prompt);
  return safe ? `${path}?prompt=${encodeURIComponent(safe)}` : path;
};

/** The log-in page, keeping the alert's question for after sign-in. */
export const loginPath = (params?: AlertParams) => withAlert('/login', params);

/** The sign-up page, keeping the alert's question for after sign-up. */
export const signupPath = (params?: AlertParams) => withAlert('/signup', params);

/** The overview after sign-in, pre-filled with the alert's question when there was one. */
export const homePath = (params?: AlertParams) => withAlert('/', params);
