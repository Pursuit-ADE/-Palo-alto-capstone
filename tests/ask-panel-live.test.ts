// Screen readers hear the latest reply's sentence from one live region, not every turn in full (UX hour, Nov 2, R4).
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { spokenReply } from '../app/ask-flow';

vi.mock('../app/actions', () => ({ askCopilot: async () => null }));

describe('what a screen reader hears', () => {
  it('is the reply in one sentence, by kind', () => {
    expect(spokenReply({ kind: 'clarify', question: 'Which quarter do you mean?' })).toBe('Question: Which quarter do you mean?');
    expect(spokenReply({ kind: 'refused', message: 'Your session has ended.', signedOut: true })).toBe('Not answered: Your session has ended.');
    expect(spokenReply({ kind: 'unsupported', message: 'I answer three governed metrics.' })).toBe('Not answered: I answer three governed metrics.');
    expect(spokenReply({ kind: 'answer', narrative: 'Open pipeline is $402,420.' } as Parameters<typeof spokenReply>[0])).toBe('Open pipeline is $402,420.');
    expect(spokenReply(undefined)).toBe('');
  });

  it('comes from one status line; the turn list is no longer a live region', async () => {
    const { AskPanel } = await import('../app/ask-panel');
    const html = renderToStaticMarkup(createElement(AskPanel, { user: 'u_ts_west', name: 'Sam Rivera', examples: [] }));
    expect(html).toContain('<p class="visually-hidden" role="status"><span></span></p>');
    expect(html).toMatch(/<ol class="turns">/);
    expect(html.match(/aria-live|role="status"/g)).toEqual(['role="status"']);
  });

  it('keys the spoken text by turn, so a repeated reply is a new node and still read out', () => {
    const panel = readFileSync('app/ask-panel.tsx', 'utf8');
    expect(panel).toContain("<span key={pending ? 'pending' : lastId}>");
  });
});
