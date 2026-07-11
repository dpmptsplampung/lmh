// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '037_investasi_lead.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('I6 migration: 037_investasi_lead.sql', () => {
  const sql = readMigration();

  it('file exists and is non-empty', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment mentioning I6 / Funnel investor', () => {
    expect(sql).toMatch(/I6|Funnel investor/i);
    expect(sql).toMatch(/investasi_lead/i);
  });

  it('creates the investasi_lead table with all required columns', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+investasi_lead/i);
    expect(sql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(/doc_id\s+UUID\s+REFERENCES\s+investment_documents\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i);
    expect(sql).toMatch(/nama\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/email\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/instansi\s+TEXT/i);
    expect(sql).toMatch(/minat\s+TEXT/i);
    expect(sql).toMatch(/catatan\s+TEXT/i);
    expect(sql).toMatch(/status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'baru'/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
    expect(sql).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
  });

  it('has CHECK constraint for status enum', () => {
    expect(sql).toMatch(
      /status\s+IN\s*\(\s*'baru'\s*,\s*'dihubungi'\s*,\s*'berlanjut'\s*,\s*'ditolak'\s*,\s*'selesai'\s*\)/i,
    );
  });

  it('creates all required indexes', () => {
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_investasi_lead_status\s+ON\s+investasi_lead/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_investasi_lead_doc\s+ON\s+investasi_lead/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_investasi_lead_created_at\s+ON\s+investasi_lead/i);
  });

  it('attaches updated_at trigger reusing update_updated_at_column()', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_investasi_lead_updated\s+BEFORE\s+UPDATE\s+ON\s+investasi_lead\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+update_updated_at_column\(\)/i,
    );
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+update_updated_at_column/i);
  });

  it('attaches audit trigger on UPDATE using audit_change()', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_audit_investasi_lead_status\s+AFTER\s+UPDATE\s+OF\s+status\s+ON\s+investasi_lead\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+audit_change\('update_status'\)/i,
    );
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+audit_change/i);
  });

  it('attaches AFTER INSERT trigger for rate-limit logging', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trg_log_investasi_lead_insert\s+AFTER\s+INSERT\s+ON\s+investasi_lead\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+log_anon_action\('investasi_lead_insert'\)/i,
    );
  });

  it('enables RLS on investasi_lead', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+investasi_lead\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('defines lead_insert policy for authenticated INSERT with rate limit + petugas/admin exempt', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"investasi_lead_insert"\s+ON\s+investasi_lead\s+FOR\s+INSERT\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/check_anon_rate\s*\(\s*'investasi_lead_insert'\s*,\s*3\s*,\s*3600\s*\)/i);
    expect(sql).toMatch(/get_my_role\s*\(\s*\)\s*IN\s*\(\s*'petugas'\s*,\s*'admin'\s*\)/i);
  });

  it('defines lead_select policy for admin/petugas SELECT', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"investasi_lead_select_staff"\s+ON\s+investasi_lead\s+FOR\s+SELECT\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/get_my_role\s*\(\s*\)\s*IN\s*\(\s*'admin'\s*,\s*'petugas'\s*\)/i);
  });

  it('defines lead_update policy for admin-only UPDATE', () => {
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"investasi_lead_update_admin"\s+ON\s+investasi_lead\s+FOR\s+UPDATE\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/USING\s*\(\s*get_my_role\s*\(\s*\)\s*=\s*'admin'\s*\)/i);
    expect(sql).toMatch(/WITH\s+CHECK\s*\(\s*get_my_role\s*\(\s*\)\s*=\s*'admin'\s*\)/i);
  });

  it('includes a ROLLBACK section dropping all created objects', () => {
    expect(sql).toMatch(/--\s*ROLLBACK:/i);
    expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"investasi_lead_update_admin"\s+ON\s+investasi_lead/i);
    expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"investasi_lead_select_staff"\s+ON\s+investasi_lead/i);
    expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+"investasi_lead_insert"\s+ON\s+investasi_lead/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+investasi_lead/i);
  });

  it('does NOT drop update_updated_at_column or audit_change in ROLLBACK (owned by earlier migrations)', () => {
    const rollbackMatch = sql.match(/--\s*ROLLBACK:[\s\S]*$/i);
    expect(rollbackMatch).not.toBeNull();
    const rollback = rollbackMatch![0];
    expect(rollback).not.toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+update_updated_at_column/i);
    expect(rollback).not.toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+audit_change/i);
    expect(rollback).not.toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+log_anon_action/i);
  });

  it('does NOT alter the investment_documents table (read-only reference)', () => {
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+investment_documents/i);
    expect(sql).not.toMatch(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?investment_documents/i);
  });
});
