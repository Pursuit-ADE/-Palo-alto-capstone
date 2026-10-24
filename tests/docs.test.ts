// The handover data dictionary is generated from the registry; this fails if someone changed the registry and
// forgot to regenerate it (npm run docs:dictionary).
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { dictionaryMarkdown } from '@/registry/dictionary-doc';
import { loadRegistry } from '@/registry/load';

it('docs/DATA-DICTIONARY.md matches the registry', () => {
  const onDisk = fs.readFileSync(path.join(process.cwd(), 'docs', 'DATA-DICTIONARY.md'), 'utf8').replace(/\r\n/g, '\n');
  expect(onDisk).toBe(dictionaryMarkdown(loadRegistry()));
});
