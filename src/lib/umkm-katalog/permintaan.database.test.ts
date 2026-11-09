// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';

let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
const uid = randomUUID(), other = randomUUID();
async function call(fn: string, args = '', values: unknown[] = [], who = uid) {
  const r = await sebagai(db, 'authenticated', who, `SELECT public.${fn}(${args}) j`, values);
  if (!r.ok) throw new Error(r.pesan);
  return (r.rows[0] as { j: Record<string, unknown> }).j;
}
beforeAll(async () => {
  db = await bukaDbPenuh();
  await db.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [uid, other]);
  await db.query(`INSERT INTO pengunjung(auth_user_id,nama,email,no_hp)
    VALUES ($1,'Pemohon','pemohon@example.test','081111111111'),($2,'Rekan',NULL,NULL)`, [uid, other]);
}, 30000);
afterAll(async () => { await db?.close(); });

it('perusahaan pribadi memerlukan persetujuan dan sesi nonanon, akun lain tidak mewarisi', async () => {
  await expect(call('umkm_simpan_perusahaan', '$1,$2,false', ['Perusahaan', 'Pembeli']))
    .rejects.toThrow('INPUT_TIDAK_VALID');
  const company = await call('umkm_simpan_perusahaan', '$1,$2,true', ['Perusahaan', 'Pembeli']);
  expect(company).toMatchObject({ nama: 'Perusahaan', jabatan: 'Pembeli', diperiksa: false });
  expect(await call('umkm_perusahaan_saya')).toEqual({ perusahaan: company });
  expect(await call('umkm_perusahaan_saya', '', [], other)).toEqual({ perusahaan: null });
  const anon = await sebagai(db, 'authenticated', uid, 'SELECT public.umkm_perusahaan_saya()', [],
    { is_anonymous: true });
  expect(anon).toMatchObject({ ok: false, pesan: 'LOGIN_DIPERLUKAN' });
});

it('kebutuhan dimiliki akun, kategori katalog, tutup dan daftar dapat diulang tanpa kuota bisnis', async () => {
  const stafUid = randomUUID(), staf = randomUUID(), p = randomUUID(), r = randomUUID();
  await db.query('INSERT INTO auth.users(id) VALUES ($1)', [stafUid]);
  await db.query(`INSERT INTO petugas(id,auth_user_id,nama,role) VALUES ($1,$2,'Pemeriksa','petugas')`,
    [staf, stafUid]);
  await db.query("INSERT INTO umkm_profil(id,sumber,status) VALUES ($1,'kurasi','terbit')", [p]);
  await db.query(`INSERT INTO umkm_revisi(id,profil_id,versi,nama,deskripsi,jenis,kategori,
    kabupaten_kota,keputusan,dibuat_oleh) VALUES ($1,$2,1,'Kopi','Olahan','Produk','Pangan',
    'Lampung','terbit',$3)`, [r, p, staf]);
  await db.query('UPDATE umkm_profil SET revisi_disetujui_id=$2,revisi_terakhir_id=$2 WHERE id=$1', [p, r]);
  const need = await call('umkm_simpan_kebutuhan', '$1,$2', ['Membeli kopi', 'Pangan']);
  expect(await call('umkm_kebutuhan_saya')).toMatchObject({ items: [{ id: need.id, teks: 'Membeli kopi' }] });
  expect(await call('umkm_cari_rekomendasi', '$1::uuid', [need.id]))
    .toMatchObject({ items: [{ id: p, nama: 'Kopi' }] });
  await expect(call('umkm_tutup_kebutuhan', '$1::uuid', [need.id], other))
    .rejects.toThrow('TIDAK_DITEMUKAN');
  const op = randomUUID();
  const args = [need.id, [p], op];
  const submitted = await call('umkm_ajukan_kontak', '$1::uuid,$2::uuid[],$3::uuid', args);
  expect(submitted).toMatchObject({ items: [{ profil_id: p, status: 'diajukan' }] });
  expect(await call('umkm_ajukan_kontak', '$1::uuid,$2::uuid[],$3::uuid', args)).toEqual(submitted);
  expect(await call('umkm_ajukan_kontak', '$1::uuid,$2::uuid[],$3::uuid', [need.id, [p], randomUUID()]))
    .toEqual(submitted);
  expect(await call('umkm_cari_rekomendasi', '$1::uuid', [need.id])).toEqual({ items: [] });
  const list = await call('umkm_permintaan_saya');
  expect(JSON.stringify(list)).not.toContain('081111111111');
  expect(list).toMatchObject({ items: [{ status: 'diajukan' }] });
  expect(await call('umkm_tutup_kebutuhan', '$1::uuid', [need.id])).toEqual({ id: need.id, status: 'ditutup' });
  expect(await call('umkm_tutup_kebutuhan', '$1::uuid', [need.id])).toEqual({ id: need.id, status: 'ditutup' });
  expect(await call('umkm_permintaan_saya')).toMatchObject({ items: [{ status: 'dibatalkan' }] });
});
