// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const file = join(process.cwd(), 'supabase/migrations/202611090001_umkm_inti.sql');
const sql = existsSync(file) ? readFileSync(file, 'utf8') : '';
describe('UMKM inti: kontrak database G1', () => {
  it('enam tabel privat memiliki RLS dan tidak memberi akses langsung', () => {
    for (const table of ['umkm_profil','umkm_revisi','umkm_foto','umkm_kontak_versi','umkm_izin','umkm_riwayat']) {
      expect(sql).toContain(`CREATE TABLE public.${table}`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated, service_role;`);
    }
  });
  it('menegakkan empat status, versi, sesi aktif, lock dan idempotensi tanpa payload mentah', () => {
    expect(sql).toContain("status IN ('diajukan', 'terbit', 'disembunyikan', 'ditolak')");
    const tokens = ['pemeriksa_umkm','public.sesi_valid()', 'FOR UPDATE', 'KONFLIK_VERSI', 'KONFLIK_OPERASI',
      'extensions.hmac', 'pg_advisory_xact_lock','umkm_private.rahasia','KONTAK_PUBLIK'];
    for (const token of tokens) expect(sql).toContain(token);
    expect(sql).not.toMatch(/GRANT\s+(?:SELECT|ALL)\s+ON\s+public\.umkm_/i);
    const lockStart = sql.indexOf('SELECT * INTO p FROM public.umkm_profil WHERE id=');
    const compareStart = sql.indexOf('IF p.versi IS DISTINCT FROM');
    expect(lockStart).toBeGreaterThan(0);
    expect(compareStart).toBeGreaterThan(lockStart);
    expect(sql.slice(lockStart, compareStart)).toContain('FOR UPDATE;');
  });
  it('semua RPC memiliki search_path terkunci dan execute dicabut', () => {
    const rpc = ['simpan_profil','daftar_tugas','cari_profil','detail_tugas','ambil_tugas','putuskan_profil',
      'ubah_visibilitas','akses_kontak_petugas','ubah_izin','atur_pemeriksa','profil_publik'];
    for (const fn of rpc) {
      expect(sql).toContain(`FUNCTION public.umkm_${fn}(`);
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public.umkm_${fn}\\(`));
    }
    const definitions = sql.match(/CREATE(?: OR REPLACE)? FUNCTION /g) ?? [];
    expect(sql.match(/SET search_path = pg_catalog, pg_temp AS/g)).toHaveLength(definitions.length);
  });
  it('forward tanpa transaksi sendiri dan tanpa perubahan marketplace lama', () => {
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
    expect(sql).not.toMatch(/(?:ALTER|UPDATE|DROP|DELETE FROM)\s+(?:TABLE\s+)?public\.listing_umkm/i);
    expect(sql).not.toMatch(/\b(?:DROP TABLE|TRUNCATE)\b/i);
  });
});
