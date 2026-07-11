// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_036 = join(
  process.cwd(),
  'supabase',
  'migrations',
  '036_anon_rate_prune.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_036, 'utf8');
}

describe('Fase 0 / K3 follow-up: migration 036_anon_rate_prune.sql', () => {
  it('file exists and is non-empty', () => {
    const sql = readMigration();
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment referencing K3 follow-up', () => {
    const sql = readMigration();
    expect(sql).toMatch(/K3 follow-up/i);
    expect(sql).toMatch(/anon_rate_limit/i);
  });

  it('creates prune_anon_rate_limit() function', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+prune_anon_rate_limit\s*\(\s*\)/i,
    );
  });

  it('function returns void', () => {
    const sql = readMigration();
    expect(sql).toMatch(/RETURNS\s+void/i);
  });

  it('function is SECURITY DEFINER', () => {
    const sql = readMigration();
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
  });

  it('function deletes rows older than 7 days', () => {
    const sql = readMigration();
    expect(sql).toMatch(/DELETE\s+FROM\s+anon_rate_limit/i);
    expect(sql).toMatch(/created_at\s*<\s*now\s*\(\s*\)\s*-\s*INTERVAL\s*'7\s*days'/i);
  });

  it('schedules pg_cron job daily at 3am when pg_cron is installed', () => {
    const sql = readMigration();
    expect(sql).toMatch(/pg_extension/i);
    expect(sql).toMatch(/pg_cron/i);
    expect(sql).toMatch(/cron\.unschedule\s*\(\s*'prune_anon_rate_limit'\s*\)/i);
    expect(sql).toMatch(/cron\.schedule\s*\(\s*'prune_anon_rate_limit'\s*,\s*'0\s*3\s*\*\s*\*\s*\*'\s*,\s*'SELECT\s+prune_anon_rate_limit\s*\(\s*\)'\s*\)/i);
  });

  it('raises NOTICE when pg_cron is not installed (graceful)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/RAISE\s+NOTICE/i);
    expect(sql).toMatch(/pg_cron tidak terinstall/i);
  });

  it('has a ROLLBACK section that unschedules and drops the function', () => {
    const sql = readMigration();
    expect(sql).toMatch(/--\s*ROLLBACK/i);
    expect(sql).toMatch(/cron\.unschedule\s*\(\s*'prune_anon_rate_limit'\s*\)/i);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+prune_anon_rate_limit/i);
  });
});
