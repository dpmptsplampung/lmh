// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '025_layanan_tipe.sql',
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('B2: migration 025_layanan_tipe.sql', () => {
  it('file exists', () => {
    const sql = readMigration();
    expect(sql.length).toBeGreaterThan(0);
  });

  it('adds the tipe column', () => {
    const sql = readMigration();
    expect(sql).toMatch(/ADD\s+COLUMN\s+tipe\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'konsultatif'/i);
  });

  it("has a CHECK constraint for the 3 allowed tipe values", () => {
    const sql = readMigration();
    expect(sql).toMatch(/CHECK\s*\(\s*tipe\s+IN\s*\(\s*'konsultatif'\s*,\s*'mitra'\s*,\s*'modul_publik'\s*\)\s*\)/i);
  });

  it("sets UMKM & Investment Gallery to modul_publik", () => {
    const sql = readMigration();
    expect(sql).toMatch(/UPDATE\s+layanan\s+SET\s+tipe\s*=\s*'modul_publik'\s+WHERE\s+nama\s+IN\s*\(\s*'Matchmaking UMKM'\s*,\s*'Investment Gallery'\s*\)/i);
  });

  it("sets Bank Lampung & BALMON to mitra", () => {
    const sql = readMigration();
    expect(sql).toMatch(/UPDATE\s+layanan\s+SET\s+tipe\s*=\s*'mitra'\s+WHERE\s+nama\s+IN\s*\(\s*'Bank Lampung'\s*,\s*'BALMON'\s*\)/i);
  });

  it('has a ROLLBACK section', () => {
    const sql = readMigration();
    expect(sql).toMatch(/--\s*ROLLBACK/i);
    expect(sql).toMatch(/DROP\s+COLUMN\s+tipe/i);
  });
});
