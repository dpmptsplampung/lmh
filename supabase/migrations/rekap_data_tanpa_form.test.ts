// @vitest-environment node
//
// Kontrak statis migrasi 202611010005 (Data Pelayanan = Layanan lain; Helpdesk OSS / Non OSS punya tab sendiri). Perilaku
// sebenarnya diuji di scripts/lokal-rantai/skenario-akses-data.mjs (PGlite pada skema asli); berkas ini menjaga bentuk SQL.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202611010005_rekap_data_tanpa_form.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8').replace(/\r\n/g, '\n');
const bare = sql.replace(/--[^\n]*/g, '');
const rollback = readFileSync(join(__dirname, '..', '..', 'docs', 'rollback-rekap-data-tanpa-form-202611010005.sql'), 'utf8');
const rollbackBare = rollback.replace(/--[^\n]*/g, '');
const aslinya = readFileSync(join(__dirname, '202610290002_rekap_terpadu.sql'), 'utf8').replace(/\r\n/g, '\n');

const TANDA_8 = 'date, date, text, uuid, integer, integer, jsonb, boolean';
const TANDA_9 = `${TANDA_8}, boolean`;

describe('202611010005_rekap_data_tanpa_form migration', () => {
  it('terdaftar tepat sesudah 202611010004 dan menjaga prasyarat (rekap terpadu + layanan.form_pendataan)', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_FILE)).toBe(daftar.indexOf('202611010004_backfill_identitas_kunjungan.sql') + 1);
    expect(bare).toContain("to_regprocedure('public.rekap_pelayanan_inti(date,date,text,uuid)')");
    expect(bare).toContain("to_regprocedure('public.rekap_data_pelayanan(date,date,text,uuid,integer,integer,jsonb,boolean)')");
    expect(bare).toContain("attname = 'form_pendataan'");
  });

  it('B1: aditif terhadap data (hanya mengganti satu fungsi baca)', () => {
    expect(bare).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(bare).not.toMatch(/\bTRUNCATE\b/i);
    expect(bare).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i);
    expect(bare).not.toMatch(/\bUPDATE\s+public\./i);
    expect(bare).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(bare.match(/\bDROP FUNCTION\b/gi)).toHaveLength(1);
  });

  it('tanda tangan 8 argumen lama di-DROP, versi 9 argumen dibuat dengan p_tanpa_form DEFAULT false', () => {
    expect(bare).toContain(`DROP FUNCTION IF EXISTS public.rekap_data_pelayanan(${TANDA_8});`);
    expect(bare).toMatch(/CREATE FUNCTION public\.rekap_data_pelayanan\(/);
    expect(bare).toMatch(/p_hitung\s+boolean DEFAULT false,\s+p_tanpa_form boolean DEFAULT false\s*\)/);
    // Urutan: DROP lama dulu, baru CREATE baru (tidak ada dua tanda tangan yang ambigu).
    expect(bare.indexOf('DROP FUNCTION')).toBeLessThan(bare.indexOf('CREATE FUNCTION'));
  });

  it('SECURITY DEFINER terkunci, hanya authenticated, tanpa GRANT ke anon/PUBLIC', () => {
    expect(bare).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(bare).toContain(`REVOKE ALL ON FUNCTION public.rekap_data_pelayanan(${TANDA_9}) FROM PUBLIC, anon, authenticated;`);
    expect(bare).toContain(`GRANT EXECUTE ON FUNCTION public.rekap_data_pelayanan(${TANDA_9}) TO authenticated;`);
    expect(bare).not.toMatch(/GRANT EXECUTE[^;]*\bTO\s+(anon|PUBLIC)\b/i);
  });

  it('filter berlaku di total DAN di halaman, hanya untuk unit layanan, NULL = FALSE, FO tidak pernah dikecualikan', () => {
    const syarat =
      "p_tanpa_form IS NOT TRUE OR i.unit <> 'layanan'\n           OR NOT EXISTS (SELECT 1 FROM public.layanan AS lf WHERE lf.id = i.layanan_id AND lf.form_pendataan IS NOT NULL)";
    expect(bare.split(syarat)).toHaveLength(3); // dua pemakaian: hitung total + pilih halaman
    expect(bare).toContain('(v_s_id IS NULL OR (i.tanggal, i.urut, i.pelayanan_id) > (v_s_tgl, v_s_urut, v_s_id))');
  });

  it('lingkup tidak dilonggarkan: tetap lewat rekap_pelayanan_inti, tidak memakai service role atau melewati lingkup', () => {
    expect(bare.match(/public\.rekap_pelayanan_inti\(p_dari, p_sampai, p_unit, p_layanan_id\)/g)).toHaveLength(2);
    expect(bare).not.toMatch(/service_role/i);
  });

  it('badan fungsi sama dengan 202610290002 selain filter (tidak ada perubahan diam-diam pada kolom/ penggabungan)', () => {
    const ambilDetail = (teks: string) => {
      const dari = teks.indexOf('detail AS (');
      return teks.slice(dari, teks.indexOf('RETURN pg_catalog.jsonb_build_object', dari));
    };
    expect(ambilDetail(bare)).toBe(ambilDetail(aslinya.replace(/--[^\n]*/g, '')));
  });

  it('rollback mengembalikan fungsi 8 argumen dan menghapus versi 9 argumen', () => {
    expect(rollback).toContain(`DROP FUNCTION IF EXISTS public.rekap_data_pelayanan(${TANDA_9});`);
    expect(rollback).toMatch(/CREATE OR REPLACE FUNCTION public\.rekap_data_pelayanan\(/);
    expect(rollbackBare).not.toContain('p_tanpa_form');
    expect(rollback).toContain(`GRANT EXECUTE ON FUNCTION public.rekap_data_pelayanan(${TANDA_8}) TO authenticated;`);
    expect(rollbackBare.indexOf('DROP FUNCTION')).toBeLessThan(rollbackBare.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(rollback).not.toMatch(/^\s*(BEGIN|COMMIT);/im);
  });
});
