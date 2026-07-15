// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBaseline } from './migration-test-utils';

describe('Supabase custom access-token hook', () => {
  const sql = readBaseline(3);

  it('accepts event jsonb, resolves event user_id, preserves event, and sets app_metadata.role', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.set_user_role_claim\s*\(event\s+jsonb\)/i);
    expect(sql).toMatch(/RETURNS\s+jsonb/i);
    expect(sql).toMatch(/auth_user_id\s*=\s*\(event->>'user_id'\)::uuid/i);
    expect(sql).toMatch(/event->'claims'/i);
    expect(sql).toMatch(/jsonb_set\s*\([\s\S]*\{claims,app_metadata,role\}/i);
    expect(sql).toMatch(/RETURN\s+event/i);
  });

  it('grants execution only to supabase_auth_admin', () => {
    expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.set_user_role_claim\(jsonb\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.set_user_role_claim\(jsonb\)\s+TO\s+supabase_auth_admin/i);
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.set_user_role_claim\(jsonb\)\s+TO\s+(?:anon|authenticated|PUBLIC)/i);
  });
});
