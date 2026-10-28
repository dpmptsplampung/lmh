// @vitest-environment node
//
// Kontrak statis migrasi 202610310001 (Fase 5: lingkup baca chat staf + daftar percakapan pengunjung).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610310001_chat_lingkup_percakapan.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8').replace(/\r\n/g, '\n');
const bare = sql.replace(/--[^\n]*/g, '');
const baca = (nama: string) => readFileSync(join(__dirname, nama), 'utf8').replace(/\r\n/g, '\n').replace(/--[^\n]*/g, '');

function fungsi(nama: string): string {
  return bare.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
}
function policy(nama: string, tabel: string): string {
  return bare.match(new RegExp(`CREATE POLICY "${nama}" ON public\\.${tabel}[\\s\\S]*?;`, 'i'))?.[0] ?? '';
}

describe('202610310001_chat_lingkup_percakapan migration', () => {
  it('terdaftar tepat sesudah 202610300002 dan menjaga prasyaratnya', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_FILE)).toBe(daftar.indexOf('202610300002_selesai_dengan_pendataan.sql') + 1);
    expect(bare).toMatch(/to_regprocedure\('public\.staf_lingkup\(\)'\) IS NULL/);
    expect(bare).toMatch(/to_regprocedure\('public\.chat_sesi_ringkas\(integer,boolean\)'\) IS NULL/);
    expect(bare).toMatch(/to_regclass\('public\.chat_sesi'\) IS NULL/);
  });

  it('aditif (B1): tanpa DELETE/TRUNCATE/DROP TABLE|COLUMN/UPDATE data, tanpa tabel atau kolom baru', () => {
    expect(bare).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|DROP\s+TABLE|DROP\s+COLUMN|\bUPDATE\s+public\./i);
    expect(bare).not.toMatch(/CREATE TABLE|ALTER TABLE/i);
  });

  it('boleh_chat_sesi: lingkup K3 (admin, Koordinator, milik sendiri, jendela operasional) dan definer terkunci', () => {
    const f = fungsi('boleh_chat_sesi');
    expect(f).toMatch(/STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(f).toMatch(/public\.staf_lingkup\(\) AS me/);
    expect(f).toMatch(/me\.role = 'admin'/);
    expect(f).toMatch(/me\.role = 'front_office' AND me\.koordinator/);
    expect(f).toMatch(/me\.role = 'petugas' AND me\.koordinator AND me\.layanan_id IS NOT NULL AND s\.layanan_id = me\.layanan_id/);
    expect(f).toMatch(/s\.ditangani_oleh = me\.id/);
    expect(f).toMatch(/p\.chat_sesi_id = s\.id AND p\.penangan_id = me\.id/);
    // Jendela operasional: sesi terbuka; sesi bot hanya 7 hari terakhir (sama dengan chat_sesi_ringkas).
    expect(f).toMatch(/s\.status IN \('eskalasi', 'aktif'\)/);
    expect(f).toMatch(/s\.status = 'bot' AND s\.updated_at > pg_catalog\.now\(\) - INTERVAL '7 days'/);
    expect(f).toMatch(/me\.role = 'front_office'\s+OR \(me\.role = 'petugas' AND me\.layanan_id IS NOT NULL AND s\.layanan_id = me\.layanan_id\)/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.boleh_chat_sesi\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.boleh_chat_sesi\(uuid\) TO authenticated, service_role/);
  });

  it('policy baca chat_sesi/chat_pesan: pemilik ATAU boleh_chat_sesi, TO authenticated, tanpa lingkup lama', () => {
    const baru = [policy('chat_sesi_owner_select', 'chat_sesi'), policy('chat_pesan_owner_select', 'chat_pesan')];
    for (const p of baru) {
      expect(p, p.slice(0, 60)).not.toBe('');
      expect(p).toMatch(/TO authenticated/);
      expect(p).toMatch(/public\.boleh_chat_sesi\(/);
      expect(p).toMatch(/auth_user_id = auth\.uid\(\)/);
      // Lingkup lama (semua FO lintas Layanan / semua petugas layanan) dibuang.
      expect(p).not.toMatch(/get_my_role\(\) IN \('admin', 'front_office'\)/);
      expect(p).not.toMatch(/get_my_layanan_id\(\)/);
      expect(p).not.toMatch(/USING \(true\)/i);
    }
    expect(bare).toMatch(/DROP POLICY IF EXISTS "chat_sesi_owner_select" ON public\.chat_sesi/);
    expect(bare).toMatch(/DROP POLICY IF EXISTS "chat_pesan_owner_select" ON public\.chat_pesan/);
    expect(bare).not.toMatch(/FOR ALL/i);
    // Policy INSERT tidak disentuh (jalur tulis pesan lewat route dan RPC).
    expect(bare).not.toMatch(/POLICY "chat_pesan_owner_insert"|POLICY "chat_sesi_owner_insert"/);
  });

  it('A2: UPDATE chat_sesi PEMILIK SAJA (staf menulis lewat RPC/route service-role), tanpa boleh_chat_sesi', () => {
    const p = policy('chat_sesi_petugas_update', 'chat_sesi');
    expect(p).toMatch(/FOR UPDATE TO authenticated/);
    expect(p).toMatch(/USING\s*\(\s*pengunjung_id IN \(SELECT id FROM public\.pengunjung WHERE auth_user_id = auth\.uid\(\)\)\s*\)/);
    expect(p).toMatch(/WITH CHECK\s*\(\s*pengunjung_id IN \(SELECT id FROM public\.pengunjung WHERE auth_user_id = auth\.uid\(\)\)\s*\)/);
    expect(p).not.toMatch(/boleh_chat_sesi|get_my_role|get_my_layanan_id/);
  });

  it('chat_percakapan_saya: hanya percakapan milik auth.uid(), satu baris per (pengunjung, layanan)', () => {
    const f = fungsi('chat_percakapan_saya');
    expect(f).toMatch(/STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(f).toMatch(/p\.auth_user_id = auth\.uid\(\)/);
    expect(f).toMatch(/s\.pengunjung_id IN \(SELECT/);
    expect(f).toMatch(/GROUP BY sesi\.layanan_id/);
    expect(f).toMatch(/pg_catalog\.left\(m\.isi, 120\)/);
    // Tidak membocorkan identitas pengunjung lain / kolom kontak.
    expect(f).not.toMatch(/kontak_pengunjung|no_hp|email/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.chat_percakapan_saya\(\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.chat_percakapan_saya\(\) TO authenticated/);
  });

  it('indeks percakapan dan pin: chat_sesi_ringkas serta trigger/penjaga chat tidak diganti', () => {
    expect(bare).toMatch(/CREATE INDEX IF NOT EXISTS idx_chat_sesi_pengunjung_layanan\s+ON public\.chat_sesi \(pengunjung_id, layanan_id, created_at DESC\)/);
    expect(bare).not.toMatch(/FUNCTION public\.chat_sesi_ringkas|FUNCTION public\.chat_sesi_jaga_rpc|FUNCTION public\.guard_chat_sesi_staff_columns/);
    // chat_sesi_ringkas tetap SECURITY INVOKER dan membaca lewat RLS (sumber: 202610070001).
    expect(baca('202610070001_chat_fix_guard_ringkas.sql')).toMatch(/LANGUAGE sql STABLE SECURITY INVOKER/);
  });
});
