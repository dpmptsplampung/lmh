// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

// 202611030013 = Poin 5 (Saran dan Pengaduan, keputusan pemilik .tim/produk/MASUKAN.md):
// penangan pengaduan + riwayat penangan, SLA hari kerja di server, saran ditinjau, lencana.
const BERKAS = '202611030013_masukan_pengunjung.sql';
const ROLLBACK = '../../docs/rollback-masukan-pengunjung-202611030013.sql';

function baca(relatif: string) {
  return readFileSync(join(MIGRATIONS_DIR, relatif), 'utf8');
}

function kode(sql: string) {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
}

function fungsi(sql: string, nama: string) {
  const definisi = sql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'),
  );
  expect(definisi, `definisi ${nama}`).not.toBeNull();
  return definisi![0];
}

function view(sql: string, nama: string) {
  const definisi = sql.match(new RegExp(`CREATE OR REPLACE VIEW public\\.${nama}[\\s\\S]*?;`, 'i'));
  expect(definisi, `view ${nama}`).not.toBeNull();
  return definisi![0];
}

const RPC_KLIEN = [
  'tangani_pengaduan(uuid)',
  'ambil_alih_pengaduan(uuid, text)',
  'linimasa_pengaduan(uuid)',
  'ringkasan_pengaduan_kerja(text)',
  'tandai_saran_ditinjau(uuid[], boolean)',
  'tandai_semua_saran_ditinjau(timestamptz, uuid, text, text, text)',
  'jumlah_saran_belum_ditinjau()',
];

describe('202611030013 masukan pengunjung (saran dan pengaduan)', () => {
  const sql = baca(BERKAS);
  const k = kode(sql);

  it('PRASYARAT hanya objek yang sudah di produksi dan tanpa BEGIN/COMMIT', () => {
    const prasyarat = sql.slice(0, sql.indexOf('ALTER TABLE'));
    for (const rpc of [
      'public.staf_saya()',
      'public.peran_saya()',
      'public.sesi_valid()',
      'public.boleh_layanan(uuid)',
    ]) {
      expect(prasyarat).toContain(`to_regprocedure('${rpc}')`);
    }
    for (const kolom of [
      'pengaduan.status',
      'pengaduan.jalur',
      'pengaduan.anonim',
      'pengaduan.sumber',
      'pengaduan.pelapor_nama',
      'pengaduan.batas_verifikasi',
      'pengaduan.batas_penanganan',
      'pengaduan_riwayat.diubah_oleh',
      'saran.created_at',
      'saran.unit',
      'petugas.nama',
      'hari_libur.tanggal',
      'audit_log.detail',
    ]) {
      expect(prasyarat).toContain(`'${kolom}'`);
    }
    expect(prasyarat).toContain("to_regclass('public.v_pengaduan_petugas')");
    expect(prasyarat).toMatch(/RAISE EXCEPTION 'PRASYARAT:/);
    // Tidak bergantung pada migrasi yang belum diterapkan (0006/0008/0010/0011).
    expect(kode(prasyarat)).not.toMatch(/pelapor_email|pengaduan_tanggapan|kirim_pengaduan_publik|jaga_pengaduan_anonim/);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });

  it('aditif: tanpa DROP TABLE/COLUMN, TRUNCATE, DELETE, atau perubahan RLS tiket/kunjungan', () => {
    expect(k).not.toMatch(/DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM/i);
    expect(k).not.toMatch(/ON public\.(tiket_antrean|kunjungan)\b/i);
    expect(k).not.toMatch(/diteruskan_ke/);
  });

  it('kolom baru pengaduan, riwayat, dan saran beserta CHECK dan indeks', () => {
    expect(k).toMatch(/ADD COLUMN IF NOT EXISTS penangan_id uuid REFERENCES public\.petugas\(id\) ON DELETE SET NULL/);
    expect(k).toMatch(/ADD COLUMN IF NOT EXISTS penangan_sejak timestamptz/);
    expect(k).toMatch(/pengaduan_riwayat ADD COLUMN IF NOT EXISTS jenis text NOT NULL DEFAULT 'status'/);
    expect(k).toMatch(/CHECK \(jenis IN \('status', 'tangani', 'ambil_alih', 'otomatis'\)\)/);
    expect(k).toMatch(/ADD COLUMN IF NOT EXISTS penangan_lama uuid REFERENCES public\.petugas\(id\) ON DELETE SET NULL/);
    expect(k).toMatch(/ADD COLUMN IF NOT EXISTS penangan_baru uuid REFERENCES public\.petugas\(id\) ON DELETE SET NULL/);
    expect(k).toMatch(/saran ADD COLUMN IF NOT EXISTS ditinjau_pada timestamptz/);
    expect(k).toMatch(/saran ADD COLUMN IF NOT EXISTS ditinjau_oleh uuid REFERENCES public\.petugas\(id\) ON DELETE SET NULL/);
    expect(k).toMatch(/CHECK \(ditinjau_oleh IS NULL OR ditinjau_pada IS NOT NULL\)/);
    expect(k).toMatch(/CHECK \(penangan_id IS NULL OR penangan_sejak IS NOT NULL\)/);
    expect(k).toMatch(/CREATE INDEX IF NOT EXISTS saran_belum_ditinjau ON public\.saran \(created_at DESC\) WHERE ditinjau_pada IS NULL/);
    expect(k).toMatch(/CREATE INDEX IF NOT EXISTS pengaduan_penangan ON public\.pengaduan \(penangan_id\) WHERE penangan_id IS NOT NULL/);
  });

  it('hari kerja dihitung di server: Senin-Jumat dan hari_libur, STABLE (membaca tabel)', () => {
    const f = fungsi(k, 'hari_kerja_antara');
    expect(f).toMatch(/RETURNS integer/);
    expect(f).toMatch(/STABLE/);
    expect(f).not.toMatch(/IMMUTABLE/);
    expect(f).toMatch(/ISODOW/);
    expect(f).toMatch(/public\.hari_libur/);
  });

  it('SLA: batas aktif per status, mendekati <= 2 hari kerja, tertutup tanpa SLA, hari ini WIB', () => {
    const f = fungsi(k, 'pengaduan_sla');
    expect(f).toMatch(/Asia\/Jakarta/);
    expect(f).toMatch(/WHEN p_status = 'baru' THEN p_batas_verifikasi/);
    expect(f).toMatch(/WHEN p_status IN \('diverifikasi', 'diproses', 'eskalasi'\) THEN p_batas_penanganan/);
    expect(f).toMatch(/BETWEEN 0 AND 2 THEN 'mendekati'/);
    expect(f).toMatch(/'terlambat'/);
    expect(f).toMatch(/'arsip'/);
  });

  it('v_pengaduan_kerja security_invoker (RLS tabel berlaku), tanpa identitas pelapor anonim', () => {
    const v = view(k, 'v_pengaduan_kerja');
    expect(v).toMatch(/WITH \(security_invoker = true\)/);
    expect(v).toMatch(/CASE WHEN g\.anonim THEN NULL ELSE g\.pelapor_nama END AS pelapor_nama/);
    expect(v).toMatch(/bisa_dihubungi/);
    // pelapor_email (0006) dibaca tanpa ketergantungan statis.
    expect(v).toMatch(/to_jsonb\(g\) ->> 'pelapor_email'/);
    for (const kol of ['layanan_nama', 'penangan_nama', 'penangan_sejak', 'batas_aktif', 'sisa_hari_kerja', 'sla_status', 'kelompok', 'urutan_kerja', 'terbuka']) {
      expect(v).toContain(kol);
    }
    expect(v).not.toMatch(/\bg\.kontak\s+AS|\bg\.kontak,|undangan_id|kunjungan_id|sesi_chat_id/);
    expect(k).toMatch(/REVOKE ALL ON public\.v_pengaduan_kerja FROM PUBLIC, anon, authenticated;/);
    expect(k).toMatch(/GRANT SELECT ON public\.v_pengaduan_kerja TO authenticated;/);
  });

  it('v_pengaduan_petugas: definisi 0003 utuh + kolom SLA di akhir', () => {
    const v = view(k, 'v_pengaduan_petugas');
    expect(v).toMatch(
      /SELECT g\.id, g\.nomor_tiket, g\.jalur, g\.layanan_id, g\.isi, g\.anonim, g\.status,\s+g\.batas_verifikasi, g\.batas_penanganan, g\.created_at, g\.updated_at,\s+s\.terbuka, s\.kelompok, s\.batas_aktif, s\.sisa_hari_kerja, s\.sla_status, s\.urutan_kerja/,
    );
    expect(v).toMatch(/WHERE g\.jalur = 'layanan' AND g\.sumber <> 'wizard' AND public\.peran_saya\(\) = 'petugas' AND public\.boleh_layanan\(g\.layanan_id\)/);
    expect(v).not.toMatch(/penangan_|kontak|pelapor/);
  });

  it('penangan hanya lewat RPC: penjaga UPDATE pengaduan dan INSERT riwayat non-status', () => {
    const jaga = fungsi(k, 'jaga_penangan_pengaduan');
    expect(jaga).toMatch(/PENANGAN_LEWAT_RPC/);
    expect(jaga).toMatch(/current_setting\('lmh\.penangan_rpc', true\)/);
    // Hapus petugas (FK ON DELETE SET NULL) tetap lolos.
    expect(jaga).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.petugas AS pt WHERE pt\.id = OLD\.penangan_id\)/);
    expect(k).toMatch(/CREATE TRIGGER trg_pengaduan_penangan\s+BEFORE UPDATE ON public\.pengaduan/);
    const jagaR = fungsi(k, 'jaga_riwayat_penangan');
    expect(jagaR).toMatch(/NEW\.jenis <> 'status'/);
    expect(jagaR).toMatch(/PENANGAN_LEWAT_RPC/);
    expect(k).toMatch(/CREATE TRIGGER trg_riwayat_penangan\s+BEFORE INSERT ON public\.pengaduan_riwayat/);
  });

  it('otomatis: ubah status oleh Admin/FO saat penangan kosong mengisi penangan (riwayat otomatis); cron tidak', () => {
    const jaga = fungsi(k, 'jaga_penangan_pengaduan');
    expect(jaga).toMatch(/NEW\.status IS DISTINCT FROM OLD\.status AND NEW\.penangan_id IS NULL/);
    expect(jaga).toMatch(/FROM public\.staf_saya\(\)/);
    expect(jaga).toMatch(/v_role = 'admin' OR \(v_role = 'front_office' AND NEW\.jalur = 'layanan'\)/);
    expect(jaga).toMatch(/'otomatis'/);
    // Status non-status tidak menimpa waktu: status_lama tidak NULL (pemicu anonim 0010 hanya untuk riwayat awal).
    expect(jaga).toMatch(/OLD\.status, NEW\.status/);
  });

  it('tangani_pengaduan: Admin/FO aktif, sesi, integritas hanya Admin, idempoten, kunci baris, audit', () => {
    const f = fungsi(k, 'tangani_pengaduan');
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/SET search_path = pg_catalog, public/);
    expect(f).toMatch(/FROM public\.staf_saya\(\)/);
    expect(f).toMatch(/NOT IN \('admin', 'front_office'\)/);
    expect(f).toMatch(/public\.sesi_valid\(\)/);
    expect(f).toMatch(/FOR UPDATE/);
    expect(f).toMatch(/jalur <> 'layanan'/);
    expect(f).toMatch(/'berubah', false/);
    expect(f).toMatch(/PENANGAN_SUDAH_ADA/);
    expect(f).toMatch(/PENGADUAN_DITUTUP/);
    expect(f).toMatch(/TIDAK_DITEMUKAN/);
    expect(f).toMatch(/'tangani'/);
    expect(f).toMatch(/INSERT INTO public\.audit_log/);
    expect(f).toMatch(/set_config\('lmh\.penangan_rpc', 'on', true\)/);
    expect(f).toMatch(/set_config\('lmh\.penangan_rpc', 'off', true\)/);
  });

  it('ambil_alih_pengaduan: alasan 5-500, penangan kosong ditolak, riwayat dan audit memuat penangan lama', () => {
    const f = fungsi(k, 'ambil_alih_pengaduan');
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/NOT IN \('admin', 'front_office'\)/);
    expect(f).toMatch(/public\.sesi_valid\(\)/);
    expect(f).toMatch(/ALASAN_WAJIB/);
    expect(f).toMatch(/< 5 OR .*> 500/);
    expect(f).toMatch(/PENANGAN_KOSONG/);
    expect(f).toMatch(/PENGADUAN_DITUTUP/);
    expect(f).toMatch(/'ambil_alih'/);
    expect(f).toMatch(/penangan_lama/);
    expect(f).toMatch(/INSERT INTO public\.audit_log/);
  });

  it('linimasa_pengaduan: Admin/FO, tanggapan 0006 dibaca hanya bila tabelnya ada, tanpa identitas pelapor', () => {
    const f = fungsi(k, 'linimasa_pengaduan');
    expect(f).toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/NOT IN \('admin', 'front_office'\)/);
    expect(f).toMatch(/to_regclass\('public\.pengaduan_tanggapan'\) IS NOT NULL/);
    expect(f).toMatch(/to_regclass\('public\.pengaduan_lampiran'\) IS NOT NULL/);
    for (const kunci of ["'jenis', 'status'", "'jenis', 'tanggapan'", "'jenis', 'penangan'", "'oleh_nama'", "'dari_nama'", "'ke_nama'", "'alasan'", "'lampiran'"]) {
      expect(f).toContain(kunci);
    }
    expect(f).not.toMatch(/kontak|pelapor_nama|pelapor_email|kunjungan_id|undangan_id/);
  });

  it('ringkasan_pengaduan_kerja: SECURITY INVOKER dari v_pengaduan_kerja (RLS), validasi jalur', () => {
    const f = fungsi(k, 'ringkasan_pengaduan_kerja');
    expect(f).not.toMatch(/SECURITY DEFINER/);
    expect(f).toMatch(/FROM public\.v_pengaduan_kerja/);
    for (const kunci of ["'baru'", "'diproses'", "'mendekati'", "'terlambat'", "'selesai'", "'ditolak'", "'terbuka'"]) {
      expect(f).toContain(kunci);
    }
    expect(f).toMatch(/MASUKAN_TIDAK_VALID/);
  });

  it('saran ditinjau: RPC Admin/FO aktif + sesi + audit; batas 500 ID; tandai semua dibatasi p_sebelum', () => {
    const satu = fungsi(k, 'tandai_saran_ditinjau');
    expect(satu).toMatch(/SECURITY DEFINER/);
    expect(satu).toMatch(/NOT IN \('admin', 'front_office'\)/);
    expect(satu).toMatch(/public\.sesi_valid\(\)/);
    expect(satu).toMatch(/> 500/);
    expect(satu).toMatch(/INSERT INTO public\.audit_log/);
    const semua = fungsi(k, 'tandai_semua_saran_ditinjau');
    expect(semua).toMatch(/SECURITY DEFINER/);
    expect(semua).toMatch(/NOT IN \('admin', 'front_office'\)/);
    expect(semua).toMatch(/created_at <= LEAST\(p_sebelum, pg_catalog\.now\(\)\)/);
    expect(semua).toMatch(/ditinjau_pada IS NULL/);
    expect(semua).toMatch(/IN \('wizard', 'publik', 'impor'\)/);
    expect(semua).toMatch(/IN \('layanan', 'fo', 'tidak_diketahui'\)/);
    expect(semua).toMatch(/ILIKE .* ESCAPE/);
    expect(semua).toMatch(/INSERT INTO public\.audit_log/);
    const jumlah = fungsi(k, 'jumlah_saran_belum_ditinjau');
    expect(jumlah).not.toMatch(/SECURITY DEFINER/);
    expect(jumlah).toMatch(/WHERE s\.ditinjau_pada IS NULL/);
  });

  it('hak: RPC klien hanya authenticated; helper internal tanpa hak klien', () => {
    for (const rpc of RPC_KLIEN) {
      const nama = rpc.replace(/[()[\]]/g, (c) => `\\${c}`);
      expect(k).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${nama} FROM PUBLIC, anon, authenticated;`));
      expect(k).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${nama} TO authenticated;`));
    }
    for (const internal of ['jaga_penangan_pengaduan()', 'jaga_riwayat_penangan()']) {
      const nama = internal.replace(/[()]/g, (c) => `\\${c}`);
      expect(k).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${nama} FROM PUBLIC, anon, authenticated;`));
      expect(k).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${nama}`));
    }
  });

  it('rollback ada, tanpa BEGIN/COMMIT, menolak bila data baru ada kecuali lmh.rollback_paksa', () => {
    const jalur = join(MIGRATIONS_DIR, ROLLBACK);
    expect(existsSync(jalur)).toBe(true);
    const rb = baca(ROLLBACK);
    expect(mengandungKontrolTransaksi(rb)).toBe(false);
    expect(rb).toMatch(/lmh\.rollback_paksa/);
    for (const obj of [
      'DROP FUNCTION IF EXISTS public.tangani_pengaduan(uuid)',
      'DROP FUNCTION IF EXISTS public.ambil_alih_pengaduan(uuid, text)',
      'DROP FUNCTION IF EXISTS public.linimasa_pengaduan(uuid)',
      'DROP FUNCTION IF EXISTS public.ringkasan_pengaduan_kerja(text)',
      'DROP FUNCTION IF EXISTS public.tandai_saran_ditinjau(uuid[], boolean)',
      'DROP FUNCTION IF EXISTS public.tandai_semua_saran_ditinjau(timestamptz, uuid, text, text, text)',
      'DROP FUNCTION IF EXISTS public.jumlah_saran_belum_ditinjau()',
      'DROP VIEW IF EXISTS public.v_pengaduan_kerja',
      'DROP TRIGGER IF EXISTS trg_pengaduan_penangan ON public.pengaduan',
      'DROP TRIGGER IF EXISTS trg_riwayat_penangan ON public.pengaduan_riwayat',
    ]) {
      expect(rb).toContain(obj);
    }
    // v_pengaduan_petugas dipulihkan ke definisi 0003 (tanpa kolom SLA).
    expect(rb).toMatch(/CREATE VIEW public\.v_pengaduan_petugas AS\s+SELECT g\.id, g\.nomor_tiket, g\.jalur, g\.layanan_id, g\.isi, g\.anonim, g\.status,\s+g\.batas_verifikasi, g\.batas_penanganan, g\.created_at, g\.updated_at\s+FROM/);
    expect(rb).toMatch(/GRANT SELECT ON public\.v_pengaduan_petugas TO authenticated/);
  });
});
