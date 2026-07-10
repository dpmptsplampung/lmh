// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '029_visit_spine.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('I1.a migration: 029_visit_spine.sql', () => {
  const sql = readMigration();

  it('file exists and is non-empty', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment', () => {
    expect(sql).toMatch(/Fase 1\s*\/\s*I1\.a/i);
    expect(sql).toMatch(/Visit Spine/i);
    expect(sql).toMatch(/no UI switch/i);
  });

  // --- Table ---
  it('creates the visit table with all required columns', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+visit/i);
    expect(sql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(/asal\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/pengunjung_id\s+UUID\s+REFERENCES\s+pengunjung\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i);
    expect(sql).toMatch(/nama\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/asal_instansi\s+TEXT/i);
    expect(sql).toMatch(/layanan_id\s+UUID\s+REFERENCES\s+layanan\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/tujuan\s+TEXT/i);
    expect(sql).toMatch(/nama_yang_ditemui\s+TEXT/i);
    expect(sql).toMatch(/keperluan\s+TEXT/i);
    expect(sql).toMatch(/qr_token\s+TEXT\s+UNIQUE/i);
    expect(sql).toMatch(/status\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/tanggal_rencana\s+DATE/i);
    expect(sql).toMatch(/jam_rencana\s+TIME/i);
    expect(sql).toMatch(/waktu_masuk\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/waktu_scan\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/waktu_mulai_layan\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/waktu_selesai\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/diarahkan_ke\s+TEXT/i);
    expect(sql).toMatch(/catatan_petugas\s+TEXT/i);
    expect(sql).toMatch(/sumber_id\s+UUID/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
    expect(sql).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
  });

  it('has CHECK constraint for asal enum', () => {
    expect(sql).toMatch(/CHECK\s*\(\s*asal\s+IN\s*\(\s*'walk_in'\s*,\s*'reservasi'\s*\)\s*\)/i);
  });

  it('has CHECK constraint for status enum including no_show', () => {
    expect(sql).toMatch(
      /CHECK\s*\(\s*status\s+IN\s*\(\s*'terjadwal'\s*,\s*'menunggu'\s*,\s*'dilayani'\s*,\s*'selesai'\s*,\s*'batal'\s*,\s*'no_show'\s*\)\s*\)/i,
    );
  });

  it('has default status menunggu', () => {
    expect(sql).toMatch(/DEFAULT\s+'menunggu'/i);
  });

  it('creates all required indexes', () => {
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_visit_layanan_status\s+ON\s+visit/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_visit_tanggal\s+ON\s+visit/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_visit_qr\s+ON\s+visit/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_visit_pengunjung\s+ON\s+visit/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_visit_asal\s+ON\s+visit/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_visit_sumber\s+ON\s+visit/i);
  });

  // --- updated_at trigger (reuse existing function) ---
  it('attaches trg_visit_updated trigger reusing update_updated_at_column()', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_visit_updated\s+BEFORE\s+UPDATE\s+ON\s+visit\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+update_updated_at_column\(\)/i,
    );
    // Must NOT re-create the function (it belongs to migration 016)
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+update_updated_at_column/i);
  });

  // --- RLS ---
  it('enables RLS on visit', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+visit\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('defines visit_insert_walk_in policy with rate limit', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"visit_insert_walk_in"\s+ON\s+visit\s+FOR\s+INSERT\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/asal\s*=\s*'walk_in'/i);
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'visit_insert_walk_in'\s*,\s*5\s*,\s*60\s*\)/i);
  });

  it('defines visit_insert_reservasi policy with ownership check', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"visit_insert_reservasi"\s+ON\s+visit\s+FOR\s+INSERT\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/asal\s*=\s*'reservasi'/i);
    expect(sql).toMatch(/pengunjung_id\s+IN\s*\(\s*SELECT\s+id\s+FROM\s+pengunjung\s+WHERE\s+auth_user_id\s*=\s*auth\.uid\s*\(\s*\)\s*\)/i);
  });

  it('defines visit_select_own policy', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"visit_select_own"\s+ON\s+visit\s+FOR\s+SELECT\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/get_my_layanan_id\s*\(\s*\)/i);
    expect(sql).toMatch(/get_my_role\s*\(\s*\)\s*=\s*'admin'/i);
  });

  it('defines visit_update_own policy with USING + WITH CHECK', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"visit_update_own"\s+ON\s+visit\s+FOR\s+UPDATE\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/USING\s*\(/i);
    expect(sql).toMatch(/WITH\s+CHECK\s*\(/i);
  });

  // --- Dual-write: kunjungan → visit ---
  it('defines sync_kunjungan_to_visit() SECURITY DEFINER function', () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+sync_kunjungan_to_visit\s*\(\s*\)\s+RETURNS\s+TRIGGER\s+LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER/i,
    );
    expect(sql).toMatch(/INSERT\s+INTO\s+visit/i);
    expect(sql).toMatch(/'walk_in'/i);
    // Idempotency guard
    expect(sql).toMatch(/WHERE\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+visit\s+WHERE\s+sumber_id\s*=\s*NEW\.id\s+AND\s+asal\s*=\s*'walk_in'\s*\)/i);
  });

  it('attaches trg_kunjungan_to_visit AFTER INSERT', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_kunjungan_to_visit\s+AFTER\s+INSERT\s+ON\s+kunjungan\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+sync_kunjungan_to_visit\(\)/i,
    );
  });

  it('defines sync_kunjungan_update_to_visit() for status sync', () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+sync_kunjungan_update_to_visit\s*\(\s*\)\s+RETURNS\s+TRIGGER\s+LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER/i,
    );
    expect(sql).toMatch(/UPDATE\s+visit\s+SET/i);
    expect(sql).toMatch(/WHERE\s+sumber_id\s*=\s*NEW\.id\s+AND\s+asal\s*=\s*'walk_in'/i);
  });

  it('attaches trg_kunjungan_update_to_visit AFTER UPDATE', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_kunjungan_update_to_visit\s+AFTER\s+UPDATE\s+ON\s+kunjungan\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+sync_kunjungan_update_to_visit\(\)/i,
    );
  });

  it('generates qr_token for walk_in (kunjungan has no qr_token column)', () => {
    // In sync_kunjungan_to_visit function body
    expect(sql).toMatch(/COALESCE\s*\(\s*NEW\.qr_token\s*,\s*encode\s*\(\s*gen_random_bytes\s*\(\s*16\s*\)\s*,\s*'hex'\s*\)\s*\)/i);
  });

  // --- Dual-write: reservasi → visit ---
  it('defines sync_reservasi_to_visit() SECURITY DEFINER function with ON CONFLICT', () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+sync_reservasi_to_visit\s*\(\s*\)\s+RETURNS\s+TRIGGER\s+LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER/i,
    );
    expect(sql).toMatch(/'reservasi'/i);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*qr_token\s*\)\s+DO\s+UPDATE/i);
    expect(sql).toMatch(/EXCLUDED\.status/i);
    expect(sql).toMatch(/EXCLUDED\.waktu_scan/i);
  });

  it('uses COALESCE fallback for nama in reservasi trigger', () => {
    // Risk mitigation: pengunjung terhapus → subquery NULL → violates NOT NULL
    expect(sql).toMatch(
      /COALESCE\s*\(\s*\(\s*SELECT\s+nama\s+FROM\s+pengunjung\s+WHERE\s+id\s*=\s*NEW\.pengunjung_id\s*\)\s*,\s*'Pengunjung'\s*\)/i,
    );
  });

  it('maps reservasi status lifecycle to visit status', () => {
    expect(sql).toMatch(/WHEN\s+'terjadwal'\s+THEN\s+'terjadwal'/i);
    expect(sql).toMatch(/WHEN\s+'hadir'\s+THEN\s+'menunggu'/i);
    expect(sql).toMatch(/WHEN\s+'dilayani'\s+THEN\s+'dilayani'/i);
    expect(sql).toMatch(/WHEN\s+'selesai'\s+THEN\s+'selesai'/i);
    expect(sql).toMatch(/WHEN\s+'batal'\s+THEN\s+'batal'/i);
  });

  it('attaches trg_reservasi_to_visit AFTER INSERT OR UPDATE', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_reservasi_to_visit\s+AFTER\s+INSERT\s+OR\s+UPDATE\s+ON\s+reservasi\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+sync_reservasi_to_visit\(\)/i,
    );
  });

  // --- Backfill ---
  it('backfills from kunjungan idempotently', () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+visit[\s\S]*?FROM\s+kunjungan\s+k/i);
    expect(sql).toMatch(
      /WHERE\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+visit\s+WHERE\s+sumber_id\s*=\s*k\.id\s+AND\s+asal\s*=\s*'walk_in'\s*\)/i,
    );
  });

  it('backfills from reservasi idempotently with COALESCE for nama', () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+visit[\s\S]*?FROM\s+reservasi\s+r/i);
    expect(sql).toMatch(
      /WHERE\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+visit\s+WHERE\s+sumber_id\s*=\s*r\.id\s+AND\s+asal\s*=\s*'reservasi'\s*\)/i,
    );
    expect(sql).toMatch(
      /COALESCE\s*\(\s*\(\s*SELECT\s+nama\s+FROM\s+pengunjung\s+WHERE\s+id\s*=\s*r\.pengunjung_id\s*\)\s*,\s*'Pengunjung'\s*\)/i,
    );
  });

  // --- ROLLBACK ---
  it('includes a ROLLBACK section dropping all created objects', () => {
    expect(sql).toMatch(/--\s*ROLLBACK:/i);
    // Triggers
    expect(sql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_reservasi_to_visit\s+ON\s+reservasi/i);
    expect(sql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_kunjungan_update_to_visit\s+ON\s+kunjungan/i);
    expect(sql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_kunjungan_to_visit\s+ON\s+kunjungan/i);
    expect(sql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_visit_updated\s+ON\s+visit/i);
    // Functions (but NOT update_updated_at_column)
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+sync_reservasi_to_visit\(\)/i);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+sync_kunjungan_update_to_visit\(\)/i);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+sync_kunjungan_to_visit\(\)/i);
    // Table
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+visit/i);
  });

  it('does NOT drop update_updated_at_column in ROLLBACK (owned by migration 016)', () => {
    // Extract ROLLBACK section
    const rollbackMatch = sql.match(/--\s*ROLLBACK:[\s\S]*$/i);
    expect(rollbackMatch).not.toBeNull();
    const rollback = rollbackMatch![0];
    expect(rollback).not.toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+update_updated_at_column/i);
  });

  // --- Discipline: no UI/mutation of source tables ---
  it('does NOT mutate kunjungan or reservasi tables (triggers only add to visit)', () => {
    // The sync functions should INSERT/UPDATE visit, not the source tables
    // Look for any ALTER TABLE on kunjungan/reservasi (would be schema change)
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+kunjungan/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+reservasi/i);
    expect(sql).not.toMatch(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?kunjungan/i);
    expect(sql).not.toMatch(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?reservasi/i);
  });
});
