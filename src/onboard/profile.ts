import fs from 'node:fs';
import path from 'node:path';
import { listCsvFiles, parseCsvFile } from './csv';
import { accountIdOf, DEMO_PERSON_IDS, hasIdCharacters, managerIdOf, PRODUCT_FIX, repIdOf } from '../db/seed';
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
 * The loader turns names into ids (accountIdOf, repIdOf, managerIdOf in src/db/seed.ts), and different names can make
 * the same id: "Alpha Inc" and "Alpha-Inc" both become acc_alpha_inc. Literal-name uniqueness does not catch that, so
 * the load would fail on a duplicate key after the folder had been confirmed. Reps, managers and the demo people share
 * one users table, so their ids are checked together. Reports the names as they are written in the files.
 */
function checkGeneratedIds(accountNames: string[], agentNames: string[], managerNames: string[], add: (problem: string) => void) {
  const distinct = (names: string[]) => [...new Set(names.filter((n) => n.trim() !== ''))];
  const accounts = distinct(accountNames);
  const reps = distinct(agentNames);
  const managers = distinct(managerNames);
  const noCharacters = (label: string, names: string[]) => {
    for (const name of names.filter((n) => !hasIdCharacters(n))) add(`${label} "${name}" has no letters or digits, so it can't become an id.`);
  };
  noCharacters('accounts.csv account', accounts);
  noCharacters('sales_teams.csv sales_agent', reps);
  noCharacters('sales_teams.csv manager', managers);
  for (const [id, who] of idClaims(accounts, reps, managers)) {
    const names = [...who].join(' and ');
    if (DEMO_PERSON_IDS.includes(id)) add(`${names} would take the id ${id}, which belongs to a demo person. Rename it.`);
    else if (who.size > 1) add(`${names} ${who.size === 2 ? 'both' : 'all'} become the id ${id}. Rename one of them.`);
  }
}

/** Which names want each id: the account ids, then the rep and manager ids, which share one users table. */
function idClaims(accounts: string[], reps: string[], managers: string[]): Map<string, Set<string>> {
  const claims = new Map<string, Set<string>>();
  const claim = (kind: string, names: string[], idOf: (name: string) => string) => {
    for (const name of names.filter(hasIdCharacters)) claims.set(idOf(name), (claims.get(idOf(name)) ?? new Set<string>()).add(`${kind} "${name}"`));
  };
  claim('account', accounts, accountIdOf);
  claim('rep', reps, repIdOf);
  claim('manager', managers, managerIdOf);
  return claims;
}

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
  checkGeneratedIds(accounts.map((a) => a.account ?? ''), teams.map((t) => t.sales_agent ?? ''), teams.map((t) => t.manager ?? ''), add);
  // The two demo technical sellers support an East team and a West team.
  for (const region of ['East', 'West']) {
    if (!teams.some((t) => t.regional_office === region)) add(`sales_teams.csv needs at least one ${region} team for the demo technical sellers.`);
  }
  // Amounts must be plausible (F9): one mistyped or planted value would otherwise move every governed number.
  // The ceiling is generous: 100 times the most expensive product.
  const topPrice = Math.max(0, ...products.map((p) => Number(p.sales_price)).filter((n) => Number.isFinite(n)));
  const maxValue = topPrice * 100;
  deals.forEach((d, i) => {
    const row = `sales_pipeline.csv row ${i + 2}`;
    if (!d.opportunity_id?.trim()) add(`${row}: opportunity_id is blank.`);
    if (!agents.has(d.sales_agent ?? '')) add(`${row}: sales_agent ${d.sales_agent || '(blank)'} is not in sales_teams.csv.`);
    if (!productNames.has(PRODUCT_FIX[d.product ?? ''] ?? d.product ?? '')) add(`${row}: product ${d.product || '(blank)'} is not in products.csv.`);
    if (d.account && !accountNames.has(d.account)) add(`${row}: account ${d.account} is not in accounts.csv.`);
    if (!STAGES.includes(d.deal_stage ?? '')) add(`${row}: deal_stage must be Prospecting, Engaging, Won or Lost.`);
    for (const col of ['engage_date', 'close_date'] as const) if (d[col] && !isDate(d[col]!)) add(`${row}: ${col} is not a YYYY-MM-DD date.`);
    if (d.close_value && !isNumber(d.close_value)) add(`${row}: close_value is not a number.`);
    else if (d.close_value && Number(d.close_value) < 0) add(`${row}: close_value can't be negative.`);
    else if (d.close_value && topPrice > 0 && Number(d.close_value) > maxValue) {
      add(`${row}: close_value ${d.close_value} is more than 100 times the most expensive product (${topPrice}); check it.`);
    }
  });
  return problems;
}
