// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_033 = join(
  process.cwd(),
  'supabase',
  'migrations',
  '033_notifikasi.sql',
);
const MIGRATION_034 = join(
  process.cwd(),
  'supabase',
  'migrations',
  '034_push_subscriptions.sql',
);

function readMigration(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('Fase 2 / I5: migration 033_notifikasi.sql', () => {
  it('file exists and is non-empty', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/Fase 2 \/ I5: Notifikasi omnichannel/i);
  });

  it('creates the notifikasi table with required columns', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/CREATE\s+TABLE\s+notifikasi/i);
    expect(sql).toMatch(/tujuan_user_id\s+UUID/i);
    expect(sql).toMatch(/tujuan_email\s+TEXT/i);
    expect(sql).toMatch(/kanal\s+TEXT/i);
    expect(sql).toMatch(/subjek\s+TEXT/i);
    expect(sql).toMatch(/body\s+TEXT/i);
    expect(sql).toMatch(/payload\s+JSONB/i);
    expect(sql).toMatch(/status\s+TEXT/i);
    expect(sql).toMatch(/retry_count\s+INT/i);
    expect(sql).toMatch(/error\s+TEXT/i);
    expect(sql).toMatch(/sent_at\s+TIMESTAMPTZ/i);
  });

  it('enforces kanal CHECK constraint (email, web_push)', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/kanal\s+IN\s*\(\s*'email'\s*,\s*'web_push'\s*\)/i);
  });

  it('enforces status CHECK constraint (pending, sent, failed, skipped)', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/status\s+IN\s*\(\s*'pending'\s*,\s*'sent'\s*,\s*'failed'\s*,\s*'skipped'\s*\)/i);
  });

  it('creates indexes on notifikasi (status, created_at) and (tujuan_user_id)', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_notifikasi_status\s+ON\s+notifikasi\s*\(\s*status\s*,\s*created_at\s*\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_notifikasi_tujuan\s+ON\s+notifikasi\s*\(\s*tujuan_user_id\s*\)/i);
  });

  it('enables RLS on notifikasi', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/ALTER\s+TABLE\s+notifikasi\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('creates notifikasi_select_own policy (own or admin)', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/notifikasi_select_own/i);
    expect(sql).toMatch(/tujuan_user_id\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/get_my_role\(\)\s*=\s*'admin'/i);
  });

  it('creates notifikasi_admin_all policy', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/notifikasi_admin_all/i);
  });

  it('creates queue_notifikasi() SECURITY DEFINER function', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+queue_notifikasi/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/p_tujuan_user_id/i);
    expect(sql).toMatch(/p_tujuan_email/i);
    expect(sql).toMatch(/p_kanal/i);
    expect(sql).toMatch(/p_subjek/i);
    expect(sql).toMatch(/p_body/i);
    expect(sql).toMatch(/p_payload/i);
  });

  it('creates notify_visit_selesai() trigger function that checks status=selesai transition', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+notify_visit_selesai/i);
    expect(sql).toMatch(/NEW\.status\s*=\s*'selesai'/i);
    expect(sql).toMatch(/OLD\.status\s*!=\s*'selesai'/i);
  });

  it('notify_visit_selesai queues SKM email with link containing qr_token', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/queue_notifikasi/i);
    expect(sql).toMatch(/\/skm\?token=/i);
    expect(sql).toMatch(/NEW\.qr_token/i);
    expect(sql).toMatch(/'email'/i);
  });

  it('creates trg_notify_visit_selesai AFTER UPDATE OF status ON visit', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_notify_visit_selesai/i);
    expect(sql).toMatch(/AFTER\s+UPDATE\s+OF\s+status\s+ON\s+visit/i);
  });

  it('creates notify_umkm_approved() trigger function that checks status=published transition', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+notify_umkm_approved/i);
    expect(sql).toMatch(/NEW\.status\s*=\s*'published'/i);
    expect(sql).toMatch(/OLD\.status\s*!=\s*'published'/i);
  });

  it('notify_umkm_approved emails owner from umkm_listing_owner and references nama_umkm', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/FROM\s+umkm_listing_owner\s+WHERE\s+listing_id\s*=\s*NEW\.id/i);
    expect(sql).toMatch(/NEW\.nama_umkm/i);
  });

  it('creates trg_notify_umkm_approved AFTER UPDATE OF status ON listing_umkm', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_notify_umkm_approved/i);
    expect(sql).toMatch(/AFTER\s+UPDATE\s+OF\s+status\s+ON\s+listing_umkm/i);
  });

  it('has a ROLLBACK section', () => {
    const sql = readMigration(MIGRATION_033);
    expect(sql).toMatch(/--\s*ROLLBACK/i);
    expect(sql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_notify_umkm_approved/i);
    expect(sql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_notify_visit_selesai/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+notifikasi/i);
  });
});

describe('Fase 2 / I5: migration 034_push_subscriptions.sql', () => {
  it('file exists and is non-empty', () => {
    const sql = readMigration(MIGRATION_034);
    expect(sql.length).toBeGreaterThan(0);
  });

  it('creates push_subscriptions table with required columns', () => {
    const sql = readMigration(MIGRATION_034);
    expect(sql).toMatch(/CREATE\s+TABLE\s+push_subscriptions/i);
    expect(sql).toMatch(/user_id\s+UUID\s+REFERENCES\s+auth\.users/i);
    expect(sql).toMatch(/endpoint\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/keys\s+JSONB\s+NOT\s+NULL/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ/i);
  });

  it('enables RLS on push_subscriptions', () => {
    const sql = readMigration(MIGRATION_034);
    expect(sql).toMatch(/ALTER\s+TABLE\s+push_subscriptions\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('creates self-scoped SELECT/INSERT/DELETE policies', () => {
    const sql = readMigration(MIGRATION_034);
    expect(sql).toMatch(/push_sub_self_select/i);
    expect(sql).toMatch(/push_sub_self_insert/i);
    expect(sql).toMatch(/push_sub_self_delete/i);
    expect(sql).toMatch(/user_id\s*=\s*auth\.uid\(\)/i);
  });

  it('has a ROLLBACK section', () => {
    const sql = readMigration(MIGRATION_034);
    expect(sql).toMatch(/--\s*ROLLBACK/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+push_subscriptions/i);
  });
});
