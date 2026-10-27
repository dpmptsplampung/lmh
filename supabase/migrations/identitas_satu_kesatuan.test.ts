// @vitest-environment node
//
// Kontrak statis migrasi 202611010003 (identitas satu kesatuan) dan 202611010004 (backfill). Perilaku sebenarnya diuji di
// scripts/lokal-rantai/skenario-identitas.mjs (PGlite pada skema asli); berkas ini menjaga bentuk SQL.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const baca = (...p: string[]) => readFileSync(join(__dirname, ...p), 'utf8').replace(/\r\n/g, '\n');
const NAMA_UTAMA = '202611010003_identitas_satu_kesatuan.sql';
const NAMA_BACKFILL = '202611010004_backfill_identitas_kunjungan.sql';
const utama = baca(NAMA_UTAMA).replace(/--[^\n]*/g, '');
const backfill = baca(NAMA_BACKFILL).replace(/--[^\n]*/g, '');
const rbUtama = baca('..', '..', 'docs', 'rollback-identitas-satu-kesatuan-202611010003.sql');
const rbBackfill = baca('..', '..', 'docs', 'rollback-backfill-identitas-kunjungan-202611010004.sql');

describe('202611010003_identitas_satu_kesatuan', () => {
  it('terdaftar berurutan sesudah 202611010002 dan menjaga prasyarat', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_UTAMA)).toBe(daftar.indexOf('202611010002_tiket_antrean_lingkup.sql') + 1);
    expect(daftar.indexOf(NAMA_BACKFILL)).toBe(daftar.indexOf(NAMA_UTAMA) + 1);
    for (const p of ['public.pendataan_identitas_validasi(jsonb)', 'public.chat_selesai(uuid,uuid,text)']) {
      expect(utama).toContain(`to_regprocedure('${p}')`);
    }
  });

  it('tidak menghapus/mengubah data (B1): tanpa DELETE/TRUNCATE/DROP TABLE|COLUMN/ALTER TABLE; UPDATE hanya di dalam fungsi', () => {
    expect(utama).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(utama).not.toMatch(/\bTRUNCATE\b/i);
    expect(utama).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/i);
    expect(utama).not.toMatch(/\bALTER\s+TABLE\b/i);
    // Satu-satunya UPDATE kunjungan ada di kunjungan_terapkan_identitas.
    const awal = utama.indexOf('CREATE OR REPLACE FUNCTION public.kunjungan_terapkan_identitas(');
    const akhir = utama.indexOf('$$;', utama.indexOf('AS $$', awal) + 5);
    const diluar = utama.slice(0, awal) + utama.slice(akhir);
    expect(diluar).not.toMatch(/\bUPDATE\s+public\./i);
  });

  it('email_nyata memakai format yang sama dengan validator identitas; nilai pengganti tidak ditulis balik', () => {
    expect(utama).toMatch(/'\^\[a-z0-9\._%\+-\]\+@\[a-z0-9-\]\+\(\\\.\[a-z0-9-\]\+\)\*\\\.\[a-z\]\{2,\}\$'/);
    expect(baca(NAMA_UTAMA)).toContain("'tidak berlaku', 'belum ada', 'tidak ada', 'n/a', 'na')");
  });

  it('trigger formulir: hanya formulir selesai, EMAIL_WAJIB, tulis balik; terpasang di OSS dan Non OSS', () => {
    expect(utama).toContain("NEW.status_draft IS DISTINCT FROM 'selesai'");
    expect(utama).toContain("RAISE EXCEPTION 'EMAIL_WAJIB");
    expect(utama).toMatch(/CREATE TRIGGER trg_oss_identitas AFTER INSERT OR UPDATE ON public\.pelayanan_oss/);
    expect(utama).toMatch(/CREATE TRIGGER trg_perizinan_identitas AFTER INSERT OR UPDATE ON public\.pelayanan_perizinan/);
  });

  it('tiket selesai menuntut email efektif; hanya saat berubah ke selesai', () => {
    expect(utama).toMatch(/BEFORE UPDATE OF status ON public\.tiket_antrean[\s\S]*WHEN \(NEW\.status = 'selesai' AND OLD\.status IS DISTINCT FROM 'selesai'\)/);
    expect(utama).toContain('public.kunjungan_email_efektif(NEW.kunjungan_id) IS NULL');
  });

  it('layanan_selesai_khusus 5 argumen menggantikan 4 argumen; identitas diterapkan sebelum layanan_selesai', () => {
    expect(utama).toContain('DROP FUNCTION IF EXISTS public.layanan_selesai_khusus(uuid, uuid, text, jsonb);');
    const f = utama.slice(utama.indexOf('CREATE OR REPLACE FUNCTION public.layanan_selesai_khusus('));
    expect(f.indexOf('kunjungan_terapkan_identitas')).toBeGreaterThan(-1);
    expect(f.indexOf('kunjungan_terapkan_identitas')).toBeLessThan(f.indexOf('public.layanan_selesai(p_tiket_id'));
    expect(utama).toMatch(/GRANT EXECUTE ON FUNCTION public\.layanan_selesai_khusus\(uuid, uuid, text, jsonb, jsonb\) TO authenticated/);
  });

  it('chat_selesai_khusus: identitas dan email diperiksa sebelum chat_selesai', () => {
    const f = utama.slice(utama.indexOf('CREATE OR REPLACE FUNCTION public.chat_selesai_khusus('));
    expect(f.indexOf('kunjungan_email_efektif')).toBeGreaterThan(-1);
    expect(f.indexOf('kunjungan_email_efektif')).toBeLessThan(f.indexOf('public.chat_selesai(p_sesi_id'));
  });

  it('fungsi internal tidak dapat dipanggil klien; helper RLS tetap SECURITY DEFINER terkunci', () => {
    for (const f of ['kunjungan_email_efektif(uuid)', 'kunjungan_terapkan_identitas(uuid, jsonb, text, jsonb)']) {
      expect(utama).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated`);
    }
    expect((utama.match(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/g) ?? []).length).toBeGreaterThanOrEqual(9);
  });

  it('FO pencatat: hanya membaca (tidak ada policy tulis baru), memakai kunjungan.dibuat_oleh', () => {
    expect(utama.match(/k\.dibuat_oleh = (v_id|me\.id)/g)?.length).toBe(3);
    expect(utama).not.toMatch(/CREATE POLICY/);
  });

  it('rollback: mencabut trigger/fungsi baru dan memulihkan versi lama', () => {
    for (const x of ['trg_tiket_selesai_wajib_email', 'trg_oss_identitas', 'trg_perizinan_identitas']) expect(rbUtama).toContain(`DROP TRIGGER IF EXISTS ${x}`);
    expect(rbUtama).toContain('DROP FUNCTION IF EXISTS public.layanan_selesai_khusus(uuid, uuid, text, jsonb, jsonb);');
    for (const f of ['layanan_selesai_khusus', 'chat_selesai_khusus', 'boleh_penanganan', 'boleh_baca_pendataan', 'boleh_baca_khusus']) {
      expect(rbUtama).toContain(`CREATE OR REPLACE FUNCTION public.${f}(`);
    }
    expect(rbUtama).not.toMatch(/^\s*(BEGIN|COMMIT);/m);
  });
});

describe('202611010004_backfill_identitas_kunjungan', () => {
  it('hanya mengisi kolom kosong dan tidak menyentuh status', () => {
    expect(backfill).toMatch(/CASE WHEN pg_catalog\.btrim\(COALESCE\(k\.email, ''\)\) = '' THEN t\.email END/);
    expect(backfill).toMatch(/COALESCE\(i\.email, k\.email\)/);
    expect(backfill).not.toMatch(/\bstatus\s*=/);
    expect(backfill).toContain("k.nama <> '[anonim]'");
    expect(backfill).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\b/i);
  });
  it('mencatat rincian ke audit_log dan punya rollback yang hanya membalikkan nilai yang sama', () => {
    expect(backfill).toContain("'backfill_identitas_kunjungan'");
    expect(rbBackfill).toContain("a.aksi = 'backfill_identitas_kunjungan'");
    expect(rbBackfill).toMatch(/k\.email = d\.email/);
    expect(rbBackfill).not.toMatch(/^\s*(BEGIN|COMMIT);/m);
  });
});
