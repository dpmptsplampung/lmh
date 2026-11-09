// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';
let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
beforeAll(async () => { db = await bukaDbPenuh(); }, 30000);
afterAll(async () => { await db?.close(); });
it('rollback C menutup RPC pemilik, mempertahankan bukti dan membiarkan tahap B tetap aktif', async () => {
  for (const file of ['rollback-umkm-pemilik-integrasi-202611090011.sql',
    'rollback-umkm-pemilik-202611090010.sql']) {
    await db.exec(readFileSync(new URL(`../../../docs/${file}`, import.meta.url), 'utf8'));
  }
  expect(await sebagai(db, 'anon', null, 'SELECT public.umkm_tahap_b() AS j'))
    .toMatchObject({ ok: true, rows: [{ j: { aktif: true } }] });
  expect(await sebagai(db, 'anon', null, 'SELECT public.umkm_tahap_c() AS j'))
    .toMatchObject({ ok: true, rows: [{ j: { aktif: false } }] });
  expect(await sebagai(db, 'authenticated', null, 'SELECT public.umkm_usaha_saya()'))
    .toMatchObject({ ok: false, pesan: 'MODUL_BELUM_TERSEDIA' });
  expect(await sebagai(db, 'authenticated', null, 'SELECT public.umkm_cabut_izin_pemilik(NULL,NULL,NULL)'))
    .toMatchObject({ ok: false, pesan: 'MODUL_BELUM_TERSEDIA' });
  expect(await sebagai(db, 'authenticated', null,
    'SELECT public.umkm_cabut_kepemilikan(NULL,NULL,NULL,NULL)'))
    .toMatchObject({ ok: false, pesan: 'MODUL_BELUM_TERSEDIA' });
  expect(await sebagai(db, 'postgres', null, `SELECT
    position('Pemilik usaha' in pg_get_functiondef('public.umkm_jejak_pengawasan(text)'::regprocedure))=0 AS lama,
    NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='umkm_jaga_sumber_mandiri') AS tanpa_pemicu`))
    .toMatchObject({ ok: true, rows: [{ lama: true, tanpa_pemicu: true }] });
  expect(await sebagai(db, 'postgres', null, "SELECT to_regclass('public.umkm_pemilik') IS NOT NULL AS ada"))
    .toMatchObject({ ok: true, rows: [{ ada: true }] });
});
