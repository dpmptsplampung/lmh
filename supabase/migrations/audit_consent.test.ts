// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readAllBaseline, readBaseline, stripSqlComments } from './migration-test-utils';

describe('final audit, consent, and retention baseline', () => {
  const feature = readBaseline(2);
  const security = readBaseline(3);
  const jobs = readBaseline(4);

  it('creates audit and consent tables with RLS', () => {
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.audit_log/i);
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.consent_log/i);
    expect(security).toMatch(/ALTER\s+TABLE\s+public\.audit_log\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(security).toMatch(/CREATE\s+POLICY\s+"audit_log_admin_select"/i);
  });

  it('audits only final sensitive tables and schedules retention', () => {
    expect(security).toMatch(/CREATE\s+FUNCTION\s+public\.audit_change/i);
    expect(security).toMatch(/trg_audit_visit_status/i);
    expect(security).toMatch(/trg_audit_umkm_status/i);
    expect(jobs).toMatch(/cron\.schedule[\s\S]*anonymize_inactive_pengunjung/i);
    expect(stripSqlComments(readAllBaseline())).not.toMatch(/trg_audit_(?:kunjungan|reservasi)/i);
  });

  it('attaches audit events to every final sensitive operation', () => {
    for (const trigger of [
      'trg_audit_visit_status', 'trg_audit_umkm_status',
      'trg_audit_petugas_insert', 'trg_audit_petugas_delete',
      'trg_audit_investment_insert', 'trg_audit_investment_delete',
      'trg_audit_investasi_lead_status',
    ]) {
      expect(security).toMatch(new RegExp(`CREATE\\s+TRIGGER\\s+${trigger}\\b`, 'i'));
    }
  });

  it('redacts the exact retained visitor PII fields after 730 days', () => {
    expect(security).toMatch(/UPDATE\s+public\.pengunjung\s+SET\s+nama\s*=\s*'\[anonim\]'\s*,\s*email\s*=\s*NULL\s*,\s*foto_url\s*=\s*NULL/i);
    expect(security).toMatch(/updated_at\s*<\s*pg_catalog\.now\(\)\s*-\s*INTERVAL\s+'730 days'/i);
    expect(security).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.anonymize_inactive_pengunjung\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
  });
});
