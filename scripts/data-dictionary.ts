// Writes docs/DATA-DICTIONARY.md from registry/. Run after any registry change.
import fs from 'node:fs';
import path from 'node:path';
import { dictionaryMarkdown } from '../src/registry/dictionary-doc';
import { loadRegistry } from '../src/registry/load';

const dest = path.join(process.cwd(), 'docs', 'DATA-DICTIONARY.md');
fs.writeFileSync(dest, dictionaryMarkdown(loadRegistry()));
console.log(`Wrote ${path.relative(process.cwd(), dest)}`);
