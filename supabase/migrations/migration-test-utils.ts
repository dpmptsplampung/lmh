import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export const BASELINE_FILES = [
  '202607140001_extensions_and_preflight.sql',
  '202607140002_core_schema.sql',
  '202607140003_feature_schema.sql',
  '202607140004_security_and_automation.sql',
  '202607140005_views_and_jobs.sql',
] as const;

export const FORWARD_MIGRATION_FILES = [
  '202607200001_p0_security_governance.sql',
  '202607210001_walkin_kontak_dan_layanan_perizinan.sql',
] as const;

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export function readBaseline(index: 0 | 1 | 2 | 3 | 4): string {
  return readFileSync(join(MIGRATIONS_DIR, BASELINE_FILES[index]), 'utf8');
}

export function readAllBaseline(): string {
  return BASELINE_FILES.map((_, index) => readBaseline(index as 0 | 1 | 2 | 3 | 4)).join('\n');
}

export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}
