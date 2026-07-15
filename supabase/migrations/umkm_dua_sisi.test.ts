// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readAllBaseline, readBaseline, stripSqlComments } from './migration-test-utils';

describe('final two-sided UMKM baseline', () => {
  const feature = readBaseline(2);
  const security = readBaseline(3);
  const views = readBaseline(4);

  it('integrates sides, owner mapping, and inquiry into final tables', () => {
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.listing_umkm[\s\S]*sisi\s+text\s+NOT\s+NULL\s+DEFAULT\s+'kebutuhan'/i);
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.umkm_listing_owner/i);
    expect(feature).toMatch(/UNIQUE\s*\(listing_id,\s*email\)/i);
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.umkm_inquiry/i);
    expect(stripSqlComments(readAllBaseline())).not.toMatch(/\bedit_token\b/i);
  });

  it('uses a security-invoker allowlisted public view and forbids public base access', () => {
    expect(views).toMatch(/CREATE\s+VIEW\s+public\.v_umkm_public\s+WITH\s*\(security_invoker\s*=\s*true\)/i);
    const publicView = views.match(/CREATE\s+VIEW\s+public\.v_umkm_public[\s\S]*?;/i)?.[0] ?? '';
    for (const column of ['id', 'nama_umkm', 'kategori_kebutuhan', 'sisi', 'deskripsi', 'foto_produk', 'status']) {
      expect(publicView).toMatch(new RegExp(`listing\\.${column}\\b`, 'i'));
    }
    expect(publicView).not.toMatch(/kontak_|snapshot_approved|dibuat_oleh|owner|token/i);
    expect(security).not.toMatch(/CREATE\s+POLICY[^;]*ON\s+public\.listing_umkm[^;]*(?:TO\s+anon|USING\s*\(status\s*=\s*'published'\))/i);
    expect(views).toMatch(/GRANT\s+SELECT\s+ON\s+public\.v_umkm_public\s+TO\s+anon,\s*authenticated/i);
  });

  it('keeps owner/admin controls and publishes a contact-free match view', () => {
    expect(security).toMatch(/CREATE\s+POLICY\s+"listing_umkm_select_own"/i);
    expect(security).toMatch(/CREATE\s+POLICY\s+"listing_umkm_update_own"/i);
    expect(views).toMatch(/CREATE\s+VIEW\s+public\.v_umkm_match\s+WITH\s*\(security_invoker\s*=\s*true\)/i);
    expect(views).not.toMatch(/kontak_|snapshot_approved|edit_token/i);
  });
});
