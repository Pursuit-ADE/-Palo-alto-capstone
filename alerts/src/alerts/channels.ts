// Delivery channels (L5). "inbox" is the in-app dev inbox: the delivery row itself is the message.
// "slack" posts to a webhook that belongs to that one user (a DM or private channel). "email" posts
// to a webhook with that user's own address as the only recipient. "slack_email" sends to both. There is no shared fallback:
// a user without their own Slack webhook or email address gets nothing on that channel, so an
// alert can never land where someone else can read it.
import type { alertDeliveries } from '../db/schema';

type Delivery = typeof alertDeliveries.$inferSelect;
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal; redirect?: 'error' }) => Promise<{ ok: boolean }>;

export type MailMessage = { to: string; subject: string; text: string; html: string };
export type SendMail = (msg: MailMessage, init: { signal?: AbortSignal }) => Promise<boolean>;

/** Slack calls give up after this long, so a hung request can't hold an alert claim open. */
export const CHANNEL_TIMEOUT_MS = 10_000;

export interface Channels {
  deliver(channel: string, userId: string, items: Delivery[], isDigest: boolean): Promise<boolean>;
}

/**
 * Breaks bare URLs and domain names so Slack and mail clients cannot turn case text into a link
 * (`https[:]//evil[.]example`). The copilot link we build ourselves is added after this runs.
 */
export function defang(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*):\/\//gi, '$1[:]//')
    .replace(/\b([a-z0-9-]+)\.(?=[a-z])/gi, '$1[.]');
}

/**
 * Makes event text safe to show in Slack. Escaping stops angle-bracket links and mentions. Slack also turns
 * bare URLs and domain names into links, so those are defanged ("https[:]//evil[.]example"): readable, but not
 * clickable. Only the copilot link we build ourselves is a real link. Slack has no escape for its formatting
 * characters, so *, _, ~ and ` in event text become look-alikes (∗ ＿ ∼ ˋ) and can't bold, strike or hide text.
 */
export function slackEscape(text: string): string {
  return defang(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[*_~`]/g, (c) => SLACK_LOOKALIKE[c] ?? c);
}

const SLACK_LOOKALIKE: Record<string, string> = { '*': '∗', _: '＿', '~': '∼', '`': 'ˋ' };

export function slackText(items: Delivery[], isDigest: boolean): string {
  const lines = items.map((i) => `• *${slackEscape(i.title)}*\n${slackEscape(i.explanation)}\n<${i.link}|Ask the copilot>`);
  return (isDigest ? `Your alert digest (${items.length})\n\n` : '') + lines.join('\n\n');
}

export function emailEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Subjects cannot carry CR/LF, or a planted title could add Bcc/To headers. */
export function emailSubject(items: Delivery[], isDigest: boolean): string {
  const raw = isDigest ? `Your alert digest (${items.length})` : items[0]?.title ?? 'Alert';
  return defang(raw.replace(/[\r\n\0]+/g, ' ').trim()).slice(0, 200);
}

export function emailText(items: Delivery[], isDigest: boolean): string {
  const lines = items.map((i) => `${defang(i.title)}\n${defang(i.explanation)}\nAsk the copilot: ${i.link}`);
  return (isDigest ? `Your alert digest (${items.length})\n\n` : '') + lines.join('\n\n');
}

function copilotHref(link: string): string | null {
  try {
    const url = new URL(link);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function emailHtml(items: Delivery[], isDigest: boolean): string {
  const heading = isDigest ? `<p>Your alert digest (${items.length})</p>` : '';
  const blocks = items.map((i) => {
    const href = copilotHref(i.link);
    const ask = href ? `<a href="${emailEscape(href)}">Ask the copilot</a>` : 'Ask the copilot';
    return `<p><b>${emailEscape(defang(i.title))}</b><br>${emailEscape(defang(i.explanation))}<br>${ask}</p>`;
  });
  return heading + blocks.join('');
}

export const EMAIL_WEBHOOK_WARNING =
  'EMAIL_WEBHOOK_URL is missing or not an allowed catcher; email alerts will fail until it is set (an HTTPS host listed in EMAIL_WEBHOOK_HOSTS, or http://127.0.0.1 / localhost with npm run dev).';

export function createChannels(opts: {
  slackWebhooks?: Record<string, unknown>;
  emails?: string | Record<string, unknown>;
  emailWebhook?: string;
  fetch?: Fetch;
  sendMail?: SendMail;
  env?: Record<string, string | undefined>;
  warn?: (message: string) => void;
} = {}): Channels {
  // Validated once at startup, whether passed in or read from the environment.
  const env = opts.env ?? process.env;
  const webhooks = parseWebhooks(opts.slackWebhooks ?? env.SLACK_USER_WEBHOOKS);
  const emails = parseEmails(opts.emails ?? env.EMAIL_USER_ADDRESSES);
  const emailWebhook = opts.emailWebhook ?? env.EMAIL_WEBHOOK_URL;
  if (!opts.sendMail && Object.keys(emails).length > 0 && !isEmailWebhook(emailWebhook, env)) {
    (opts.warn ?? console.warn)(EMAIL_WEBHOOK_WARNING);
  }
  // A typo in a Slack link would otherwise silently mean "no Slack" for that person (#104 review).
  if (Object.keys(webhooks).length < rawEntryCount(opts.slackWebhooks ?? env.SLACK_USER_WEBHOOKS)) (opts.warn ?? console.warn)(SLACK_WEBHOOK_WARNING);
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const sendMail: SendMail = opts.sendMail ?? (async (msg, init) => {
    if (!isEmailWebhook(emailWebhook, env)) return false;
    try {
      // redirect: 'error', so an allowed host can't bounce alert text on to another one (evaluator G-07, #65).
      const res = await doFetch(emailWebhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg), signal: init.signal, redirect: 'error' });
      return res.ok;
    } catch {
      return false;
    }
  });
  const toSlack = async (userId: string, items: Delivery[], isDigest: boolean) => {
    const url = webhooks[userId];
    if (!url) return false;
    try {
      const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: slackText(items, isDigest), unfurl_links: false, unfurl_media: false }), signal: AbortSignal.timeout(CHANNEL_TIMEOUT_MS), redirect: 'error' });
      return res.ok;
    } catch {
      return false;
    }
  };
  const toEmail = async (userId: string, items: Delivery[], isDigest: boolean) => {
    const to = emails[userId];
    if (!to) return false;
    try {
      return await sendMail({
        to,
        subject: emailSubject(items, isDigest),
        text: emailText(items, isDigest),
        html: emailHtml(items, isDigest),
      }, { signal: AbortSignal.timeout(CHANNEL_TIMEOUT_MS) });
    } catch {
      return false;
    }
  };
  return {
    async deliver(channel, userId, items, isDigest) {
      if (channel === 'inbox') return true;
      if (channel === 'slack') return toSlack(userId, items, isDigest);
      if (channel === 'email') return toEmail(userId, items, isDigest);
      // Both: delivered only when both accept it. A person without both their own Slack link and their own address
      // gets nothing, before either post, the same as Slack-only with no link; otherwise every retry would resend to
      // the half that works (#104 review). In a real outage of one half, each retry (up to MAX_ATTEMPTS, engine.ts)
      // sends to both again, so the half that works can get the alert up to that many times; a duplicate beats a missed P1.
      if (channel === 'slack_email') {
        if (!webhooks[userId] || !emails[userId]) return false;
        const [slack, email] = await Promise.all([toSlack(userId, items, isDigest), toEmail(userId, items, isDigest)]);
        return slack && email;
      }
      return false;
    },
  };
}

/** Only https://hooks.slack.com/services/... URLs are accepted. */
export function isSlackWebhook(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'hooks.slack.com' && url.pathname.startsWith('/services/') && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

export const SLACK_WEBHOOK_WARNING =
  'SLACK_USER_WEBHOOKS has entries that are not https://hooks.slack.com/services/... links; those people get no Slack messages until they are fixed.';

/** How many entries a raw per-user map has, before any are dropped as invalid. */
function rawEntryCount(raw: string | Record<string, unknown> | undefined): number {
  if (!raw) return 0;
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).length : 0;
  } catch {
    return 0;
  }
}

/**
 * Which of their own destinations a person has: a valid Slack link, and an address email can actually reach. Read
 * from the same settings as delivery, so the preferences page refuses a channel that would only ever fail (#104 review).
 */
export function destinationsFor(userId: string, env: Record<string, string | undefined> = process.env): { slack: boolean; email: boolean } {
  return {
    slack: userId in parseWebhooks(env.SLACK_USER_WEBHOOKS),
    email: userId in parseEmails(env.EMAIL_USER_ADDRESSES) && isEmailWebhook(env.EMAIL_WEBHOOK_URL, env),
  };
}

/** Keeps only valid per-user webhooks; anything malformed is dropped, so that user simply gets no Slack messages. */
export function parseWebhooks(raw: string | Record<string, unknown> | undefined): Record<string, string> {
  return parseUserMap(raw, isSlackWebhook);
}

/** One person's mailbox only. Newlines are refused so a title cannot inject extra headers. */
export function isUserEmail(value: unknown): value is string {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 254) return false;
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

/** The HTTPS hosts email alerts may go to (EMAIL_WEBHOOK_HOSTS, comma-separated, exact host names). Empty: none. */
export function emailWebhookHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.EMAIL_WEBHOOK_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
}

/**
 * An HTTPS catcher on a host listed in EMAIL_WEBHOOK_HOSTS, or http://127.0.0.1 / localhost in development. No
 * credentials in the URL. Any other HTTPS host is refused, the way Slack is pinned to hooks.slack.com (evaluator G-07, #65).
 */
export function isEmailWebhook(value: unknown, env: Record<string, string | undefined> = process.env): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return emailWebhookHosts(env).has(url.hostname.toLowerCase());
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    return url.protocol === 'http:' && local && env.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

/** Keeps only valid per-user addresses; anything malformed is dropped, so that user simply gets no email. */
export function parseEmails(raw: string | Record<string, unknown> | undefined): Record<string, string> {
  return parseUserMap(raw, isUserEmail);
}

function parseUserMap(raw: string | Record<string, unknown> | undefined, keep: (value: unknown) => value is string): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const valid: Record<string, string> = {};
  for (const [userId, value] of Object.entries(parsed)) if (keep(value)) valid[userId] = value;
  return valid;
}
