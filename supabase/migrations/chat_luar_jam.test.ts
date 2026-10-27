// @vitest-environment node
//
// Kontrak statis migrasi 202610310002 (Fase 5: status jadwal chat, minta petugas + email berdedup, Q24, tutup otomatis).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610310002_chat_luar_jam.sql';
const baca = (nama: string) => readFileSync(join(__dirname, nama), 'utf8').replace(/\r\n/g, '\n');
const sql = baca(NAMA_FILE);
const bare = sql.replace(/--[^\n]*/g, '');
const rapikan = (s: string) =>
  s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();

function fungsi(nama: string, sumber: string = bare): string {
  return sumber.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?END \\$\\$;|CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
}
/** Fungsi utuh (dari CREATE sampai `END $$;`), dirapikan untuk perbandingan anti-drift. */
function badanRapi(nama: string, sumber: string): string {
  const mulai = sumber.indexOf(`CREATE OR REPLACE FUNCTION public.${nama}(`);
  expect(mulai, `${nama} ada`).toBeGreaterThanOrEqual(0);
  const akhir = sumber.indexOf('END $$;', mulai);
  expect(akhir).toBeGreaterThan(mulai);
  return rapikan(sumber.slice(mulai, akhir + 'END $$;'.length));
}
const buang = (teks: string, blok: string) => {
  const n = rapikan(blok);
  expect(teks.split(n).length - 1, `blok muncul tepat sekali: ${n.slice(0, 60)}`).toBe(1);
  return teks.replace(n, ' ').replace(/\s+/g, ' ').trim();
};

describe('202610310002_chat_luar_jam migration', () => {
  it('terdaftar tepat sesudah 202610310001 dan menjaga prasyaratnya', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_FILE)).toBe(daftar.indexOf('202610310001_chat_lingkup_percakapan.sql') + 1);
    for (const p of [
      'public\\.boleh_chat_sesi\\(uuid\\)',
      'public\\.is_layanan_buka_jadwal\\(uuid,date,time without time zone\\)',
      'public\\.tutup_chat_tertinggal\\(\\)',
      'public\\.chat_pesan_sistem\\(uuid,text,text\\)',
      'public\\.chat_ubah_sesi\\(uuid,text,uuid,uuid\\)',
      'public\\.chat_selesai\\(uuid,uuid,text\\)',
    ]) {
      expect(bare, p).toMatch(new RegExp(`to_regprocedure\\('${p}'\\) IS NULL`));
    }
    expect(bare).toMatch(/email_notifikasi_verified_at/);
  });

  it('aditif (B1): tanpa DELETE/TRUNCATE/DROP, tanpa tabel atau kolom baru', () => {
    expect(bare).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bDROP\b|CREATE TABLE|ALTER TABLE/i);
    expect(bare).not.toMatch(/CREATE POLICY|CREATE TRIGGER/i);
  });

  it('chat_layanan_status: satu fungsi keputusan = jadwal per Layanan (is_layanan_buka_jadwal), dibaca anon', () => {
    const f = fungsi('chat_layanan_status');
    expect(f).toMatch(/STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    // A4 (spec §4.4): jadwal per Layanan = satu-satunya sumber kebenaran; kalender global hari_tanpa_layanan TIDAK dipakai.
    expect(f).toMatch(/v_buka\s+:= public\.is_layanan_buka_jadwal\(p_layanan_id, v_tgl, v_jam\)/);
    expect(f).toMatch(/v_tanpa := NOT public\.is_layanan_buka_jadwal\(p_layanan_id, v_tgl, NULL\)/);
    expect(f).not.toMatch(/hari_tanpa_layanan\(/);
    // Jam WIB, bukan UTC.
    expect(f).toMatch(/AT TIME ZONE 'Asia\/Jakarta'/);
    // Jadwal berikutnya: hanya hari yang buka menurut fungsi yang sama dan bukan hari tanpa pelayanan; maksimal 30 hari.
    expect(f).toMatch(/FOR i IN 0\.\.30 LOOP/);
    expect(f).toMatch(/IF public\.is_layanan_buka_jadwal\(p_layanan_id, d, NULL\) THEN/);
    // Layanan arsip/tidak ada: ada = false.
    expect(f).toMatch(/l\.aktif = true/);
    expect(f).toMatch(/'ada', false/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_layanan_status\(uuid\) TO anon, authenticated, service_role/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.chat_layanan_status\(uuid\) FROM PUBLIC, anon, authenticated/);
  });

  it('chat_minta_petugas: pemilik dari auth.uid(), sesi dikunci sebelum membaca penanda, kode galat kontrak', () => {
    const f = fungsi('chat_minta_petugas');
    expect(f).toMatch(/VOLATILE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(f).toMatch(/v_uid\s+uuid := auth\.uid\(\)/);
    expect(f).toMatch(/p\.auth_user_id = v_uid/);
    expect(f.indexOf('FOR NO KEY UPDATE')).toBeGreaterThan(0);
    expect(f.indexOf('FOR NO KEY UPDATE')).toBeLessThan(f.indexOf("jenis_jawaban = 'minta_petugas_luar_jam'"));
    for (const kode of ['FORBIDDEN', 'LOGIN_GOOGLE', 'NOT_FOUND', 'INVALID_STATUS', 'LAYANAN_TIDAK_VALID', 'PESAN_WAJIB', 'RATE_LIMIT']) {
      expect(f, kode).toContain(`'${kode}:`);
    }
    // Eskalasi hanya lewat chat_ubah_sesi (penjaga CHAT_HARUS_RPC), tidak ada UPDATE langsung.
    expect(f).toMatch(/public\.chat_ubah_sesi\(p_sesi_id, 'eskalasi', NULL\)/);
    expect(f).not.toMatch(/UPDATE public\./);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_minta_petugas\(uuid, boolean\) TO authenticated/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.chat_minta_petugas\(uuid, boolean\) FROM PUBLIC, anon, authenticated/);
  });

  it('chat_minta_petugas: pesan tunggu persis spec, email hanya di luar jam, dedup per sesi per penerima', () => {
    const f = fungsi('chat_minta_petugas');
    expect(f).toContain("'Mohon menunggu respon dari petugas; petugas akan menjawab pada jam kerja.'");
    // Penanda sesi diperiksa SEBELUM menulis pesan/email dan pesan luar jam hanya di cabang tutup.
    const cabangTutup = f.slice(f.indexOf('ELSE\n    IF v_sudah THEN'));
    expect(cabangTutup).toMatch(/minta_petugas_luar_jam/);
    expect(cabangTutup).toMatch(/INSERT INTO public\.notifikasi/);
    const cabangBuka = f.slice(f.indexOf('IF v_buka THEN'), f.indexOf('ELSE\n    IF v_sudah THEN'));
    expect(cabangBuka).not.toMatch(/notifikasi/);
    // A3: dedup per PERCAKAPAN (pengunjung + Layanan) dan hari buka berikutnya, bukan per sesi.
    expect(f).toMatch(/pg_catalog\.format\('chat_minta_petugas:%s:%s:%s:%s', v_s\.pengunjung_id, v_s\.layanan_id,/);
    expect(f).toMatch(/v_status ->> 'buka_berikutnya_tanggal'/);
    expect(f).not.toMatch(/chat_minta_petugas:%s:%s', p_sesi_id/);
    expect(f).toMatch(/ON CONFLICT \(idempotency_key\) WHERE idempotency_key IS NOT NULL DO NOTHING/);
    // Penerima: petugas Layanan aktif ber-email terverifikasi; FO hanya bila tidak ada.
    expect(f).toMatch(/p\.role = 'petugas' AND p\.layanan_id = v_s\.layanan_id/);
    expect(f).toMatch(/p\.email_notifikasi_verified_at IS NOT NULL/);
    expect(f).toMatch(/p\.role = 'front_office'\s+AND NOT EXISTS/);
    expect(f).toMatch(/p\.aktif = true/);
    // Email tanpa PII pengunjung: tidak membaca nama/kontak/isi pesan pengunjung.
    // Subjek + isi email saja (kunci dedup memakai pengunjung_id, bukan isi email).
    const email = f.slice(f.indexOf('INSERT INTO public.notifikasi'), f.indexOf("pg_catalog.jsonb_build_object('type', 'chat_minta_petugas'"));
    expect(email).not.toMatch(/kontak_pengunjung|\.isi\b|pengunjung_id|\.nama\b.*pengunjung|no_hp/);
    expect(email).toMatch(/\/admin\/chat\?sesi=%s/);
  });

  it('A3 anti-banjir: JWT anonim ditolak di server dan sesi tanpa pesan pengunjung tidak memicu apa pun', () => {
    const f = fungsi('chat_minta_petugas');
    expect(f).toMatch(/COALESCE\(\(auth\.jwt\(\) ->> 'is_anonymous'\)::boolean, false\)/);
    expect(f.indexOf("'LOGIN_GOOGLE:")).toBeGreaterThan(f.indexOf('auth.jwt()'));
    // Anonim ditolak SEBELUM membaca/menulis sesi apa pun.
    expect(f.indexOf('auth.jwt()')).toBeLessThan(f.indexOf('FOR NO KEY UPDATE'));
    // >= 1 pesan pengunjung di sesi: eksplisit -> PESAN_WAJIB, implisit -> noop; sebelum eskalasi/pembatas laju/email.
    const i = f.indexOf("m.pengirim = 'pengunjung'");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(f.indexOf('chat_ubah_sesi'));
    expect(i).toBeLessThan(f.indexOf('INSERT INTO public.anon_rate_limit'));
    expect(i).toBeLessThan(f.indexOf('INSERT INTO public.notifikasi'));
    expect(f).toMatch(/IF p_eksplisit THEN\s+RAISE EXCEPTION 'PESAN_WAJIB:/);
  });

  it('chat_minta_petugas: panggilan implisit tidak menaikkan sesi bot dan tanpa pembatas laju; eksplisit dibatasi 5/60 dtk', () => {
    const f = fungsi('chat_minta_petugas');
    expect(f).toMatch(/IF NOT p_eksplisit AND \(v_s\.status <> 'eskalasi' OR v_buka OR v_sudah\) THEN/);
    expect(f).toMatch(/IF p_eksplisit THEN[\s\S]*?>= 5 THEN/);
    expect(f).toMatch(/INTERVAL '60 seconds'/);
    expect(f).toMatch(/INSERT INTO public\.anon_rate_limit \(user_id, action\) VALUES \(v_uid, 'chat_minta_petugas'\)/);
  });

  it('chat_selesai: salinan 202610140009 kecuali blok pesan penutup (kalimat survei dihapus, jenis dipertahankan)', () => {
    const sumber = badanRapi('chat_selesai', baca('202610140009_chat_online.sql'));
    const baru = badanRapi('chat_selesai', sql);
    const LAMA = `v_pesan := public.chat_pesan_sistem(p_sesi_id,
    'Sesi chat telah selesai. Terima kasih telah menghubungi DPMPTSP Provinsi Lampung. '
    || 'Tautan survei kepuasan layanan akan disediakan di sini.',
    'penutup_survei');`;
    const BARU = `v_pesan := public.chat_pesan_sistem(p_sesi_id,
    'Sesi chat telah selesai. Terima kasih telah menghubungi DPMPTSP Provinsi Lampung.',
    'penutup_survei');`;
    expect(buang(sumber, LAMA)).toBe(buang(baru, BARU));
    expect(bare).not.toMatch(/Tautan survei/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_selesai\(uuid, uuid, text\) TO authenticated/);
  });

  it('tutup_chat_tertinggal: salinan 202610140012 kecuali predikat pemilih (hari operasional penuh) dan teks pesan tutup', () => {
    const sumber = badanRapi('tutup_chat_tertinggal', baca('202610140012_perbaikan_review.sql'));
    const baru = badanRapi('tutup_chat_tertinggal', sql);
    const AKTIVITAS = `GREATEST(s.created_at,
      COALESCE((SELECT pg_catalog.max(m.created_at) FROM public.chat_pesan AS m WHERE m.sesi_id = s.id), s.created_at))`;
    const PREDIKAT_BARU = `AND (s.status = 'aktif'
      OR public.chat_ada_hari_kerja_sejak(s.layanan_id, ${AKTIVITAS}))`;
    const TEKS_LAMA = `'Sesi chat ini ditutup otomatis karena tidak ada aktivitas lebih dari 24 jam. '
      || 'Silakan mulai chat baru bila masih memerlukan bantuan.');`;
    const TEKS_BARU = `'Sesi chat ini ditutup otomatis karena tidak ada aktivitas lebih dari 24 jam. '
      || 'Anda dapat melanjutkan percakapan kapan saja dengan mengirim pesan baru.');`;
    expect(buang(buang(sumber, TEKS_LAMA), 'ORDER BY s.created_at, s.id')).toBe(
      buang(buang(buang(baru, PREDIKAT_BARU), TEKS_BARU), 'ORDER BY s.created_at, s.id'),
    );
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.tutup_chat_tertinggal\(\) TO service_role/);
  });

  it('chat_ada_hari_kerja_sejak: hanya hari sesudah aktivitas, memakai fungsi jadwal yang sama, batas aman 14 hari', () => {
    const f = fungsi('chat_ada_hari_kerja_sejak');
    expect(f).toMatch(/v_awal < v_hari_ini - 14/);
    expect(f).toMatch(/d := v_awal \+ 1/);
    expect(f).toMatch(/IF public\.is_layanan_buka_jadwal\(p_layanan, d, NULL\) THEN/);
    expect(f).not.toMatch(/hari_tanpa_layanan/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_ada_hari_kerja_sejak\(uuid, timestamptz\) TO service_role/);
  });

  it('pin: kanal Live Chat rekap (Fase 3) dan chat_selesai_khusus (Fase 4) tak berubah', () => {
    expect(bare).not.toMatch(/FUNCTION public\.(chat_selesai_khusus|rekap_pelayanan_inti|chat_ambil|chat_teruskan)\(/);
    expect(baca('202610290002_rekap_terpadu.sql')).toMatch(/p\.saluran = 'chat' THEN 'live_chat'/);
    expect(baca('202610300002_selesai_dengan_pendataan.sql')).toMatch(/public\.chat_selesai\(p_sesi_id, p_topik_id, p_catatan\)/);
  });
});
