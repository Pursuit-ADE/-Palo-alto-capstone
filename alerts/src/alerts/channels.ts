// Delivery channels (L5). "inbox" is the in-app dev inbox: the delivery row itself is the message.
// "slack" posts to a webhook that belongs to that one user (a DM or private channel). "email" posts
// to a webhook with that user's own address as the only recipient. There is no shared fallback:
// a user without their own Slack webhook or email address gets nothing on that channel, so an
// alert can never land where someone else can read it.
import type { alertDeliveries } from '../db/schema';

type Delivery = typeof alertDeliveries.$inferSelect;
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean }>;

export type MailMessage = { to: string; subject: string; text: string; html: string };
export type SendMail = (msg: MailMessage, init: { signal?: AbortSignal }) => Promise<boolean>;

/** Slack calls give up after this long, so a hung request can't hold an alert claim open. */
export const CHANNEL_TIMEOUT_MS = 10_000;

export interface Channels {
  deliver(channel: string, userId: string, items: Delivery[], isDigest: boolean): Promise<boolean>;
}

/**
 * Makes event text safe to show in Slack. Escaping stops angle-bracket links and mentions. Slack also turns
 * bare URLs and domain names into links, so those are defanged ("https[:]//evil[.]example"): readable, but not
 * clickable. Only the copilot link we build ourselves is a real link. Slack has no escape for its formatting
 * characters, so *, _, ~ and ` in event text become look-alikes (∗ ＿ ∼ ˋ) and can't bold, strike or hide text.
 */
export function slackEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\b([a-z][a-z0-9+.-]*):\/\//gi, '$1[:]//')
    .replace(/\b([a-z0-9-]+)\.(?=[a-z])/gi, '$1[.]')
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
  return raw.replace(/[\r\n\0]+/g, ' ').trim().slice(0, 200);
}

export function emailText(items: Delivery[], isDigest: boolean): string {
  const lines = items.map((i) => `${i.title}\n${i.explanation}\nAsk the copilot: ${i.link}`);
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
    return `<p><b>${emailEscape(i.title)}</b><br>${emailEscape(i.explanation)}<br>${ask}</p>`;
  });
  return heading + blocks.join('');
}

export function createChannels(opts: {
  slackWebhooks?: Record<string, unknown>;
  emails?: string | Record<string, unknown>;
  emailWebhook?: string;
  fetch?: Fetch;
  sendMail?: SendMail;
} = {}): Channels {
  // Validated once at startup, whether passed in or read from the environment.
  const webhooks = parseWebhooks(opts.slackWebhooks ?? process.env.SLACK_USER_WEBHOOKS);
  const emails = parseEmails(opts.emails ?? process.env.EMAIL_USER_ADDRESSES);
  const emailWebhook = opts.emailWebhook ?? process.env.EMAIL_WEBHOOK_URL;
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const sendMail: SendMail = opts.sendMail ?? (async (msg, init) => {
    if (!isEmailWebhook(emailWebhook)) return false;
    try {
      const res = await doFetch(emailWebhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg), signal: init.signal });
      return res.ok;
    } catch {
      return false;
    }
  });
  return {
    async deliver(channel, userId, items, isDigest) {
      if (channel === 'inbox') return true;
      if (channel === 'slack') {
        const url = webhooks[userId];
        if (!url) return false;
        try {
          const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: slackText(items, isDigest), unfurl_links: false, unfurl_media: false }), signal: AbortSignal.timeout(CHANNEL_TIMEOUT_MS) });
          return res.ok;
        } catch {
          return false;
        }
      }
      if (channel === 'email') {
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

/** Keeps only valid per-user webhooks; anything malformed is dropped, so that user simply gets no Slack messages. */
export function parseWebhooks(raw: string | Record<string, unknown> | undefined): Record<string, string> {
  return parseUserMap(raw, isSlackWebhook);
}

/** One person's mailbox only. Newlines are refused so a title cannot inject extra headers. */
export function isUserEmail(value: unknown): value is string {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value) || value.length > 254) return false;
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value);
}

/** HTTPS catcher, or http://127.0.0.1 / localhost for a laptop Mailpit-style receiver. No credentials in the URL. */
export function isEmailWebhook(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    return url.protocol === 'http:' && local;
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
