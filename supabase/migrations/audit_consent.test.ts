// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '028_audit_consent.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('I8 migration: 028_audit_consent.sql', () => {
  const sql = readMigration();

  it('file exists and is non-empty', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('has the required header comment', () => {
    expect(sql).toMatch(/Fase 1\s*\/\s*I8/i);
    expect(sql).toMatch(/audit_log/i);
  });

  it('creates the audit_log table with required columns', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+audit_log/i);
    expect(sql).toMatch(/actor_id\s+UUID/i);
    expect(sql).toMatch(/actor_role\s+TEXT/i);
    expect(sql).toMatch(/aksi\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/entitas\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/entitas_id\s+TEXT/i);
    expect(sql).toMatch(/detail\s+JSONB/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
  });

  it('creates indexes on audit_log', () => {
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_audit_log_entitas\s+ON\s+audit_log/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_audit_log_actor\s+ON\s+audit_log/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+idx_audit_log_created\s+ON\s+audit_log/i);
  });

  it('enables RLS + admin-only SELECT policy on audit_log', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+audit_log\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"audit_log_admin_select"\s+ON\s+audit_log\s+FOR\s+SELECT\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(/get_my_role\s*\(\s*\)\s*=\s*'admin'/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+audit_log\s+FROM\s+anon/i);
  });

  it('creates the consent_log table with required columns', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+consent_log/i);
    expect(sql).toMatch(/subjek_ref\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/tujuan\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/disetujui\s+BOOLEAN\s+NOT\s+NULL/i);
    expect(sql).toMatch(/versi_kebijakan\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'1\.0'/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
  });

  it('enables RLS on consent_log with insert + admin-select policies', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+consent_log\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"consent_log_insert_own"\s+ON\s+consent_log\s+FOR\s+INSERT\s+TO\s+authenticated/i,
    );
    expect(sql).toMatch(
      /CREATE\s+POLICY\s+"consent_log_admin_select"\s+ON\s+consent_log\s+FOR\s+SELECT\s+TO\s+authenticated/i,
    );
  });

  it('defines the audit_change() SECURITY DEFINER trigger function', () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+audit_change\s*\(\s*\)\s+RETURNS\s+TRIGGER\s+LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER/i,
    );
    expect(sql).toMatch(/INSERT\s+INTO\s+audit_log/i);
  });

  it('attaches audit triggers to all 5 existing sensitive tables', () => {
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_audit_kunjungan_status/i);
    expect(sql).toMatch(/AFTER\s+UPDATE\s+OF\s+status\s+ON\s+kunjungan/i);

    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_audit_reservasi_status/i);
    expect(sql).toMatch(/AFTER\s+UPDATE\s+OF\s+status\s+ON\s+reservasi/i);

    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_audit_umkm_status/i);
    expect(sql).toMatch(/AFTER\s+UPDATE\s+OF\s+status\s+ON\s+listing_umkm/i);

    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_audit_petugas_insert/i);
    expect(sql).toMatch(/AFTER\s+INSERT\s+ON\s+petugas/i);

    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_audit_petugas_delete/i);
    expect(sql).toMatch(/AFTER\s+DELETE\s+ON\s+petugas/i);

    // investment_documents — upload (insert) & delete
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_audit_investment_insert/i);
    expect(sql).toMatch(/AFTER\s+INSERT\s+ON\s+investment_documents/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_audit_investment_delete/i);
    expect(sql).toMatch(/AFTER\s+DELETE\s+ON\s+investment_documents/i);
  });

  it('does NOT attach audit triggers to non-existent visit table', () => {
    const stripped = stripLineComments(sql);
    expect(stripped).not.toMatch(/CREATE\s+TRIGGER\s+\w*visit\w*\s+ON\s+visit/i);
  });

  it('adds updated_at column to pengunjung for retention logic', () => {
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+pengunjung\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+updated_at\s+TIMESTAMPTZ/i,
    );
  });

  it('creates trigger to auto-update pengunjung.updated_at', () => {
    expect(sql).toMatch(
      /CREATE\s+TRIGGER\s+trigger_pengunjung_updated_at\s+BEFORE\s+UPDATE\s+ON\s+pengunjung/i,
    );
    expect(sql).toMatch(/update_updated_at_column/i);
  });

  it('defines anonymize_inactive_pengunjung() function with 730-day retention', () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+anonymize_inactive_pengunjung\s*\(\s*\)\s+RETURNS\s+void\s+LANGUAGE\s+sql\s+SECURITY\s+DEFINER/i,
    );
    expect(sql).toMatch(/INTERVAL\s+'730\s+days'/i);
    expect(sql).toMatch(/nama\s*=\s*'\[anonim\]'/i);
    expect(sql).toMatch(/email\s*=\s*NULL/i);
    expect(sql).toMatch(/foto_url\s*=\s*NULL/i);
  });

  it('schedules anonymization via pg_cron in a DO block that checks pg_extension', () => {
    expect(sql).toMatch(/DO\s*\$\$/i);
    expect(sql).toMatch(/pg_extension\s+WHERE\s+extname\s*=\s*'pg_cron'/i);
    expect(sql).toMatch(/cron\.schedule/i);
    expect(sql).toMatch(/anonymize_inactive_pengunjung/i);
    // DO block must also handle the missing-extension case (RAISE NOTICE)
    expect(sql).toMatch(/RAISE\s+NOTICE/i);
  });

  it('includes a ROLLBACK section', () => {
    expect(sql).toMatch(/--\s*ROLLBACK:/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+consent_log/i);
    expect(sql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+audit_log/i);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+audit_change\(\)/i);
    expect(sql).toMatch(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+anonymize_inactive_pengunjung\(\)/i);
  });
});
