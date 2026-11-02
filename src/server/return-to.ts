// Where sign-in sends someone who arrived from an alert link while signed out (UX row 10). Only a rule id from
// ALERT_PROMPTS and an account id that passes isAlertAccount are carried, never free text or a URL, so a crafted link
// can't redirect anywhere but the copilot's own pages or pre-fill anything but a fixed question (open-redirect check).
// The rule lives in prompts.ts (alertQuery); this file only adds the path.
import { ALERT_PROMPTS, alertQuery } from './prompts';

/** What an alert link carries: the query of `/`, hidden form fields, or a page's search params. */
export type AlertParams = { prompt?: unknown; account?: unknown };

/** The prompt id if it names a fixed alert question, else undefined. */
export function safePromptId(id: unknown): string | undefined {
  return typeof id === 'string' && Object.hasOwn(ALERT_PROMPTS, id) ? id : undefined;
}

// Form fields and repeated query keys can be arrays or files: only a plain string reaches alertQuery.
const text = (v: unknown) => (typeof v === 'string' ? v : undefined);

const withAlert = (path: string, params: AlertParams | undefined) => `${path}${alertQuery({ prompt: text(params?.prompt), account: text(params?.account) })}`;

/** The log-in page, keeping the alert's question for after sign-in. */
export const loginPath = (params?: AlertParams) => withAlert('/login', params);

/** The sign-up page, keeping the alert's question for after sign-up. */
export const signupPath = (params?: AlertParams) => withAlert('/signup', params);

/** The overview after sign-in, pre-filled with the alert's question when there was one. */
export const homePath = (params?: AlertParams) => withAlert('/', params);
