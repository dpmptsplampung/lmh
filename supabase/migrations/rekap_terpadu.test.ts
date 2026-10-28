// @vitest-environment node
//
// Kontrak statis migrasi 202610290002 (Fase 3: rekap terpadu). Hanya membaca teks SQL.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610290002_rekap_terpadu.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8').replace(/\r\n/g, '\n');
const bare = sql.replace(/--[^\n]*/g, '');

function fungsi(nama: string): string {
  return bare.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
}

const PUBLIK = ['lingkup_data_saya', 'rekap_data_pelayanan', 'rekap_harian_terpadu', 'rekap_kinerja_petugas'];

describe('202610290002_rekap_terpadu migration', () => {
  it('terdaftar sesudah 202610290001 dan menjaga prasyarat staf_lingkup', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_FILE)).toBe(daftar.indexOf('202610290001_koordinator_akses_data.sql') + 1);
    expect(bare).toMatch(/to_regprocedure\('public\.staf_lingkup\(\)'\) IS NULL/);
  });

  it('hanya fungsi baca: tanpa tabel, policy, atau pernyataan data', () => {
    const atas = bare.replace(/\$\$[\s\S]*?\$\$/g, '');
    expect(atas).not.toMatch(/CREATE TABLE|CREATE POLICY|ALTER TABLE|\bDELETE\b|TRUNCATE|\bDROP\b|\bUPDATE\b|\bINSERT\b/i);
    for (const f of [...PUBLIK, 'rekap_pelayanan_inti']) {
      const isi = fungsi(f);
      expect(isi, f).toMatch(/STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
      expect(isi, f).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
      expect(bare).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
    }
    for (const f of PUBLIK) {
      expect(bare).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated;`));
    }
    // Dasar internal (memuat semua baris lingkup) tidak dapat dipanggil klien langsung.
    expect(bare).not.toMatch(/GRANT[^;]*rekap_pelayanan_inti/);
    expect(bare).not.toMatch(/TO anon/);
  });

  it('definisi dilayani: tahap selesai kecuali Layanan dikembalikan; tiket lama selesai ber-waktu_selesai, non-draf', () => {
    const f = fungsi('rekap_pelayanan_inti');
    expect(f).toMatch(/WHERE p\.status = 'selesai'\s+AND NOT \(p\.peran_tahap = 'layanan' AND p\.hasil = 'dikembalikan'\)\s+AND k\.tanggal BETWEEN p_dari AND p_sampai/);
    expect(f).toMatch(/WHERE t\.status = 'selesai'\s+AND t\.waktu_selesai IS NOT NULL/);
    expect(f).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.penanganan AS p2 WHERE p2\.tiket_id = t\.id\)/);
    expect(f).toMatch(/COALESCE\(o\.status_draft, pz\.status_draft, 'selesai'\) = 'selesai'/);
    expect(f).not.toMatch(/'batal'|'berjalan'|'menunggu'/);
    // Tahap FO 'dieskalasi' tidak dikecualikan.
    expect(f).not.toMatch(/'dieskalasi'/);
  });

  it('kanal live_chat dari saluran chat; unit dari peran tahap', () => {
    const f = fungsi('rekap_pelayanan_inti');
    expect(f).toMatch(/CASE WHEN p\.saluran = 'chat' THEN 'live_chat' ELSE 'tatap_muka' END/);
    expect(f).toMatch(/p\.tahap_ke, p\.peran_tahap, p\.layanan_id/);
  });

  it('lingkup ketat dari staf_lingkup, didorong ke tiap cabang dasar, tanpa jendela operasional', () => {
    const f = fungsi('rekap_pelayanan_inti');
    expect(f).toMatch(/FROM public\.staf_lingkup\(\) AS me/);
    expect(f).toMatch(/IF v_id IS NULL THEN\s+RETURN;/);
    expect(f).toMatch(/v_semua := v_role = 'admin' OR \(v_role = 'front_office' AND v_koord\);/);
    expect(f).toMatch(/v_unit_lyn := CASE WHEN v_role = 'petugas' AND v_koord THEN v_layanan END;/);
    expect(f).toMatch(/AND \(v_semua OR p\.penangan_id = v_id\s+OR \(v_unit_lyn IS NOT NULL AND p\.peran_tahap = 'layanan' AND p\.layanan_id = v_unit_lyn\)\)/);
    expect(f).toMatch(/AND \(v_semua OR COALESCE\(o\.petugas_id, pz\.petugas_id, t\.dilayani_oleh\) = v_id\s+OR \(v_unit_lyn IS NOT NULL AND t\.layanan_id = v_unit_lyn\)\)/);
    // Filter unit/layanan juga di tiap cabang.
    expect(f.match(/p_layanan_id IS NULL OR/g)).toHaveLength(2);
    expect(f).not.toMatch(/kunjungan_operasional|boleh_penanganan|boleh_kunjungan|Asia\/Jakarta/);
    // Tanpa PII/jsonb di dasar.
    expect(f).not.toMatch(/to_jsonb|kontak_hp|email/);
  });

  it('validasi rentang sama dengan aplikasi (maks 366 hari inklusif) dan unit', () => {
    const f = fungsi('rekap_pelayanan_inti');
    expect(f).toMatch(/p_sampai - p_dari >= 366/);
    expect(f).toMatch(/'RENTANG_TIDAK_VALID:/);
    expect(f).toMatch(/'UNIT_TIDAK_VALID:/);
  });

  it('Data Pelayanan: halaman dibatasi (maks 1000), detail hanya untuk halaman, paging keyset, total opsional', () => {
    const f = fungsi('rekap_data_pelayanan');
    expect(f).toMatch(/RETURNS jsonb/);
    expect(f).toMatch(/LEAST\(GREATEST\(COALESCE\(p_batas, 50\), 1\), 1000\)/);
    expect(f).toMatch(/\(i\.tanggal, i\.urut, i\.pelayanan_id\) > \(v_s_tgl, v_s_urut, v_s_id\)/);
    expect(f).toMatch(/LIMIT v_batas OFFSET/);
    // Join detail (PII, Pendataan) setelah LIMIT: dari CTE pilih.
    expect(f.indexOf('FROM pilih AS i')).toBeGreaterThan(f.indexOf('LIMIT v_batas'));
    expect(f).toMatch(/IF p_hitung THEN/);
    expect(f).toMatch(/'berikut', v_akhir/);
    expect(f).toMatch(/- ARRAY\['id', 'tiket_id', 'kunjungan_id', 'petugas_id', 'status_draft', 'is_locked', 'created_at', 'updated_at'\]/);
  });

  it('Rekap Harian dan Kinerja: agregat SQL dalam satu jsonb dari dasar yang sama (tidak terpotong batas baris)', () => {
    for (const f of ['rekap_harian_terpadu', 'rekap_kinerja_petugas']) {
      const isi = fungsi(f);
      expect(isi, f).toMatch(/RETURNS jsonb/);
      expect(isi, f).toMatch(/FROM public\.rekap_pelayanan_inti\(p_dari, p_sampai, p_unit, p_layanan_id\)/);
      expect(isi, f).not.toMatch(/kontak_hp|to_jsonb\(o\)|email/);
    }
    const h = fungsi('rekap_harian_terpadu');
    expect(h).toMatch(/'ringkasan', pg_catalog\.jsonb_build_object\(/);
    expect(h).toMatch(/FILTER \(WHERE d\.kanal = 'live_chat'\)/);
    expect(h).toMatch(/'per_unit'/);
  });
});
