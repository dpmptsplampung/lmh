// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
const path = 'supabase/migrations/202611100003_umkm_produk_baca.sql';
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';
it('baca memisahkan foto produk, mengurutkan utama, dan melindungi data tertutup', () => {
  for (const token of ['produk_urutan IS NULL', 'ORDER BY f.utama DESC', "nullif(r.bentuk_usaha,'Lainnya')",
    'umkm_private.label_omzet(', 'umkm_private.produk_json(']) expect(sql).toContain(token);
  for (const name of ['umkm_private.kartu', 'public.umkm_profil_publik']) {
    const body = sql.match(new RegExp(`FUNCTION ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\$\\$;`))?.[0];
    expect(body).toBeDefined();
    // Kolom omzet hanya dipakai menghitung label; kunci dan nilai mentah tidak dikirim.
    expect(body).not.toMatch(/'nama_pemilik'|'alamat'|'omzet_rentang'|r\.nama_pemilik|r\.alamat/);
  }
  expect(mengandungKontrolTransaksi(sql)).toBe(false);
});
