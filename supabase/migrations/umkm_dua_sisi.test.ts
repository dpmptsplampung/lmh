// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '038_umkm_dua_sisi.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('I7 migration: 038_umkm_dua_sisi.sql', () => {
  const sql = readMigration();

  it('file exists and is non-empty', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('references Inovasi #7 / dua sisi in the header', () => {
    expect(sql).toMatch(/Inovasi\s*#7/i);
    expect(sql).toMatch(/dua\s*sisi/i);
  });

  // --- listing_umkm.sisi column ---
  it('adds sisi column to listing_umkm with CHECK constraint', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+listing_umkm\s+ADD\s+COLUMN\s+sisi\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'kebutuhan'/i);
    expect(sql).toMatch(/CHECK\s*\(\s*sisi\s+IN\s*\(\s*'kebutuhan'\s*,\s*'penawaran'\s*\)\s*\)/i);
  });

  it('documents the two-sided model via COMMENT on listing_umkm.sisi', () => {
    expect(sql).toMatch(/COMMENT\s+ON\s+COLUMN\s+listing_umkm\.sisi/i);
    expect(sql).toMatch(/kebutuhan/i);
    expect(sql).toMatch(/penawaran/i);
  });

  // --- umkm_inquiry table ---
  it('creates umkm_inquiry table with required columns', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+umkm_inquiry/i);
    expect(sql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY\s+DEFAULT\s+gen_random_uuid\(\)/i);
    expect(sql).toMatch(/listing_id\s+UUID\s+REFERENCES\s+listing_umkm\(id\)\s+ON\s+DELETE\s+CASCADE/i);
    expect(sql).toMatch(/from_email\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/from_nama\s+TEXT/i);
    expect(sql).toMatch(/pesan\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'pending'/i);
    expect(sql).toMatch(/CHECK\s*\(\s*status\s+IN\s*\(\s*'pending'\s*,\s*'approved'\s*,\s*'rejected'\s*\)\s*\)/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
    expect(sql).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
  });

  it('creates indexes on umkm_inquiry', () => {
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_umkm_inquiry_listing\s+ON\s+umkm_inquiry/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_umkm_inquiry_status\s+ON\s+umkm_inquiry/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_umkm_inquiry_created_at\s+ON\s+umkm_inquiry/i);
  });

  it('attaches updated_at trigger reusing update_updated_at_column()', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_umkm_inquiry_updated\s+BEFORE\s+UPDATE\s+ON\s+umkm_inquiry\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+update_updated_at_column\(\)/i,
    );
  });

  // --- RLS ---
  it('enables RLS on umkm_inquiry', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+umkm_inquiry\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('defines umkm_inquiry_insert policy with rate limit + petugas/admin exempt', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"umkm_inquiry_insert"\s+ON\s+umkm_inquiry\s+FOR\s+INSERT\s+TO\s+authenticated/i);
    expect(sql).toMatch(/check_anon_rate\(\s*'umkm_inquiry'\s*,\s*5\s*,\s*3600\s*\)/i);
    expect(sql).toMatch(/get_my_role\(\)\s+IN\s*\(\s*'petugas'\s*,\s*'admin'\s*\)/i);
  });

  it('defines umkm_inquiry_select_owner policy with owner EXISTS + admin', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"umkm_inquiry_select_owner"\s+ON\s+umkm_inquiry\s+FOR\s+SELECT\s+TO\s+authenticated/i);
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+umkm_listing_owner/i);
    expect(sql).toMatch(/get_my_role\(\)\s*=\s*'admin'/i);
  });

  it('defines umkm_inquiry_update_owner policy for approve/reject', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"umkm_inquiry_update_owner"\s+ON\s+umkm_inquiry\s+FOR\s+UPDATE\s+TO\s+authenticated/i);
  });

  it('logs inserts via log_anon_action trigger (rate-limit accounting)', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_log_umkm_inquiry_insert\s+AFTER\s+INSERT\s+ON\s+umkm_inquiry\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+log_anon_action\(\s*'umkm_inquiry'\s*\)/i,
    );
  });

  // --- match view ---
  it('creates v_umkm_match view joining listing_umkm to itself with sisi filters', () => {
    expect(sql).toMatch(/CREATE\s+VIEW\s+v_umkm_match\s+AS/i);
    expect(sql).toMatch(/kebutuhan_id/i);
    expect(sql).toMatch(/penawaran_id/i);
    expect(sql).toMatch(/FROM\s+listing_umkm\s+k/i);
    expect(sql).toMatch(/JOIN\s+listing_umkm\s+p/i);
    expect(sql).toMatch(/p\.kategori_kebutuhan\s*=\s*k\.kategori_kebutuhan/i);
    expect(sql).toMatch(/p\.sisi\s*=\s*'penawaran'/i);
    expect(sql).toMatch(/k\.sisi\s*=\s*'kebutuhan'/i);
    expect(sql).toMatch(/p\.status\s*=\s*'published'/i);
    expect(sql).toMatch(/k\.status\s*=\s*'published'/i);
  });

  // --- ROLLBACK ---
  it('includes a ROLLBACK section dropping all created objects', () => {
    expect(sql).toMatch(/--\s*ROLLBACK:/i);
    expect(sql).toMatch(/DROP\s+VIEW\s+IF\s+EXISTS\s+v_umkm_match/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+umkm_inquiry/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+listing_umkm\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+sisi/i);
  });
});
