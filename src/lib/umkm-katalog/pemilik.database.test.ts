// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';

let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
let profile: string;
const owner = randomUUID(), other = randomUUID(), officer = randomUUID(), staff = randomUUID();
const admin = randomUUID();
const input = { nama: 'Kopi Pemilik', deskripsi: 'Kopi daerah', jenis: 'Produk', kategori: 'Makanan Olahan',
  kabupaten_kota: 'Kota Bandar Lampung', nomor: '081234567890' };
type Mutation = { id: string; versi: number; status: string; pemilik_id: string };
async function call<T = Mutation>(uid: string | null, name: string, args = '', params: unknown[] = []): Promise<T> {
  const result = await sebagai(db, 'authenticated', uid, `SELECT public.${name}(${args}) AS j`, params);
  if (!result.ok) throw new Error(result.pesan);
  return (result.rows[0] as { j: T }).j;
}
beforeAll(async () => {
  db = await bukaDbPenuh();
  for (const uid of [owner, other, officer, admin]) {
    expect((await sebagai(db, 'postgres', null, 'INSERT INTO auth.users(id) VALUES ($1)', [uid])).ok).toBe(true);
  }
  expect((await sebagai(db, 'postgres', null, `INSERT INTO petugas(id,auth_user_id,nama,role,aktif,
    pemeriksa_umkm) VALUES ($1,$2,'Pemeriksa','petugas',true,true)`, [staff, officer])).ok).toBe(true);
  expect((await sebagai(db, 'postgres', null, `INSERT INTO petugas(auth_user_id,nama,role,aktif)
    VALUES ($1,'Admin pengatur','admin',true)`, [admin])).ok).toBe(true);
  await call(admin, 'umkm_atur_pemeriksa', '$1::uuid,true,$2::uuid', [staff, randomUUID()]);
}, 30000);
afterAll(async () => { await db?.close(); });

it('registrasi privat idempoten, koreksi penolakan dan terbit pertama mengesahkan pemilik', async () => {
  const op = randomUUID();
  const p = await call(owner, 'umkm_daftar_usaha', '$1::jsonb,$2::uuid', [JSON.stringify(input), op]);
  profile = p.id;
  expect(p).toMatchObject({ status: 'diajukan', pemilik_status: 'diajukan' });
  expect(await call(owner, 'umkm_daftar_usaha', '$1::jsonb,$2::uuid', [JSON.stringify(input), op])).toEqual(p);
  await expect(call(owner, 'umkm_statistik_pemilik', '$1::uuid', [p.id])).rejects.toThrow('TIDAK_DITEMUKAN');
  await expect(call(other, 'umkm_detail_usaha', '$1::uuid', [p.id])).rejects.toThrow('TIDAK_DITEMUKAN');
  await expect(call(other, 'umkm_akses_draf_pemilik', '$1::uuid', [p.id]))
    .rejects.toThrow('TIDAK_DITEMUKAN');
  expect(await call(owner, 'umkm_akses_draf_pemilik', '$1::uuid', [p.id])).toEqual({ diizinkan: true });
  let s = await call(officer, 'umkm_ambil_tugas', '$1::uuid,$2::integer,$3::uuid',
    [p.id, p.versi, randomUUID()]);
  s = await call(officer, 'umkm_putuskan_profil', '$1::uuid,$2::integer,$3::uuid,$4,$5',
    [p.id, s.versi, randomUUID(), 'ditolak', 'Ganti foto']);
  expect(await call(owner, 'umkm_detail_usaha', '$1::uuid', [p.id])).toMatchObject({
    status: 'ditolak', pemilik_status: 'diajukan', catatan_petugas: 'Ganti foto', nomor: null,
  });
  s = await call(owner, 'umkm_simpan_draf', '$1::uuid,$2::jsonb,$3::integer,$4::uuid',
    [p.id, JSON.stringify({ ...input, deskripsi: 'Kopi kemasan' }), s.versi, randomUUID()]);
  expect(s.status).toBe('diajukan');
  s = await call(officer, 'umkm_putuskan_profil', '$1::uuid,$2::integer,$3::uuid,$4',
    [p.id, s.versi, randomUUID(), 'terbit']);
  expect(await call(owner, 'umkm_detail_usaha', '$1::uuid', [p.id]))
    .toMatchObject({ status: 'terbit', pemilik_status: 'disetujui', nomor: input.nomor });
  const trace = await sebagai(db, 'postgres', null,
    'SELECT to_jsonb(r)::text AS j FROM umkm_riwayat r WHERE objek_id=$1', [p.id]);
  expect(JSON.stringify(trace)).not.toContain(input.nomor);
});

it('klaim belum disetujui tanpa hak; petugas memutus idempoten dan suka sendiri dikeluarkan', async () => {
  const op = randomUUID();
  const m = await call(other, 'umkm_klaim_profil', '$1::uuid,$2,$3::uuid',
    [profile, 'Penanggung jawab usaha', op]);
  expect(await call(other, 'umkm_klaim_profil', '$1::uuid,$2,$3::uuid',
    [profile, 'Penanggung jawab usaha', op])).toEqual(m);
  await expect(call(other, 'umkm_akses_draf_pemilik', '$1::uuid', [profile]))
    .rejects.toThrow('TIDAK_DITEMUKAN');
  expect(await call(other, 'umkm_suka', '$1::uuid,true', [profile])).toMatchObject({ suka: 1 });
  const tasks = await call<{ items: { id: string; jenis: string }[] }>(officer, 'umkm_daftar_tugas');
  expect(tasks.items).toContainEqual(expect.objectContaining({ id: m.id, jenis: 'klaim' }));
  const taken = await call(officer, 'umkm_ambil_klaim', '$1::uuid,$2::integer,$3::uuid',
    [m.id, m.versi, randomUUID()]);
  const key = randomUUID();
  const args = [m.id, taken.versi, key, 'disetujui'];
  const approved = await call(officer, 'umkm_putuskan_klaim', '$1::uuid,$2::integer,$3::uuid,$4', args);
  expect(await call(officer, 'umkm_putuskan_klaim', '$1::uuid,$2::integer,$3::uuid,$4', args)).toEqual(approved);
  expect(await call(other, 'umkm_statistik_pemilik', '$1::uuid', [profile])).toMatchObject({ suka: 0 });
  await expect(call(other, 'umkm_suka', '$1::uuid,true', [profile])).rejects.toThrow('DILARANG');
});

it('statistik privat 30 hari WIB, draf menjaga snapshot dan prefix foto profil lain ditolak', async () => {
  const stats = await call<{ tren: unknown[] }>(owner, 'umkm_statistik_pemilik', '$1::uuid', [profile]);
  expect(stats).toMatchObject({ dilihat: null, suka: 0, permintaan: 0, nomor_dibuka: 0 });
  expect(stats.tren).toHaveLength(30);
  expect(await call(owner, 'umkm_perusahaan_penerima', '$1::uuid', [profile])).toEqual({
    items: [], next_cursor: null,
  });
  const detail = await call(owner, 'umkm_detail_usaha', '$1::uuid', [profile]);
  const data = { ...input, nama: 'Kopi versi baru', foto: [{ asal: 'unggahan',
    r2_key: `umkm-draf/${profile}/${randomUUID()}.jpg` }] };
  await expect(call(owner, 'umkm_simpan_draf', '$1::uuid,$2::jsonb,$3::integer,$4::uuid',
    [profile, JSON.stringify({ ...data, foto: [{ asal: 'unggahan',
      r2_key: `umkm-draf/${randomUUID()}/${randomUUID()}.jpg` }] }), detail.versi, randomUUID()]))
    .rejects.toThrow('DILARANG');
  const draft = await call(owner, 'umkm_simpan_draf', '$1::uuid,$2::jsonb,$3::integer,$4::uuid',
    [profile, JSON.stringify(data), detail.versi, randomUUID()]);
  expect(await call(owner, 'umkm_profil_publik', '$1::uuid', [profile]))
    .toMatchObject({ nama: 'Kopi Pemilik', foto: [] });
  expect(await call(owner, 'umkm_detail_usaha', '$1::uuid', [profile]))
    .toMatchObject({ revisi: { nama: 'Kopi versi baru' }, foto: [{ r2_key: data.foto[0].r2_key }] });
  expect(await call(owner, 'umkm_cabut_izin_pemilik', '$1::uuid,$2::integer,$3::uuid',
    [profile, draft.versi, randomUUID()])).toMatchObject({ id: profile });
  expect(await call(owner, 'umkm_detail_usaha', '$1::uuid', [profile])).toMatchObject({ izin_status: 'dicabut' });
});

it('perubahan dan catatan mengikuti revisi terakhir; draf pada profil disembunyikan ditolak', async () => {
  type Usaha = Mutation & { perubahan: string | null; catatan_petugas: string | null };
  const daftar = async (uid: string) => (await call<{ items: Usaha[] }>(uid, 'umkm_usaha_saya')).items
    .find(u => u.id === profile);
  expect(await daftar(owner)).toMatchObject({ perubahan: 'menunggu', catatan_petugas: null });
  expect(await call(other, 'umkm_detail_usaha', '$1::uuid', [profile])).toMatchObject({ perubahan: 'menunggu' });
  let s = await call(owner, 'umkm_detail_usaha', '$1::uuid', [profile]);
  s = await call(officer, 'umkm_putuskan_profil', '$1::uuid,$2::integer,$3::uuid,$4,$5',
    [profile, s.versi, randomUUID(), 'ditolak', 'Foto buram']);
  expect(await call(owner, 'umkm_detail_usaha', '$1::uuid', [profile]))
    .toMatchObject({ status: 'terbit', perubahan: 'ditolak', catatan_petugas: 'Foto buram' });
  expect(await daftar(other)).toMatchObject({ perubahan: 'ditolak', catatan_petugas: null });
  s = await call(officer, 'umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4',
    [profile, s.versi, randomUUID(), 'sembunyikan']);
  await expect(call(owner, 'umkm_simpan_draf', '$1::uuid,$2::jsonb,$3::integer,$4::uuid',
    [profile, JSON.stringify(input), s.versi, randomUUID()])).rejects.toThrow('KONFLIK_STATUS');
  expect(await call(owner, 'umkm_detail_usaha', '$1::uuid', [profile])).toMatchObject({ status: 'disembunyikan' });
});
