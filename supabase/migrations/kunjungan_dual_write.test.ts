// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

const readMigration = (name: string) =>
  stripSqlComments(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));

describe('WP-21 atomic visit dual-write migrations', () => {
  it('creates a private buku_tamu that can trace its legacy visit', () => {
    const sql = readMigration('202607300014_buku_tamu.sql');
    expect(sql).toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.buku_tamu/i);
    expect(sql).toMatch(/id\s+uuid\s+PRIMARY\s+KEY/i);
    expect(sql).toMatch(/nama\s+text\s+NOT\s+NULL/i);
    expect(sql).toMatch(/asal\s+text/i);
    expect(sql).toMatch(/no_hp\s+text/i);
    expect(sql).toMatch(/menemui_siapa\s+text\s+NOT\s+NULL/i);
    expect(sql).toMatch(/keperluan\s+text/i);
    expect(sql).toMatch(/waktu_masuk\s+timestamptz\s+NOT\s+NULL/i);
    expect(sql).toMatch(/tanda_tangan_svg\s+text/i);
    expect(sql).toMatch(/dicatat_oleh\s+uuid\s+REFERENCES\s+public\.petugas\(id\)/i);
    expect(sql).toMatch(/created_at\s+timestamptz\s+NOT\s+NULL/i);
    expect(sql).toMatch(/legacy_visit_id\s+uuid\s+UNIQUE\s+REFERENCES\s+public\.visit\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_buku_tamu_waktu\s+ON\s+public\.buku_tamu\s*\(waktu_masuk\s+DESC\)/i);
    expect(sql).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_buku_tamu_legacy_visit_id\s+ON\s+public\.buku_tamu\s*\(legacy_visit_id\)\s+WHERE\s+legacy_visit_id\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.buku_tamu\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s*,\s*INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+TABLE\s+public\.buku_tamu\s+TO\s+authenticated/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+buku_tamu_fo_admin_all\s+ON\s+public\.buku_tamu\s+FOR\s+ALL\s+TO\s+authenticated/i);
    expect(sql).toMatch(/USING\s*\(public\.get_my_role\(\)\s+IN\s*\('admin','front_office'\)\)/i);
    expect(sql).toMatch(/WITH\s+CHECK\s*\(public\.get_my_role\(\)\s+IN\s*\('admin','front_office'\)\)/i);
    expect(sql.match(/CREATE\s+POLICY\b/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/(?:GRANT|CREATE\s+POLICY|ALTER\s+POLICY)[\s\S]*\bTO\s+(?:anon|public)\b/i);
    expect(sql).not.toMatch(/(?:ALTER\s+TABLE|DELETE\s+FROM|INSERT\s+INTO|UPDATE|TRUNCATE(?:\s+TABLE)?|DROP\s+TABLE)\s+public\.visit\b/i);
  });

  it('uses an idempotent, secured trigger instead of client-side sequential writes', () => {
    const sql = readMigration('202607300015_backfill_kunjungan_dual_write.sql');
    expect(sql).toMatch(/^\s*BEGIN\s*;/i);
    expect(sql).toMatch(/COMMIT\s*;\s*$/i);
    expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+legacy_visit_id\s+uuid/i);
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+kunjungan_legacy_visit_id_key\s+UNIQUE\s*\(legacy_visit_id\)/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.tiket_antrean\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+legacy_visit_id\s+uuid\s+REFERENCES\s+public\.visit\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+tiket_antrean_legacy_visit_id_key\s+UNIQUE\s*\(legacy_visit_id\)/i);
    const ticketLegacyColumn = sql.match(/ALTER\s+TABLE\s+public\.tiket_antrean\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+legacy_visit_id[^;]*;/i)?.[0] ?? '';
    expect(ticketLegacyColumn).not.toMatch(/NOT\s+NULL/i);
    expect(sql).toMatch(/CREATE\s+TABLE\s+public\.wp21_backfill_ledger/i);
    expect(sql).toMatch(/visit_id\s+uuid\s+PRIMARY\s+KEY\s+REFERENCES\s+public\.visit\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/kunjungan_id\s+uuid\s+REFERENCES\s+public\.kunjungan\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/tiket_id\s+uuid\s+REFERENCES\s+public\.tiket_antrean\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/buku_tamu_id\s+uuid\s+REFERENCES\s+public\.buku_tamu\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/CHECK\s*\(\s*\(kunjungan_id\s+IS\s+NOT\s+NULL\s+AND\s+buku_tamu_id\s+IS\s+NULL\)/i);
    expect(sql).toMatch(/OR\s+\(kunjungan_id\s+IS\s+NULL\s+AND\s+tiket_id\s+IS\s+NULL\s+AND\s+buku_tamu_id\s+IS\s+NOT\s+NULL\)\s*\)/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.wp21_backfill_ledger\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.wp21_backfill_ledger\s+TO\s+authenticated/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+wp21_backfill_ledger_admin_read\s+ON\s+public\.wp21_backfill_ledger\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s*\(public\.get_my_role\(\)\s*=\s*'admin'\)/i);
    expect(sql.match(/CREATE\s+POLICY\s+(?:"[^"]+"|\w+)\s+ON\s+public\.wp21_backfill_ledger\b/gi)).toHaveLength(1);
    expect(sql).not.toMatch(/(?:GRANT|CREATE\s+POLICY|ALTER\s+POLICY)[\s\S]*wp21_backfill_ledger[\s\S]*\bTO\s+(?:anon|public)\b/i);
    expect(sql).toMatch(/FROM\s+public\.visit\s+WHERE\s+tujuan\s*=\s*'loket'\s+AND\s+layanan_id\s+IS\s+NULL/i);
    expect(sql).toMatch(/FROM\s+public\.visit\s+WHERE\s+tujuan\s*=\s*'bertemu_seseorang'\s+AND\s+waktu_scan\s+IS\s+NOT\s+NULL\s+AND\s+nama_yang_ditemui\s+IS\s+NULL/i);
    expect(sql).toMatch(/WITH\s+historical_tickets[\s\S]*?WHERE\s+v\.tujuan\s*=\s*'loket'[\s\S]*?v\.status\s*<>\s*'terjadwal'/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.buku_tamu[\s\S]*?FROM\s+public\.visit\s+AS\s+v[\s\S]*?v\.waktu_scan\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.tiket_antrean\s*\(\s*legacy_visit_id[\s\S]*?\)\s*SELECT\s+h\.visit_id/i);
    expect(sql).toMatch(/v_tiket_id\s*:=\s*public\.terbit_tiket\s*\(/i);
    expect(sql).toMatch(/UPDATE\s+public\.tiket_antrean\s+SET\s+legacy_visit_id\s*=\s*NEW\.id\s+WHERE\s+id\s*=\s*v_tiket_id/i);
    expect(sql).toMatch(/WHERE\s+t\.legacy_visit_id\s*=\s*NEW\.id/i);
    const walkInTransition = sql.match(/NEW\.asal\s*=\s*'walk_in'\s+AND\s+OLD\.status\s*=\s*'terjadwal'\s+AND\s+NEW\.status\s*=\s*'menunggu'/i)?.[0] ?? '';
    expect(walkInTransition).not.toBe('');
    expect(walkInTransition).not.toMatch(/waktu_scan/i);
    expect(sql).toMatch(/IF\s+NEW\.layanan_id\s+IS\s+NULL\s+THEN\s+RAISE\s+EXCEPTION/i);
    expect(sql).toMatch(/NEW\.waktu_scan\s+IS\s+NOT\s+NULL\s+AND\s+NEW\.nama_yang_ditemui\s+IS\s+NULL/i);
    expect(sql).toMatch(/NEW\.status\s*=\s*'menunggu'\s+AND\s+NEW\.waktu_scan\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.antrean_counter[\s\S]*?ON\s+CONFLICT\s*\(layanan_id,\s*tanggal\)\s+DO\s+UPDATE/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sync_visit_dual_write\s*\(\)/i);
    expect(sql).toMatch(/SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i);
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(legacy_visit_id\)\s+DO\s+NOTHING/i);
    expect(sql).toMatch(/IF\s+TG_OP\s*=\s*'UPDATE'[\s\S]*?NEW\.waktu_selesai\s+IS\s+DISTINCT\s+FROM\s+OLD\.waktu_selesai/i);
    expect(sql).toMatch(/FROM\s+public\.kunjungan\s+AS\s+k[\s\S]*?FOR\s+UPDATE/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_visit_dual_write\s+AFTER\s+INSERT\s+OR\s+UPDATE/i);
    expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.sync_visit_dual_write\s*\(\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
    expect(sql).toMatch(/REVOKE\s+CREATE\s+ON\s+SCHEMA\s+public\s+FROM\s+PUBLIC/i);
    expect(sql).not.toMatch(/(?:ALTER\s+TABLE|DELETE\s+FROM|DROP\s+TABLE|INSERT\s+INTO|TRUNCATE(?:\s+TABLE)?|UPDATE)\s+public\.visit\b/i);
  });
});
