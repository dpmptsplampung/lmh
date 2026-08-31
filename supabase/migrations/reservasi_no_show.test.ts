import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripSqlComments, FORWARD_MIGRATION_FILES } from './migration-test-utils';

const sql = readFileSync(join(__dirname, '202608310002_reservasi_no_show.sql'), 'utf8');

describe('202608310002_reservasi_no_show migration', () => {
  it('is registered in FORWARD_MIGRATION_FILES', () => {
    expect(FORWARD_MIGRATION_FILES).toContain('202608310002_reservasi_no_show.sql');
  });

  it('marks expired scheduled reservations as no_show (QUE-15)', () => {
    const fn = sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.tandai_reservasi_no_show[\s\S]*?END\s+\$\$;/i)?.[0] ?? '';
    expect(fn).not.toBe('');
    expect(fn).toMatch(/UPDATE\s+public\.visit/i);
    expect(fn).toMatch(/asal\s*=\s*'reservasi'/i);
    expect(fn).toMatch(/status\s*=\s*'terjadwal'/i);
    expect(fn).toMatch(/tanggal_rencana\s*<\s*v_today/i);
    expect(fn).toMatch(/status\s*=\s*'no_show'/i);
  });

  it('keeps the function on a fixed search path with execute revoked', () => {
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.tandai_reservasi_no_show[\s\S]*?SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.tandai_reservasi_no_show[\s\S]*?FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
  });

  it('schedules the daily pg_cron job after the WP-23 end-of-day job (15:45 WIB)', () => {
    expect(sql).toMatch(/cron\.schedule\(\s*'reservasi_no_show_harian'\s*,\s*'45\s+8\s+\*\s+\*\s+\*'/i);
  });

  it('adds a DB guard trigger rejecting check-in of expired reservations', () => {
    const fn = sql.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cegah_checkin_reservasi_kedaluwarsa[\s\S]*?END\s+\$\$;/i)?.[0] ?? '';
    expect(fn).not.toBe('');
    expect(fn).toMatch(/OLD\.status\s*=\s*'terjadwal'/i);
    expect(fn).toMatch(/NEW\.status\s*=\s*'menunggu'/i);
    expect(fn).toMatch(/NEW\.tanggal_rencana\s*<\s*\(now\(\)\s+AT\s+TIME\s+ZONE\s+'Asia\/Jakarta'\)::date/i);
    expect(fn).toMatch(/QR\s+hangus/i);
    expect(fn).toMatch(/RAISE\s+EXCEPTION/i);

    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_visit_qr_hangus\s+BEFORE\s+UPDATE\s+OF\s+status\s+ON\s+public\.visit\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.cegah_checkin_reservasi_kedaluwarsa/i);
  });

  it('leaves existing status values untouched (aditif, no_visit_check_change)', () => {
    // Migrasi ini TIDAK boleh mengubah constraint/check existing (aditif murni).
    const active = stripSqlComments(sql);
    expect(active).not.toMatch(/DROP\s+CONSTRAINT/i);
    expect(active).not.toMatch(/ALTER\s+TABLE\s+public\.visit\s+ADD\s+CONSTRAINT/i);
    expect(active).not.toMatch(/DROP\s+TABLE|DROP\s+COLUMN/i);
  });
});
