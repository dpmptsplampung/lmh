// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SEED_DEMO_PATH = join(process.cwd(), 'supabase', 'seed-demo.sql');
const MIGRATION_026_PATH = join(
  process.cwd(),
  'supabase',
  'migrations',
  '026_update_wa_number.sql',
);

function readSeedDemo(): string {
  return readFileSync(SEED_DEMO_PATH, 'utf8');
}

function readMigration026(): string {
  return readFileSync(MIGRATION_026_PATH, 'utf8');
}

describe('B4: seed-demo.sql demo investment documents section', () => {
  it('file exists', () => {
    expect(existsSync(SEED_DEMO_PATH)).toBe(true);
  });

  it('has the B4 section header', () => {
    const sql = readSeedDemo();
    expect(sql).toMatch(/B4:\s*Demo\s+investment\s+documents/i);
    expect(sql).toMatch(/DEV\/STAGING\s+ONLY/i);
  });

  it('contains all 9 Unsplash URLs (demo thumbnails moved from migration 017)', () => {
    const sql = readSeedDemo();
    const unsplashUrls = [
      'photo-1581091226825-a6a2a5aee158',
      'photo-1559589689-577aabd1ce4c',
      'photo-1532601224476-15c79f2f7a51',
      'photo-1507525428034-b723cf961d3e',
      'photo-1550828520-4cb496926fc9',
      'photo-1615462575791-76495ff246a4',
      'photo-1605374828131-0cfd80cbcd7b',
      'photo-1466611653911-95081537e5b7',
      'photo-1586528116311-ad8ed745eb33',
    ];
    for (const url of unsplashUrls) {
      expect(sql, `expected seed-demo.sql to contain ${url}`).toContain(url);
    }
  });

  it('uses idempotent INSERT (ON CONFLICT DO NOTHING)', () => {
    const sql = readSeedDemo();
    expect(sql).toMatch(/ON\s+CONFLICT\s+DO\s+NOTHING/i);
  });
});

describe('B4: migration 026_update_wa_number.sql', () => {
  it('file exists', () => {
    expect(existsSync(MIGRATION_026_PATH)).toBe(true);
  });

  it("updates wa_number in site_settings", () => {
    const sql = readMigration026();
    expect(sql).toMatch(/UPDATE\s+site_settings\s+SET\s+value\s*=\s*'6281277000000'\s+WHERE\s+key\s*=\s*'wa_number'/i);
  });

  it('has a ROLLBACK section', () => {
    const sql = readMigration026();
    expect(sql).toMatch(/--\s*ROLLBACK/i);
    expect(sql).toMatch(/6281234567890/);
  });
});
