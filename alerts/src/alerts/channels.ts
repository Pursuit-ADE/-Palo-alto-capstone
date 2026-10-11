// Delivery channels (L5). "inbox" is the in-app dev inbox: the delivery row itself is the message.
// "slack" posts to a webhook that belongs to that one user (a DM or private channel). There is no
// shared fallback channel: a user without their own webhook gets nothing on Slack, so an alert can
// never land where someone else can read it.
import type { alertDeliveries } from '../db/schema';

type Delivery = typeof alertDeliveries.$inferSelect;
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean }>;

export interface Channels {
  deliver(channel: string, userId: string, items: Delivery[], isDigest: boolean): Promise<boolean>;
}

/** Escapes Slack's control characters so event text can't become links, mentions or formatting. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slackText(items: Delivery[], isDigest: boolean): string {
  const lines = items.map((i) => `• *${slackEscape(i.title)}*\n${slackEscape(i.explanation)}\n<${i.link}|Ask the copilot>`);
  return (isDigest ? `Your alert digest (${items.length})\n\n` : '') + lines.join('\n\n');
}

export function createChannels(opts: { slackWebhooks?: Record<string, string>; fetch?: Fetch } = {}): Channels {
  const webhooks = opts.slackWebhooks ?? parseWebhooks(process.env.SLACK_USER_WEBHOOKS);
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  return {
    async deliver(channel, userId, items, isDigest) {
      if (channel === 'inbox') return true;
      if (channel === 'slack') {
        const url = webhooks[userId];
        if (!url || !url.startsWith('https://hooks.slack.com/')) return false;
        try {
          const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: slackText(items, isDigest) }) });
          return res.ok;
        } catch {
          return false;
        }
      }
      return false;
    },
  };
}

function parseWebhooks(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}
