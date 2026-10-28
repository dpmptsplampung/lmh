// @vitest-environment node
//
// Kontrak statis migrasi 202611010002 (menutup celah RLS tiket_antrean). Perilaku sebenarnya diuji di
// scripts/lokal-rantai/skenario-akses-data.mjs (PGlite pada skema asli); berkas ini hanya menjaga bentuk SQL.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202611010002_tiket_antrean_lingkup.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8').replace(/\r\n/g, '\n');
const bare = sql.replace(/--[^\n]*/g, '');
const rollback = readFileSync(join(__dirname, '..', '..', 'docs', 'rollback-tiket-antrean-lingkup-202611010002.sql'), 'utf8');

describe('202611010002_tiket_antrean_lingkup migration', () => {
  it('terdaftar tepat sesudah 202611010001 dan menjaga prasyarat', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_FILE)).toBe(daftar.indexOf('202611010001_fo_cari_pengunjung.sql') + 1);
    for (const p of ['public.staf_lingkup()', 'public.boleh_kunjungan(uuid)']) expect(bare).toContain(`to_regprocedure('${p}')`);
  });

  it('B1: aditif (tanpa DELETE/TRUNCATE/DROP TABLE|COLUMN/UPDATE/ALTER TABLE)', () => {
    expect(bare).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(bare).not.toMatch(/\bTRUNCATE\b/i);
    expect(bare).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i);
    expect(bare).not.toMatch(/\bUPDATE\s+public\./i);
    expect(bare).not.toMatch(/\bALTER\s+TABLE\b/i);
  });

  it('boleh_tiket_baca: SECURITY DEFINER terkunci, hanya authenticated/service_role, memakai lingkup + WIB', () => {
    expect(bare).toMatch(/CREATE OR REPLACE FUNCTION public\.boleh_tiket_baca\(p_kunjungan uuid, p_layanan uuid, p_tanggal date\)/);
    expect(bare).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(bare).toContain('public.staf_lingkup()');
    expect(bare).toContain('public.boleh_kunjungan(p_kunjungan)');
    expect(bare).toContain("AT TIME ZONE 'Asia/Jakarta'");
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.boleh_tiket_baca\(uuid, uuid, date\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.boleh_tiket_baca\(uuid, uuid, date\) TO authenticated, service_role/);
  });

  it('tiket_staff_select diganti: TO authenticated, tanpa get_my_role lama; tiket_select_own tidak disentuh', () => {
    expect(bare).toMatch(/DROP POLICY IF EXISTS tiket_staff_select ON public\.tiket_antrean/);
    expect(bare).toMatch(
      /CREATE POLICY tiket_staff_select ON public\.tiket_antrean FOR SELECT TO authenticated\s+USING \(public\.boleh_tiket_baca\(kunjungan_id, layanan_id, tanggal\)\)/,
    );
    expect(bare).not.toContain('get_my_role');
    expect(bare).not.toContain('tiket_select_own');
  });

  it('rollback mengembalikan policy 202607290013 dan menghapus fungsi baru', () => {
    expect(rollback).toContain('CREATE POLICY tiket_staff_select ON public.tiket_antrean FOR SELECT');
    expect(rollback).toContain("public.get_my_role() IN ('admin','front_office') OR layanan_id = public.get_my_layanan_id()");
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.boleh_tiket_baca(uuid, uuid, date)');
    expect(rollback).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });
});
