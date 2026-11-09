// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh } from '../../../scripts/lokal-rantai/harness.mjs';
let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
beforeAll(async () => { db = await bukaDbPenuh(); }, 30000);
afterAll(async () => { await db?.close(); });
it.each([
  ['0812    3456    7890', true], ['0812\n\n\n\n3456 7890', true], ['Rp 0812-3456-7890', true],
  ['Rp 850.000.000', false],
  ['Rp 620.000.000', false], ['Rp 10.000.000', false], ['Rp 1.000.000.000', false],
  ['sejak 2010', false], ['foto_1699999999.jpg', false], ['35141', false], ['NIB 1234567890123', false],
  ['https://contoh.test/umkm-katalog/08123456-7890-4abc-abcd-abcdefabcdef.jpg', false],
])('deteksi kontak %s', async (teks, hasil) => {
  const r = await db.query('SELECT umkm_private.ada_kontak($1) ada', [teks]);
  expect(r.rows[0]?.ada).toBe(hasil);
});
it('dua ribu URL UUID tidak dianggap nomor', async () => {
  const urls = Array.from({ length: 2000 }, () => `https://contoh.test/umkm-katalog/${randomUUID()}.jpg`);
  const r = await db.query(`SELECT count(*)::integer jumlah FROM unnest($1::text[]) t
    WHERE umkm_private.ada_kontak(t)`, [urls]);
  expect(r.rows[0]?.jumlah).toBe(0);
});
