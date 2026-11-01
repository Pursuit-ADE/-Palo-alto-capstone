// Every alert rule's "Ask the copilot" link pre-fills a fixed question (bug hunt, Oct 31: low_usage opened an empty box).
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { promptFor } from '@/server/prompts';

it('every alert rule has a copilot prompt', () => {
  const dir = path.join(process.cwd(), 'alerts/rules');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const { id } = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { id: string };
    expect(promptFor(id), id).not.toBe('');
  }
});
