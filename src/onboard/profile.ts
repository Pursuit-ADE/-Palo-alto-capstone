import fs from 'node:fs';
import path from 'node:path';
import { listCsvFiles, parseCsvFile } from './csv';
import { REQUIRED_CRM_FILES, type DatasetProfile } from './types';

/** Reads a folder of CSVs. Does not load them into the database and does not create metrics. */
export function profileDataset(datasetDir: string): DatasetProfile {
  const dir = path.resolve(datasetDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Dataset folder not found: ${dir}`);
  }
  const files = listCsvFiles(dir).map((file) => {
    const parsed = parseCsvFile(file);
    return { file: path.basename(file), rows: parsed.rows.length, columns: parsed.headers };
  });
  const byName = new Map(files.map((f) => [f.file.replace(/\.csv$/, ''), f]));
  const missingFiles: string[] = [];
  const missingColumns: Record<string, string[]> = {};
  for (const [name, required] of Object.entries(REQUIRED_CRM_FILES)) {
    const found = byName.get(name);
    if (!found) {
      missingFiles.push(`${name}.csv`);
      continue;
    }
    const absent = required.filter((col) => !found.columns.includes(col));
    if (absent.length) missingColumns[`${name}.csv`] = absent;
  }
  return {
    datasetDir: dir,
    files,
    missingFiles,
    missingColumns,
    mavenShaped: missingFiles.length === 0 && Object.keys(missingColumns).length === 0,
  };
}
