// Where the copilot's "My alerts" link points: the alerts app's own address (ALERTS_URL). The two apps keep separate
// accounts and databases, so this is only a link; the person signs in to the alerts app on its own (Nov 1 review).

/** The alerts app's address when ALERTS_URL is a plain http(s) URL, or null to show no link. */
export function alertsLink(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Only a web address with no credentials in it: never javascript:, data: or a user:password@ host.
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
