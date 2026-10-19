// Delivery channels (L5). "inbox" is the in-app dev inbox: the delivery row itself is the message.
// "slack" posts to a webhook that belongs to that one user (a DM or private channel). There is no
// shared fallback channel: a user without their own webhook gets nothing on Slack, so an alert can
// never land where someone else can read it.
import type { alertDeliveries } from '../db/schema';

type Delivery = typeof alertDeliveries.$inferSelect;
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean }>;

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

export function createChannels(opts: { slackWebhooks?: Record<string, unknown>; fetch?: Fetch } = {}): Channels {
  // Validated once at startup, whether passed in or read from the environment.
  const webhooks = parseWebhooks(opts.slackWebhooks ?? process.env.SLACK_USER_WEBHOOKS);
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
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
  for (const [userId, webhook] of Object.entries(parsed)) if (isSlackWebhook(webhook)) valid[userId] = webhook;
  return valid;
}
