// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readMigration = (name: string) => readFileSync(
  resolve(__dirname, `../../../supabase/migrations/${name}`),
  'utf8',
);

describe('final UMKM RLS contract', () => {
  const feature = readMigration('202607140003_feature_schema.sql');
  const security = readMigration('202607140004_security_and_automation.sql');
  const views = readMigration('202607140005_views_and_jobs.sql');
  const publicPage = readFileSync(resolve(__dirname, 'page.tsx'), 'utf8');

  it('maps owners without legacy edit tokens or backfill', () => {
    expect(feature).toMatch(/CREATE\s+TABLE\s+public\.umkm_listing_owner/i);
    expect(feature).not.toMatch(/edit_token/i);
    expect(security).not.toMatch(/INSERT\s+INTO\s+(?:public\.)?umkm_listing_owner\s*\([^)]*listing_id/i);
  });

  it('allows owner self-service and reserves publish approval for admin', () => {
    expect(security).toMatch(/CREATE\s+POLICY\s+"umkm_owner_select_own"/i);
    expect(security).toMatch(/CREATE\s+POLICY\s+"listing_umkm_select_own"/i);
    expect(security).toMatch(/CREATE\s+POLICY\s+"listing_umkm_update_own"[\s\S]*status\s+NOT\s+IN\s*\('published'\)[\s\S]*public\.get_my_role\(\)\s*=\s*'admin'/i);
  });

  it('publishes only an allowlisted security-invoker view', () => {
    expect(views).toMatch(/CREATE\s+VIEW\s+public\.v_umkm_public\s+WITH\s*\(security_invoker\s*=\s*true\)/i);
    expect(views).toMatch(/GRANT\s+SELECT\s+ON\s+public\.v_umkm_public\s+TO\s+anon,\s*authenticated/i);
    expect(security).not.toMatch(/CREATE\s+POLICY[^;]*ON\s+public\.listing_umkm[^;]*TO\s+anon/i);
    expect(publicPage).toMatch(/\.from\('v_umkm_public'\)/);
    expect(publicPage).not.toMatch(/\.from\('listing_umkm'\)[\s\S]{0,200}kontak_/);
  });
});
