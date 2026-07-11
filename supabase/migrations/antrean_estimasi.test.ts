// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '032_antrean_estimasi.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('Fase 2 / I2: migration 032_antrean_estimasi.sql', () => {
  it('file exists and is non-empty', () => {
    const sql = readMigration();
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment', () => {
    const sql = readMigration();
    expect(sql).toMatch(/Fase 2 \/ I2: Antrean pintar/i);
  });

  it('creates the mv_estimasi_layanan materialized view', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE\s+MATERIALIZED\s+VIEW\s+mv_estimasi_layanan/i);
  });

  it('computes avg duration per layanan per hour slot from selesai visits', () => {
    const sql = readMigration();
    expect(sql).toMatch(/EXTRACT\s*\(\s*HOUR\s+FROM\s+waktu_mulai_layan\s*\)/i);
    expect(sql).toMatch(/AVG\s*\(\s*EXTRACT\s*\(\s*EPOCH\s+FROM\s*\(\s*waktu_selesai\s*-\s*waktu_mulai_layan\s*\)\s*\)\s*\/\s*60\s*\)/i);
    expect(sql).toMatch(/status\s*=\s*'selesai'/i);
  });

  it('filters to last 14 days rolling window', () => {
    const sql = readMigration();
    expect(sql).toMatch(/waktu_mulai_layan\s*>\s*now\s*\(\s*\)\s*-\s*INTERVAL\s*'14 days'/i);
  });

  it('groups by layanan_id and jam_slot', () => {
    const sql = readMigration();
    expect(sql).toMatch(/GROUP\s+BY\s+layanan_id\s*,\s*jam_slot/i);
  });

  it('creates unique index on mv_estimasi_layanan for CONCURRENTLY refresh', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+idx_mv_estimasi_layanan_key\s+ON\s+mv_estimasi_layanan\s*\(\s*layanan_id\s*,\s*jam_slot\s*\)/i);
  });

  it('creates v_antrian_loket view joining layanan + visit + mv_estimasi_layanan', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+VIEW\s+v_antrian_loket/i);
    expect(sql).toMatch(/FROM\s+layanan\s+l/i);
    expect(sql).toMatch(/LEFT\s+JOIN\s+visit\s+v\s+ON\s+v\.layanan_id\s*=\s*l\.id/i);
    expect(sql).toMatch(/FROM\s+mv_estimasi_layanan\s+m/i);
  });

  it('filters layanan tipe konsultatif only in v_antrian_loket', () => {
    const sql = readMigration();
    expect(sql).toMatch(/l\.tipe\s*=\s*'konsultatif'/i);
  });

  it('counts menunggu and dilayani visits separately in v_antrian_loket', () => {
    const sql = readMigration();
    expect(sql).toMatch(/COUNT\s*\(\s*v\.id\s*\)\s*FILTER\s*\(\s*WHERE\s+v\.status\s*=\s*'menunggu'\s*\)/i);
    expect(sql).toMatch(/COUNT\s*\(\s*v\.id\s*\)\s*FILTER\s*\(\s*WHERE\s+v\.status\s*=\s*'dilayani'\s*\)/i);
  });

  it('defaults estimasi_durasi to 15 minutes via COALESCE when no history', () => {
    const sql = readMigration();
    expect(sql).toMatch(/COALESCE\s*\(/i);
    expect(sql).toMatch(/,\s*15\s*\)/i);
  });

  it('computes estimasi_tunggu_total as antre_count * avg_durasi', () => {
    const sql = readMigration();
    expect(sql).toMatch(/estimasi_tunggu_total_menit/i);
    expect(sql).toMatch(/\(\s*COUNT\s*\(\s*v\.id\s*\)\s*FILTER\s*\(\s*WHERE\s+v\.status\s*=\s*'menunggu'\s*\)\s*\)\s*\*\s*COALESCE/i);
  });

  it('GRANTs SELECT on v_antrian_loket to anon and authenticated', () => {
    const sql = readMigration();
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+v_antrian_loket\s+TO\s+anon\s*,\s*authenticated/i);
  });

  it('creates refresh_estimasi_layanan() function with CONCURRENTLY refresh', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+refresh_estimasi_layanan\s*\(\s*\)/i);
    expect(sql).toMatch(/REFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY\s+mv_estimasi_layanan/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
  });

  it('schedules pg_cron refresh in a DO block checking pg_extension', () => {
    const sql = readMigration();
    expect(sql).toMatch(/DO\s*\$\$/i);
    expect(sql).toMatch(/pg_extension\s+WHERE\s+extname\s*=\s*'pg_cron'/i);
    expect(sql).toMatch(/cron\.schedule\s*\(\s*'refresh_estimasi'/i);
    expect(sql).toMatch(/\*\/5\s+\*\s+\*\s+\*\s+\*/i);
  });

  it('has a ROLLBACK section', () => {
    const sql = readMigration();
    expect(sql).toMatch(/--\s*ROLLBACK/i);
    expect(sql).toMatch(/DROP\s+MATERIALIZED\s+VIEW\s+IF\s+EXISTS\s+mv_estimasi_layanan/i);
    expect(sql).toMatch(/DROP\s+VIEW\s+IF\s+EXISTS\s+v_antrian_loket/i);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+refresh_estimasi_layanan\s*\(\s*\)/i);
  });
});
