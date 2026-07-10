// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../supabase/migrations/024_umkm_magic_link.sql',
);

const readMigration = (): string => {
  try {
    return readFileSync(MIGRATION_PATH, 'utf-8');
  } catch {
    return '';
  }
};

describe('K5 migration: 024_umkm_magic_link.sql — file-level assertions', () => {
  const sql = readMigration();

  it('exists at the expected path', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment (Fase 0 / K5)', () => {
    expect(sql).toMatch(/Fase 0\s*\/\s*K5/i);
    expect(sql).toMatch(/magic.?link/i);
  });

  it('creates the umkm_listing_owner table', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+umkm_listing_owner/i);
  });

  it('defines UNIQUE(listing_id, email) constraint on umkm_listing_owner', () => {
    expect(sql).toMatch(/UNIQUE\s*\(\s*listing_id\s*,\s*email\s*\)/i);
  });

  it('creates an index on umkm_listing_owner(email)', () => {
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_umkm_owner_email\s+ON\s+umkm_listing_owner\s*\(\s*email\s*\)/i);
  });

  it('enables RLS on umkm_listing_owner', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+umkm_listing_owner\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('creates umkm_owner_select_own policy (owner self-select + admin)', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"umkm_owner_select_own"\s+ON\s+umkm_listing_owner/i);
    expect(sql).toMatch(/get_my_role\(\)\s*=\s*'admin'/i);
  });

  it('creates umkm_owner_admin_all policy (admin ALL)', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"umkm_owner_admin_all"\s+ON\s+umkm_listing_owner/i);
    expect(sql).toMatch(/FOR\s+ALL\s+TO\s+authenticated/i);
  });

  it('creates listing_umkm_update_own policy with owner EXISTS check', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"listing_umkm_update_own"\s+ON\s+listing_umkm/i);
    expect(sql).toMatch(/FOR\s+UPDATE\s+TO\s+authenticated/i);
    // owner EXISTS check references umkm_listing_owner + auth.users
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+umkm_listing_owner/i);
    expect(sql).toMatch(/auth\.users\s+WHERE\s+id\s*=\s*auth\.uid\(\)/i);
  });

  it('update policy WITH CHECK prevents owner from setting status=published', () => {
    expect(sql).toMatch(/status\s+NOT\s+IN\s*\(\s*'published'\s*\)\s+OR\s+get_my_role\(\)\s*=\s*'admin'/i);
  });

  it('creates listing_umkm_select_own policy for owners', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"listing_umkm_select_own"\s+ON\s+listing_umkm/i);
    expect(sql).toMatch(/FOR\s+SELECT\s+TO\s+authenticated/i);
  });

  it('backfills umkm_listing_owner from listing_umkm.kontak_email', () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+umkm_listing_owner\s*\(listing_id,\s*email\)/i);
    expect(sql).toMatch(/SELECT\s+id,\s*kontak_email\s+FROM\s+listing_umkm/i);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(listing_id,\s*email\)\s+DO\s+NOTHING/i);
  });

  it('does NOT drop the edit_token column', () => {
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE)\s+.*edit_token/i);
  });

  it('marks edit_token as deprecated via COMMENT', () => {
    expect(sql).toMatch(/COMMENT\s+ON\s+COLUMN\s+listing_umkm\.edit_token/i);
    expect(sql).toMatch(/DEPRECATED/i);
  });

  it('includes a ROLLBACK section', () => {
    expect(sql).toMatch(/ROLLBACK:/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+umkm_listing_owner/i);
  });
});
