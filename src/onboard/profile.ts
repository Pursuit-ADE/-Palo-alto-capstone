import fs from 'node:fs';
import path from 'node:path';
import { listCsvFiles, parseCsvFile } from './csv';
import { PRODUCT_FIX } from '../db/seed';
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
  const shapeOk = missingFiles.length === 0 && Object.keys(missingColumns).length === 0;
  const problems = shapeOk ? checkValues(dir) : [];
  return {
    datasetDir: dir,
    files,
    missingFiles,
    missingColumns,
    problems,
    mavenShaped: shapeOk && problems.length === 0,
  };
}

const REGION_NAMES = ['Central', 'East', 'West'];
const STAGES = ['Prospecting', 'Engaging', 'Won', 'Lost'];
const isNumber = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Checks the values the seed loader depends on, so a folder that passes here also loads. Reports at most
 * 20 problems; one is enough to block confirmation.
 */
function checkValues(dir: string): string[] {
  const read = (name: string) => parseCsvFile(path.join(dir, `${name}.csv`)).rows;
  const accounts = read('accounts');
  const products = read('products');
  const teams = read('sales_teams');
  const deals = read('sales_pipeline');
  const problems: string[] = [];
  const add = (p: string) => {
    if (problems.length < 20) problems.push(p);
  };
  for (const [name, rows] of [['accounts', accounts], ['products', products], ['sales_teams', teams], ['sales_pipeline', deals]] as const) {
    if (rows.length === 0) add(`${name}.csv has no rows.`);
  }
  const unique = (name: string, values: string[]) => {
    const seen = new Set<string>();
    for (const v of values) {
      if (seen.has(v)) add(`${name} has a duplicate: ${v}.`);
      seen.add(v);
    }
    return seen;
  };
  accounts.forEach((a, i) => {
    if (!a.account?.trim()) add(`accounts.csv row ${i + 2}: account is blank.`);
    if (!a.sector?.trim()) add(`accounts.csv row ${i + 2}: sector is blank.`);
    for (const col of ['year_established', 'revenue', 'employees'] as const) if (a[col] && !isNumber(a[col]!)) add(`accounts.csv row ${i + 2}: ${col} is not a number.`);
  });
  products.forEach((p, i) => {
    if (!p.product?.trim()) add(`products.csv row ${i + 2}: product is blank.`);
    if (!p.series?.trim()) add(`products.csv row ${i + 2}: series is blank.`);
    if (!isNumber(p.sales_price ?? '')) add(`products.csv row ${i + 2}: sales_price is not a number.`);
  });
  teams.forEach((t, i) => {
    if (!t.sales_agent?.trim() || !t.manager?.trim()) add(`sales_teams.csv row ${i + 2}: sales_agent and manager are required.`);
    if (!REGION_NAMES.includes(t.regional_office ?? '')) add(`sales_teams.csv row ${i + 2}: regional_office must be Central, East or West.`);
  });
  const accountNames = unique('accounts.csv account', accounts.map((a) => a.account ?? ''));
  const productNames = unique('products.csv product', products.map((p) => p.product ?? ''));
  const agents = unique('sales_teams.csv sales_agent', teams.map((t) => t.sales_agent ?? ''));
  unique('sales_pipeline.csv opportunity_id', deals.map((d) => d.opportunity_id ?? ''));
  // The two demo technical sellers support an East team and a West team.
  for (const region of ['East', 'West']) {
    if (!teams.some((t) => t.regional_office === region)) add(`sales_teams.csv needs at least one ${region} team for the demo technical sellers.`);
  }
  deals.forEach((d, i) => {
    const row = `sales_pipeline.csv row ${i + 2}`;
    if (!d.opportunity_id?.trim()) add(`${row}: opportunity_id is blank.`);
    if (!agents.has(d.sales_agent ?? '')) add(`${row}: sales_agent ${d.sales_agent || '(blank)'} is not in sales_teams.csv.`);
    if (!productNames.has(PRODUCT_FIX[d.product ?? ''] ?? d.product ?? '')) add(`${row}: product ${d.product || '(blank)'} is not in products.csv.`);
    if (d.account && !accountNames.has(d.account)) add(`${row}: account ${d.account} is not in accounts.csv.`);
    if (!STAGES.includes(d.deal_stage ?? '')) add(`${row}: deal_stage must be Prospecting, Engaging, Won or Lost.`);
    for (const col of ['engage_date', 'close_date'] as const) if (d[col] && !isDate(d[col]!)) add(`${row}: ${col} is not a YYYY-MM-DD date.`);
    if (d.close_value && !isNumber(d.close_value)) add(`${row}: close_value is not a number.`);
  });
  return problems;
}
