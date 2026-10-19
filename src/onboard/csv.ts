import fs from 'node:fs';
import path from 'node:path';

// Onboarding reads whole files into memory, so refuse anything far larger than a CRM export should be.
export const MAX_CSV_BYTES = 50 * 1024 * 1024;

export function parseCsvFile(file: string): { headers: string[]; rows: Record<string, string>[] } {
  // Size check and read use the same open file, so the file can't be swapped between the two (CodeQL
  // js/file-system-race).
  const fd = fs.openSync(file, 'r');
  let text: string;
  try {
    const size = fs.fstatSync(fd).size;
    if (size > MAX_CSV_BYTES) throw new Error(`${path.basename(file)} is ${Math.round(size / 1048576)} MB; the limit is ${MAX_CSV_BYTES / 1048576} MB.`);
    text = fs.readFileSync(fd, 'utf8').replace(/\r/g, '');
  } finally {
    fs.closeSync(fd);
  }
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
  // A quote that never closes would otherwise swallow the rest of the file silently.
  if (quoted) throw new Error(`${path.basename(file)} ends inside a quoted field; check for an unmatched quote.`);
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
