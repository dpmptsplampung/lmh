// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BASELINE_FILES,
  FORWARD_MIGRATION_FILES,
  listMigrationFiles,
  readAllBaseline,
  readBaseline,
  stripSqlComments,
} from './migration-test-utils';

describe('production baseline migration inventory', () => {
  it('contains exactly the approved timestamped SQL files', () => {
    expect(listMigrationFiles()).toEqual([...BASELINE_FILES, ...FORWARD_MIGRATION_FILES]);
    for (const file of listMigrationFiles()) {
      expect(file).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    }
  });

  it('can read every approved baseline file and none is empty', () => {
    BASELINE_FILES.forEach((_, index) => {
      expect(readBaseline(index as 0 | 1 | 2 | 3 | 4).trim().length).toBeGreaterThan(0);
    });
  });

  it('contains no credentials, demo data, auth-user mutation, or placeholder phone', () => {
    const sql = readAllBaseline().toLowerCase();
    expect(sql).not.toContain('password123');
    expect(sql).not.toContain('unsplash.com');
    expect(sql).not.toMatch(/(?:insert\s+into|delete\s+from)\s+auth\.(?:users|identities)/i);
    expect(sql).not.toMatch(/6281234567890|6281277000000/);
  });

  it('never creates retired objects or edit_token', () => {
    const sql = stripSqlComments(readAllBaseline());
    for (const name of ['kunjungan', 'reservasi', 'kehadiran_layanan', 'antrian_helpdesk']) {
      expect(sql).not.toMatch(new RegExp(`CREATE\\s+(?:TABLE|VIEW)\\s+(?:public\\.)?${name}\\b`, 'i'));
    }
    expect(sql).not.toMatch(/sync_(?:kunjungan|reservasi)_to_visit|sync_kunjungan_update_to_visit/i);
    expect(sql).not.toMatch(/\bedit_token\b/i);
  });

  it('orders extensions, schemas, security, and views/jobs by dependency', () => {
    const extensions = readBaseline(0);
    const core = readBaseline(1);
    const features = readBaseline(2);
    const security = readBaseline(3);
    const views = readBaseline(4);
    expect(extensions).toMatch(/CREATE\s+EXTENSION[\s\S]*vector/i);
    expect(features).toMatch(/embedding\s+extensions\.vector\s*\(768\)/i);
    expect(core).toMatch(/CREATE\s+TABLE\s+public\.layanan/i);
    expect(features).toMatch(/CREATE\s+TABLE\s+public\.chat_sesi/i);
    expect(security).toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
    expect(security).toMatch(/CREATE\s+POLICY/i);
    expect(views).toMatch(/CREATE\s+(?:MATERIALIZED\s+)?VIEW/i);
    expect(views).toMatch(/cron\.schedule/i);
  });

  it('keeps all SECURITY DEFINER functions on fixed paths with deny-by-default execute', () => {
    const sql = stripSqlComments(readAllBaseline());
    const definitions = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\([^;]*?SECURITY\s+DEFINER[\s\S]*?;/gi)];
    expect(definitions.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(definition[0]).toMatch(/SET\s+search_path\s*=\s*(?:''|pg_catalog(?:\s*,\s*public)?)/i);
      const fn = definition[1].split('.').at(-1)!;
      expect(sql).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, 'i'));
    }
  });

  it('forbids insecure chat SELECT and public base-table UMKM SELECT', () => {
    const sql = stripSqlComments(readAllBaseline());
    expect(sql).not.toMatch(/ON\s+public\.chat_(?:sesi|pesan)[\s\S]{0,120}FOR\s+SELECT[\s\S]{0,120}USING\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.listing_umkm\s+TO\s+(?:anon|PUBLIC)/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY\s+"listing_public_read"\s+ON\s+public\.listing_umkm/i);
  });

  it('keeps investment storage private and path-scoped without broad policies', () => {
    const sql = stripSqlComments(readBaseline(3));
    expect(sql).toMatch(/'investment-docs'\s*,\s*'investment-docs'\s*,\s*false/i);
    expect(sql).toMatch(/storage\.foldername\(name\)[\s\S]*'_raw'[\s\S]*'pages'/i);
    expect(sql).not.toMatch(/USING\s*\(\s*bucket_id\s*=\s*'investment-docs'\s+AND\s+public\.get_my_role\(\)\s*=\s*'admin'\s*\)/i);
    expect(sql).toMatch(/'umkm-photos'\s*,\s*'umkm-photos'\s*,\s*true/i);
  });

  it('returns the correct audit row and counts only walk-in visit inserts', () => {
    const sql = stripSqlComments(readBaseline(3));
    expect(sql).toMatch(/IF\s+TG_OP\s*=\s*'DELETE'\s+THEN\s+RETURN\s+OLD;\s+END\s+IF;\s+RETURN\s+NEW;/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_log_visit_insert[\s\S]*WHEN\s*\(NEW\.asal\s*=\s*'walk_in'\)/i);
  });
});
