// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

const readMigration = (name: string) =>
  stripSqlComments(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));

describe('WP-21 atomic visit dual- write migrations', () => {
  it('creates a private buku_tamu that can trace its legacy visit', () => {
    const sql = readMigration('202607300014_buku_tamu.sql');
    expect(sql).toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.buku_tamu/i);
    expect(sql).toMatch(/legacy_visit_id\s+uuid\s+UNIQUE\s+REFERENCES\s+public\.visit\(id\)\s+ON\s+DELETE\s+RESTRICT/);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.buku_tamu\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+buku_tamu_fo_admin_all[\s\S]*get_my_role\(\)\s+IN\s*\('admin','front_office'\)/i);
    expect(sql).not.toMatch(/FOR\s+SELECT\s+USING\s*\(\s*true\s*\)/i);
  });
});