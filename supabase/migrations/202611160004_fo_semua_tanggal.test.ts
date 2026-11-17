// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const path = 'supabase/migrations/202611160004_fo_semua_tanggal.sql';
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';

describe('G8 FO membuka daftar semua tanggal', () => {
  it('mengganti hanya dua RPC daftar tanpa jendela tanggal', () => {
    expect(sql).not.toBe('');
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    expect(sql).toContain('public.fo_antrean_daftar(');
    expect(sql).toContain('public.fo_kunjungan_daftar(');
    expect(sql).not.toMatch(/TANGGAL_DILUAR_BATAS|v_hari|v_koord|DROP |CREATE POLICY|ALTER TABLE/i);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });

  it('menjaga sesi, peran aktif, validasi, kolom aman dan paginasi', () => {
    expect(sql.match(/IF NOT public\.sesi_valid\(\)/g)).toHaveLength(2);
    expect(sql.match(/FROM public\.staf_lingkup\(\)/g)).toHaveLength(2);
    expect(sql.match(/v_role NOT IN \('admin', 'front_office'\)/g)).toHaveLength(2);
    expect(sql.match(/SET search_path = pg_catalog, public/g)).toHaveLength(2);
    expect(sql.match(/p_batas NOT BETWEEN 1 AND 200/g)).toHaveLength(2);
    expect(sql.match(/p_lewati NOT BETWEEN 0 AND 2000000/g)).toHaveLength(2);
    expect(sql.match(/LIMIT p_batas OFFSET p_lewati/g)).toHaveLength(2);
    expect(sql).toContain('pg_catalog.char_length(v_cari) > 100');
    expect(sql).toContain('k.status = v_status');
    expect(sql).toContain('t.layanan_id = p_layanan_id');
    expect(sql).toContain("'statistik'");
    expect(sql).toContain("'fo_nama'");
    expect(sql).not.toMatch(/'kontak_hp'|'email'|'catatan'|'qr_token'/);
  });

  it('menjaga signature dan execute hanya authenticated tanpa mengubah RPC ambil pengunjung', () => {
    for (const signature of ['fo_antrean_daftar(date, uuid, integer, integer)', 'fo_kunjungan_daftar(date, integer, integer, text, text)']) {
      expect(sql).toContain('REVOKE ALL ON FUNCTION public.' + signature + ' FROM PUBLIC, anon, authenticated;');
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.' + signature + ' TO authenticated;');
    }
    expect(sql).not.toContain('fo_ambil_pengunjung');
    for (const file of ['202611160001_lingkup_layanan_staf.sql', '202611160002_pendataan_khusus_langkah.sql', '202611160003_buku_tamu_ekspor.sql']) {
      expect(readFileSync('supabase/migrations/' + file, 'utf8')).not.toMatch(/CREATE OR REPLACE FUNCTION public\.fo_(antrean|kunjungan)_daftar/);
    }
  });
});
