// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '030_skm.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('I3 migration: 030_skm.sql', () => {
  const sql = readMigration();

  it('file exists and is non-empty', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment', () => {
    expect(sql).toMatch(/Fase 2\s*\/\s*I3/i);
    expect(sql).toMatch(/SKM/i);
    expect(sql).toMatch(/PermenPANRB 14\/2017/i);
  });

  // --- Table ---
  it('creates the skm_respons table with all required columns', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+skm_respons/i);
    expect(sql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(/visit_id\s+UUID\s+REFERENCES\s+visit\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i);
    expect(sql).toMatch(/layanan_id\s+UUID\s+REFERENCES\s+layanan\(id\)/i);
    expect(sql).toMatch(/u1_persyaratan\s+SMALLINT/i);
    expect(sql).toMatch(/u2_prosedur\s+SMALLINT/i);
    expect(sql).toMatch(/u3_waktu\s+SMALLINT/i);
    expect(sql).toMatch(/u4_biaya\s+SMALLINT/i);
    expect(sql).toMatch(/u5_produk\s+SMALLINT/i);
    expect(sql).toMatch(/u6_kompetensi\s+SMALLINT/i);
    expect(sql).toMatch(/u7_perilaku\s+SMALLINT/i);
    expect(sql).toMatch(/u8_sarana\s+SMALLINT/i);
    expect(sql).toMatch(/u9_pengaduan\s+SMALLINT/i);
    expect(sql).toMatch(/saran\s+TEXT/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
  });

  it('has CHECK constraints (BETWEEN 1 AND 4) for all 9 unsur', () => {
    for (const col of [
      'u1_persyaratan', 'u2_prosedur', 'u3_waktu', 'u4_biaya', 'u5_produk',
      'u6_kompetensi', 'u7_perilaku', 'u8_sarana', 'u9_pengaduan',
    ]) {
      expect(sql).toMatch(
        new RegExp(`${col}\\s+SMALLINT\\s+CHECK\\s*\\(\\s*${col}\\s+BETWEEN\\s+1\\s+AND\\s+4\\s*\\)`, 'i'),
      );
    }
  });

  it('creates all required indexes', () => {
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_skm_layanan\s+ON\s+skm_respons/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_skm_visit\s+ON\s+skm_respons/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_skm_created\s+ON\s+skm_respons/i);
  });

  // --- RLS ---
  it('enables RLS on skm_respons', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+skm_respons\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('defines skm_insert policy for authenticated INSERT', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"skm_insert"\s+ON\s+skm_respons\s+FOR\s+INSERT\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i);
  });

  it('defines skm_select_staff policy with petugas/admin access', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"skm_select_staff"\s+ON\s+skm_respons\s+FOR\s+SELECT\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/get_my_layanan_id\s*\(\s*\)/i);
    expect(sql).toMatch(/get_my_role\s*\(\s*\)\s*=\s*'admin'/i);
  });

  // --- hitung_ikm function ---
  it('defines hitung_ikm function with correct signature', () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+hitung_ikm\s*\(\s*p_layanan_id\s+UUID\s*,\s*p_start\s+DATE\s*,\s*p_end\s+DATE\s*\)/i,
    );
    expect(sql).toMatch(/RETURNS\s+TABLE\s*\(\s*layanan_id\s+UUID\s*,\s*layanan_nama\s+TEXT\s*,\s*ikm\s+NUMERIC\s*,\s*responden\s+INT\s*\)/i);
    expect(sql).toMatch(/LANGUAGE\s+sql\s+SECURITY\s+DEFINER\s+STABLE/i);
  });

  it('aggregates 9 unsur in the IKM formula (sum / 9.0 * 25)', () => {
    // The formula must sum all 9 columns, divide by 9.0, then multiply by 25
    expect(sql).toMatch(/u1_persyaratan\s*\+\s*u2_prosedur\s*\+\s*u3_waktu\s*\+\s*u4_biaya\s*\+\s*u5_produk/i);
    expect(sql).toMatch(/u6_kompetensi\s*\+\s*u7_perilaku\s*\+\s*u8_sarana\s*\+\s*u9_pengaduan/i);
    expect(sql).toMatch(/\/\s*9\.0/i);
    expect(sql).toMatch(/\*\s*25\s+AS\s+ikm/i);
  });

  it('counts respondents in the responden column', () => {
    expect(sql).toMatch(/COUNT\s*\(\s*\*\s*\)::int\s+AS\s+responden/i);
  });

  it('filters by layanan_id and date range', () => {
    expect(sql).toMatch(/s\.layanan_id\s*=\s*p_layanan_id/i);
    expect(sql).toMatch(/s\.created_at::date\s+BETWEEN\s+p_start\s+AND\s+p_end/i);
  });

  it('grants EXECUTE to anon and authenticated for public transparency', () => {
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+hitung_ikm\s*\(\s*UUID\s*,\s*DATE\s*,\s*DATE\s*\)\s+TO\s+anon\s*,\s*authenticated/i);
  });

  // --- ROLLBACK ---
  it('includes a ROLLBACK section dropping all created objects', () => {
    expect(sql).toMatch(/--\s*ROLLBACK:/i);
    expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+hitung_ikm/i);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+hitung_ikm\s*\(\s*UUID\s*,\s*DATE\s*,\s*DATE\s*\)/i);
    expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"skm_select_staff"\s+ON\s+skm_respons/i);
    expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"skm_insert"\s+ON\s+skm_respons/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+skm_respons/i);
  });

  // --- Discipline: does not touch visit table or migration 029 ---
  it('does NOT alter or drop the visit table (read-only reference)', () => {
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+visit/i);
    expect(sql).not.toMatch(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?visit/i);
  });
});
