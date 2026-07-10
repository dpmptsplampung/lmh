// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

// Regression guard for K4: no ACTIVE migration may contain the hardcoded
// password `password123`. Migrations 013 and 015 are historical and contain
// the credential — they are explicitly excluded here (they cannot be edited
// without causing drift on instances that already applied them; migration 023
// cleans up the accounts going forward). Any NEW migration that reintroduces
// `password123` (outside of 013/015) must fail this test.
const HISTORICAL_EXCEPTIONS = new Set([
  '013_create_petugas_accounts.sql',
  '015_update_layanan.sql',
]);

const FORBIDDEN_TOKEN = 'password123';

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      if (idx === -1) return line;
      return line.slice(0, idx);
    })
    .join('\n');
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
}

describe('regression: no active migration may contain hardcoded password123', () => {
  it('every migration file (except 013/015) is free of password123 after stripping comments', () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      if (HISTORICAL_EXCEPTIONS.has(file)) continue;
      const raw = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const stripped = stripSqlComments(raw);
      if (stripped.toLowerCase().includes(FORBIDDEN_TOKEN)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('historical exceptions list only contains files that actually exist', () => {
    const files = listMigrationFiles();
    for (const ex of HISTORICAL_EXCEPTIONS) {
      expect(files).toContain(ex);
    }
  });

  it('the forbidden token is genuinely absent from migration 023 (the K4 cleanup)', () => {
    const files = listMigrationFiles();
    const k4 = files.find((f) => f.startsWith('023_'));
    expect(k4).toBeDefined();
    const raw = readFileSync(join(MIGRATIONS_DIR, k4!), 'utf8');
    expect(stripSqlComments(raw).toLowerCase()).not.toContain(FORBIDDEN_TOKEN);
  });
});
