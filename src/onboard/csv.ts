import fs from 'node:fs';
import path from 'node:path';

export function parseCsvFile(file: string): { headers: string[]; rows: Record<string, string>[] } {
  const text = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ''));
  if (!header) return { headers: [], rows: [] };
  return {
    headers: header,
    rows: body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))),
  };
}

export function listCsvFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.csv'))
    .sort()
    .map((f) => path.join(dir, f));
}
