// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';
let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
beforeAll(async () => { db = await bukaDbPenuh(); }, 30000);
afterAll(async () => { await db?.close(); });
it('rollback menutup nomor dan modul B serta mempertahankan data dan retensi G3', async () => {
  const company = randomUUID(), need = randomUUID(), profil = randomUUID(), request = randomUUID();
  await db.query(`INSERT INTO umkm_perusahaan(id,nama,jabatan,dibuat_pada)
    VALUES ($1,'Perusahaan bantuan','Pembeli',now()-interval '800 days')`, [company]);
  await db.query(`INSERT INTO umkm_kebutuhan(id,perusahaan_id,teks,kategori,status,dibuat_pada,ditutup_pada)
    VALUES ($1,$2,'Kebutuhan lama','Pangan','ditutup',now()-interval '800 days',now()-interval '731 days')`,
  [need, company]);
  await db.query("INSERT INTO umkm_profil(id,sumber,status) VALUES ($1,'kurasi','terbit')", [profil]);
  await db.query(`INSERT INTO umkm_permintaan_kontak(id,kebutuhan_id,profil_id,status,sumber,
    nama_bantuan,kontak_bantuan,tautan_hash,aktivitas_pada,ditutup_pada)
    VALUES ($1,$2,$3,'dibatalkan','petugas','Rina','081333333333','hash-lama',
      now()-interval '731 days',now()-interval '731 days')`, [request, need, profil]);
  for (const filename of ['rollback-umkm-permintaan-petugas-202611090009.sql',
    'rollback-umkm-permintaan-202611090008.sql']) {
    await db.exec(readFileSync(new URL(`../../../docs/${filename}`, import.meta.url), 'utf8'));
  }
  const result = await sebagai(db, 'authenticated', null, 'SELECT public.umkm_baca_nomor(gen_random_uuid())');
  expect(result).toMatchObject({ ok: false, kode: '42501' });
  expect(await sebagai(db, 'anon', null, 'SELECT public.umkm_tahap_b() j'))
    .toMatchObject({ ok: true, rows: [{ j: { aktif: false } }] });
  expect(await sebagai(db, 'postgres', null, 'SELECT umkm_private.bersihkan_retensi()'))
    .toMatchObject({ ok: true });
  expect(await sebagai(db, 'postgres', null, 'SELECT count(*) FROM public.umkm_permintaan_kontak'))
    .toMatchObject({ ok: true });
  expect((await db.query(`SELECT r.status,r.nama_bantuan,r.kontak_bantuan,r.tautan_hash,k.teks,c.nama
    FROM umkm_permintaan_kontak r JOIN umkm_kebutuhan k ON k.id=r.kebutuhan_id
    JOIN umkm_perusahaan c ON c.id=k.perusahaan_id WHERE r.id=$1`, [request])).rows)
    .toEqual([{ status: 'dibatalkan', nama_bantuan: null, kontak_bantuan: null,
      tautan_hash: null, teks: '', nama: 'Perusahaan dihapus' }]);
});
