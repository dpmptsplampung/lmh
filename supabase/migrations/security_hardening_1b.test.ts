// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBaseline, stripSqlComments } from './migration-test-utils';

describe('Gate 1B security hardening (baseline in-place)', () => {
  const feature = stripSqlComments(readBaseline(2));
  const security = stripSqlComments(readBaseline(3));

  it('binds consent_log insert to auth.uid ownership (not WITH CHECK true)', () => {
    expect(security).toMatch(
      /CREATE\s+POLICY\s+"consent_log_insert_own"\s+ON\s+public\.consent_log\s+FOR\s+INSERT\s+TO\s+authenticated\s+WITH\s+CHECK\s*\(/i,
    );
    expect(security).not.toMatch(
      /CREATE\s+POLICY\s+"consent_log_insert_own"[\s\S]{0,200}WITH\s+CHECK\s*\(\s*true\s*\)/i,
    );
    expect(security).toMatch(
      /subjek_ref\s*=\s*auth\.uid\(\)::text/i,
    );
    expect(security).toMatch(
      /subjek_ref\s+IN\s*\(\s*SELECT\s+id::text\s+FROM\s+public\.pengunjung\s+WHERE\s+auth_user_id\s*=\s*auth\.uid\(\)\s*\)/i,
    );
  });

  it('audit_change stores allowlisted metadata only — no full to_jsonb(NEW/OLD)', () => {
    const auditFn = security.match(
      /CREATE\s+FUNCTION\s+public\.audit_change\(\)[\s\S]*?\$\$;/i,
    );
    expect(auditFn).not.toBeNull();
    const body = auditFn![0];
    expect(body).not.toMatch(/to_jsonb\s*\(\s*NEW\s*\)/i);
    expect(body).not.toMatch(/to_jsonb\s*\(\s*OLD\s*\)/i);
    expect(body).not.toMatch(/'email'|\"email\"/i);
    expect(body).not.toMatch(/'nama'|\"nama\"/i);
    expect(body).not.toMatch(/'phone'|\"phone\"|hp|telepon/i);
    expect(body).not.toMatch(/'token'|qr_token|pesan|message|body/i);
    expect(body).toMatch(/jsonb_build_object/i);
    expect(body).toMatch(/'id'|entitas_id|status|role|actor/i);
  });

  it('notifikasi supports atomic claim with claim_token and processing status', () => {
    expect(feature).toMatch(/claim_token\s+uuid/i);
    expect(feature).toMatch(/claimed_at\s+timestamptz/i);
    expect(feature).toMatch(/available_at\s+timestamptz/i);
    expect(feature).toMatch(
      /status\s+text[\s\S]*'pending'[\s\S]*'processing'[\s\S]*'sent'[\s\S]*'failed'[\s\S]*'skipped'/i,
    );
    expect(feature).toMatch(/idempotency_key\s+text/i);
    expect(feature).toMatch(
      /CREATE\s+UNIQUE\s+INDEX[\s\S]*idempotency_key[\s\S]*WHERE\s+idempotency_key\s+IS\s+NOT\s+NULL/i,
    );
  });

  it('defines claim_notifikasi and complete_notifikasi restricted to service_role', () => {
    expect(security).toMatch(/CREATE\s+FUNCTION\s+public\.claim_notifikasi\s*\(\s*p_limit/i);
    expect(security).toMatch(
      /FOR\s+UPDATE\s+SKIP\s+LOCKED|FOR\s+UPDATE\s+OF[\s\S]*SKIP\s+LOCKED/i,
    );
    expect(security).toMatch(/CREATE\s+FUNCTION\s+public\.complete_notifikasi\s*\(/i);
    expect(security).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_notifikasi[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
    expect(security).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.claim_notifikasi[\s\S]*TO\s+service_role/i,
    );
    expect(security).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.complete_notifikasi[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i,
    );
    expect(security).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.complete_notifikasi[\s\S]*TO\s+service_role/i,
    );
  });
});
