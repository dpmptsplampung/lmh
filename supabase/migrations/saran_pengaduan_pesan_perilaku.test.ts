// @vitest-environment node
// Kontrak statis 202611030003: saran + pengaduan dari Pesan Perilaku, SKM lama dihentikan.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const BERKAS = '202611030003_saran_pengaduan_pesan_perilaku.sql';
const sql = readFileSync(join(MIGRATIONS_DIR, BERKAS), 'utf8');
const kode = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('202611030003_saran_pengaduan_pesan_perilaku', () => {
  it('terdaftar dan tanpa kontrol transaksi', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
  });
  it('saran: RLS aktif, hanya admin/front_office membaca, tanpa policy tulis', () => {
    expect(kode).toMatch(/ALTER TABLE public\.saran ENABLE ROW LEVEL SECURITY/);
    expect(kode).toMatch(/CREATE POLICY saran_select_staf ON public\.saran FOR SELECT TO authenticated\s+USING \(public\.peran_saya\(\) IN \('admin', 'front_office'\)\)/);
    expect(kode).not.toMatch(/ON public\.saran FOR (INSERT|UPDATE|DELETE|ALL)/);
  });
  it('RPC anon: SECURITY DEFINER, volatile, REVOKE lalu GRANT eksplisit, satu kali per undangan', () => {
    for (const f of ['kirim_saran(text, text, boolean)', 'kirim_pengaduan_survei(text, text, boolean)', 'lacak_pengaduan_nomor(text)']) {
      expect(kode).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated`);
      expect(kode).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO anon, authenticated`);
    }
    expect(kode).toMatch(/FOR UPDATE;/);
    expect(kode).toContain('saran_dikirim');
    expect(kode).toContain('pengaduan_dikirim');
    expect(kode).toContain("v_u.diisi_pada IS NULL THEN RETURN 'belum_survei'");
  });
  it('pengaduan wizard selalu jalur layanan dan tidak terlihat petugas layanan', () => {
    expect(kode).toContain("'layanan', v_u.layanan_id");
    expect(kode).toMatch(/g\.sumber <> 'wizard'/);
  });
  it('ringkasan hanya admin/front_office; jalur integritas hanya admin', () => {
    expect(kode).toMatch(/ringkasan_pengaduan[\s\S]*= 'admin' OR[\s\S]*= 'front_office' AND p\.jalur = 'layanan'/);
  });
  it('SKM lama: hak anon dicabut', () => {
    expect(kode).toMatch(/REVOKE EXECUTE ON FUNCTION public\.submit_skm_response/);
    expect(kode).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_skm_context/);
  });
});
