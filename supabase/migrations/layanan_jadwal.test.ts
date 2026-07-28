// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

describe('layanan schedule migration', () => {
  const raw = readFileSync(
    join(MIGRATIONS_DIR, '202607280001_layanan_jadwal.sql'),
    'utf8',
  );
  const sql = stripSqlComments(raw);

  it('adds is_ptsp flag to layanan and marks the DPMPTSP service', () => {
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.layanan\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+is_ptsp\s+boolean/i);
    expect(sql).toMatch(/UPDATE\s+public\.layanan\s+SET\s+is_ptsp\s*=\s*true[\s\S]*Layanan Perizinan DPMPTSP Provinsi Lampung/i);
  });

  it('creates layanan_jadwal with weekday array bounded 1..7', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+public\.layanan_jadwal/i);
    expect(sql).toMatch(/hari_kerja\s+smallint\[\][\s\S]*<@\s*'\{1,2,3,4,5,6,7\}'/i);
    expect(sql).toMatch(/REFERENCES\s+public\.layanan\(id\)\s+ON\s+DELETE\s+CASCADE/i);
  });

  it('seeds default schedule for existing layanan', () => {
    expect(sql).toMatch(/INSERT\s+INTO\s+public\.layanan_jadwal\s+\(layanan_id\)\s*SELECT\s+id\s+FROM\s+public\.layanan/i);
  });

  it('creates layanan_libur with unique layanan+tanggal', () => {
    expect(sql).toMatch(/CREATE\s+TABLE\s+public\.layanan_libur/i);
    expect(sql).toMatch(/UNIQUE\s*\(layanan_id,\s*tanggal\)/i);
  });

  it('is_layanan_buka checks libur override then weekday schedule', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.is_layanan_buka\s*\(/i);
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.layanan_libur/i);
    expect(sql).toMatch(/EXTRACT\s*\(ISODOW\s+FROM\s+p_tanggal\)/i);
  });

  it('is_layanan_buka is executable by anon and authenticated (public UX needs it)', () => {
    expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_layanan_buka\(uuid,\s*date,\s*time\)\s+TO\s+anon,\s*authenticated/i);
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_layanan_buka\(uuid,\s*date,\s*time\)\s+TO\s+PUBLIC/i);
  });

  it('schedule tables are publicly readable but writable only by admin or PTSP staff', () => {
    expect(sql).toMatch(/CREATE\s+POLICY\s+"jadwal_public_read"\s+ON\s+public\.layanan_jadwal\s+FOR\s+SELECT\s+USING\s*\(true\)/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+"libur_public_read"\s+ON\s+public\.layanan_libur\s+FOR\s+SELECT\s+USING\s*\(true\)/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+"jadwal_ptsp_write"[\s\S]*is_ptsp_staff\(\)/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+"libur_ptsp_write"[\s\S]*is_ptsp_staff\(\)/i);
    expect(sql).toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('guards visit inserts against closed layanan dates via trigger', () => {
    expect(sql).toMatch(/FUNCTION\s+public\.guard_visit_layanan_buka/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_guard_visit_layanan_buka\s+BEFORE\s+INSERT\s+ON\s+public\.visit/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'Layanan tidak beroperasi pada tanggal tersebut/i);
  });

  it('guard uses tanggal_rencana for reservasi and waktu_masuk for walk-in', () => {
    expect(sql).toMatch(/IF\s+NEW\.asal\s*=\s*'reservasi'[\s\S]*v_tanggal\s*:=\s*NEW\.tanggal_rencana/i);
    expect(sql).toMatch(/v_tanggal\s*:=\s*COALESCE\s*\(NEW\.waktu_masuk::date/i);
  });
});
