// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readBaseline } from './migration-test-utils';

describe('final investment lead baseline', () => {
  const feature = readBaseline(2);
  const security = readBaseline(3);

  it('creates the final CRM-lite lead table and indexes', () => {
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.investasi_lead/i);
    expect(feature).toMatch(/doc_id\s+uuid\s+REFERENCES\s+public\.investment_documents\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i);
    expect(feature).toMatch(/status\s+text\s+NOT\s+NULL\s+DEFAULT\s+'baru'/i);
    expect(feature).toMatch(/CREATE\s+INDEX\s+idx_investasi_lead_status/i);
  });

  it('rate-limits inserts and scopes reads/updates to staff', () => {
    expect(security).toMatch(/CREATE\s+POLICY\s+"investasi_lead_insert"[\s\S]*check_anon_rate\('investasi_lead_insert',\s*3,\s*3600\)/i);
    expect(security).toMatch(/CREATE\s+POLICY\s+"investasi_lead_select_staff"/i);
    expect(security).toMatch(/CREATE\s+POLICY\s+"investasi_lead_update_admin"/i);
  });
});
