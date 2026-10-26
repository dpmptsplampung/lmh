// @vitest-environment node
//
// Kontrak statis migrasi 202610300002 (Fase 4: selesai tiket/chat dengan Pendataan Khusus + identitas chat).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610300002_selesai_dengan_pendataan.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8').replace(/\r\n/g, '\n');
const bare = sql.replace(/--[^\n]*/g, '');
const rekap = readFileSync(join(__dirname, '202610290002_rekap_terpadu.sql'), 'utf8').replace(/--[^\n]*/g, '');

function fungsi(nama: string): string {
  return bare.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
}

describe('202610300002_selesai_dengan_pendataan migration', () => {
  it('terdaftar tepat sesudah 202610300001 dan menjaga prasyaratnya', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_FILE)).toBe(daftar.indexOf('202610300001_pendataan_khusus.sql') + 1);
    expect(bare).toMatch(/to_regprocedure\('public\.pendataan_khusus_simpan\(uuid,uuid,jsonb,uuid\)'\) IS NULL/);
    expect(bare).toMatch(/to_regprocedure\('public\.layanan_selesai\(uuid,text,jsonb,uuid,text\)'\) IS NULL/);
    expect(bare).toMatch(/to_regprocedure\('public\.chat_selesai\(uuid,uuid,text\)'\) IS NULL/);
  });

  it('hanya fungsi baru (aditif); tidak mengganti layanan_selesai/chat_selesai (tanpa salinan, tanpa anti-drift)', () => {
    const atas = bare.replace(/\$\$[\s\S]*?\$\$/g, '');
    expect(atas).not.toMatch(/CREATE TABLE|CREATE POLICY|ALTER TABLE|TRUNCATE|\bDROP\b|\bDELETE\b/i);
    expect(bare).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(layanan_selesai|chat_selesai)\(/);
  });

  it('layanan_selesai_khusus: memanggil layanan_selesai apa adanya lalu menyimpan jawaban pada tahap yang terbentuk', () => {
    const f = fungsi('layanan_selesai_khusus');
    expect(f).toMatch(/VOLATILE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(f).toMatch(/public\.layanan_selesai\(p_tiket_id, NULL::text, NULL::jsonb, p_topik_id, p_catatan\)/);
    // Salinan isi layanan_selesai tidak boleh ada.
    expect(f).not.toMatch(/UPDATE public\.(penanganan|tiket_antrean|kunjungan)/);
    // Hanya bila tahap penanganan terbentuk (tiket lama tanpa tahap: tidak ada Pendataan Khusus).
    expect(f).toMatch(/v_pid IS NOT NULL/);
    expect(f).toMatch(/public\.pendataan_khusus_simpan\(v_pid, v_lyn, p_khusus, v_me\)/);
    expect(f).toMatch(/'khusus_tersimpan'/);
    // Tanpa tahap penanganan: peringatan eksplisit dalam hasil (bukan diam-diam).
    expect(f).toMatch(/'peringatan'/);
  });

  it('chat_selesai_khusus: chat_selesai dulu; identitas dan Khusus sesudahnya dalam transaksi sama; FO tanpa Khusus', () => {
    const f = fungsi('chat_selesai_khusus');
    expect(f).toMatch(/VOLATILE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(f.indexOf('public.chat_selesai(p_sesi_id, p_topik_id, p_catatan)')).toBeGreaterThan(0);
    expect(f.indexOf('public.chat_selesai(')).toBeLessThan(f.indexOf('public.pendataan_identitas_validasi('));
    expect(f.indexOf('public.chat_selesai(')).toBeLessThan(f.indexOf('public.pendataan_khusus_simpan('));
    expect(f).not.toMatch(/UPDATE public\.(penanganan|tiket_antrean|chat_sesi)/);
    // Hanya kolom identitas + updated_at di kunjungan.
    const upd = f.match(/UPDATE public\.kunjungan AS k\s+SET ([\s\S]*?)\s+WHERE/)?.[1] ?? '';
    expect(upd.replace(/\s+/g, ' ')).toBe(
      "nama = COALESCE(v_id ->> 'nama', k.nama), kontak_hp = COALESCE(v_id ->> 'kontak_hp', k.kontak_hp), " +
        "email = COALESCE(v_id ->> 'email', k.email), asal_instansi = COALESCE(v_id ->> 'asal_instansi', k.asal_instansi), " +
        "kategori = COALESCE(v_id ->> 'kategori', k.kategori), keperluan = COALESCE(v_id ->> 'keperluan', k.keperluan), " +
        'updated_at = v_now',
    );
    // Tahap FO (atau tanpa Layanan) menolak jawaban Khusus yang terisi; tahap layanan menyimpan.
    expect(f).toMatch(/KHUSUS_TIDAK_BERLAKU/);
    expect(f).toMatch(/v_peran = 'layanan' AND v_lyn IS NOT NULL/);
    // audit_log (admin-only, tidak dianonimkan job retensi) mencatat nama field + nilai lama/baru agar dapat dipulihkan.
    expect(f).toMatch(/INSERT INTO public\.audit_log \(actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru\)/);
    expect(f).toMatch(/'identitas_diubah'/);
    expect(f).toMatch(/v_lama_j/);
    expect(f).toMatch(/v_baru_j/);
  });

  it('validasi identitas: kunci terbatas dan aturan sama dengan walk-in FO (202610140015)', () => {
    const f = fungsi('pendataan_identitas_validasi');
    expect(f).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    for (const k of ['nama', 'kontak_hp', 'email', 'asal_instansi', 'kategori', 'keperluan']) {
      expect(f, k).toContain(`'${k}'`);
    }
    expect(f).toMatch(/DATA_TIDAK_VALID/);
    expect(f).toMatch(/\^08\[1-9\]\[0-9\]\{7,10\}\$/);
    expect(f).toMatch(/'Umum', 'UMKM', 'Investor', 'Instansi'/);
    expect(f).toMatch(/\^\[a-z0-9\._%\+-\]\+@/);
    expect(f).toMatch(/BETWEEN 3 AND 100/);
    expect(f).toMatch(/BETWEEN 3 AND 120/);
    expect(f).toMatch(/BETWEEN 10 AND 500/);
  });

  it('hak eksekusi: hanya dua RPC selesai untuk authenticated; validasi identitas internal', () => {
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.layanan_selesai_khusus\(uuid, uuid, text, jsonb\) TO authenticated;/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_selesai_khusus\(uuid, uuid, text, jsonb, jsonb\) TO authenticated;/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.pendataan_identitas_validasi\(jsonb\) FROM PUBLIC, anon, authenticated/);
    expect(bare).not.toMatch(/GRANT[^;]*pendataan_identitas_validasi/);
    expect(bare).not.toMatch(/TO anon/);
  });

  it('pin: chat selesai tetap terhitung Live Chat di rekap terpadu Fase 3 (satu definisi dilayani)', () => {
    expect(rekap).toMatch(/CASE WHEN p\.saluran = 'chat' THEN 'live_chat' ELSE 'tatap_muka' END/);
    expect(rekap).toMatch(/WHERE p\.status = 'selesai'/);
  });
});
