// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const path = join(process.cwd(), 'supabase/migrations/202611090004_umkm_pengawasan_darurat.sql');
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
describe('kontrak pengawasan dan darurat G2', () => {
  it('FO/admin hanya mendapat RPC khusus tanpa perlu flag pemeriksa', () => {
    for (const fn of ['ringkasan_pengawasan','jejak_pengawasan','cari_pengawasan','tindakan_darurat',
      'selesaikan_mendesak']) expect(sql).toContain(`FUNCTION public.umkm_${fn}(`);
    expect(sql).toContain("a.role IN ('admin','front_office')");
    expect(sql).toContain('public.sesi_valid()');
    expect(sql).toContain("'Profil belum terbit'");
    expect(sql).not.toContain('public.umkm_kontak_versi');
    expect(sql).not.toMatch(/CREATE TABLE.*umkm_permintaan/);
  });
  it('aksi terikat versi, alasan aman dan jejak tanpa isi pesan', () => {
    for (const token of ['FOR UPDATE','KONFLIK_VERSI','KONFLIK_STATUS','KONFLIK_OPERASI',
      'umkm_private.ada_kontak','mendesak=true','mendesak=false','LIMIT 21']) expect(sql).toContain(token);
    expect(sql.match(/SET search_path = pg_catalog, pg_temp AS/g))
      .toHaveLength((sql.match(/CREATE(?: OR REPLACE)? FUNCTION /g) ?? []).length);
    expect(mengandungKontrolTransaksi(sql)).toBe(false);
    expect(sql).not.toMatch(/GRANT\s+(SELECT|ALL)\s+ON/i);
  });
});
