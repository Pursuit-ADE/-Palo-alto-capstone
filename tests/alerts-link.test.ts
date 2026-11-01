// The copilot's "My alerts" link (Nov 1): shown only for a plain web address, never for a script or a URL with credentials.
import { describe, expect, it } from 'vitest';
import { alertsLink } from '@/server/alerts-link';

describe('My alerts link', () => {
  it('links to the alerts app when ALERTS_URL is a web address', () => {
    expect(alertsLink('http://localhost:3001')).toBe('http://localhost:3001/');
    expect(alertsLink('https://alerts.example.test/inbox')).toBe('https://alerts.example.test/inbox');
  });

  it('shows no link when ALERTS_URL is unset, malformed, a script or carries credentials', () => {
    for (const raw of [undefined, '', 'not a url', 'javascript:alert(1)', 'data:text/html,hi', 'https://user:pass@alerts.example.test/']) {
      expect(alertsLink(raw)).toBeNull();
    }
  });
});
