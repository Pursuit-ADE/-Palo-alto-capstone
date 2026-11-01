// The Claude request caches the fixed system prompt, so each question after the first pays cache-read prices for it.
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { loadRegistry } from '@/registry/load';
import { claudeModel } from '@/semantic/model';

describe('Claude request', () => {
  it('sends the system prompt as one cached block, the same whatever the question or the previous turn', async () => {
    const sent: { system?: unknown; messages?: unknown }[] = [];
    const parse = async (body: { system?: unknown; messages?: unknown }) => {
      sent.push(body);
      return { stop_reason: 'refusal', parsed_output: null };
    };
    // A stand-in with only the one method claudeModel calls; the real client needs credentials and the network.
    const client = { beta: { messages: { parse } } } as unknown as Anthropic;
    const model = claudeModel(client);
    const reg = loadRegistry();
    await model.propose('open pipeline', reg, '2027-03-31');
    await model.propose('and by stage for the east region?', reg, '2027-03-31', { metric: 'open_pipeline', filters: {}, groupBy: [] });
    const [first, second] = sent.map((b) => b.system);
    expect(first).toEqual([{ type: 'text', text: expect.any(String), cache_control: { type: 'ephemeral' } }]);
    // A byte change would miss the cache: the question and the previous intent go in the user message, never here.
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain('east region');
    expect(JSON.stringify(sent[1]?.messages)).toContain('east region');
  });
});
