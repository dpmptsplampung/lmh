// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';
let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
const owner = randomUUID(), other = randomUUID(), officer = randomUUID(), admin = randomUUID();
const input = { nama: 'Kopi Produk', deskripsi: 'Kopi daerah', jenis: 'Produk', kategori: 'Makanan Olahan',
  kabupaten_kota: 'Kota Bandar Lampung', sumber: 'kurasi' };
async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const result = await sebagai(db, 'postgres', null, query, params);
  if (!result.ok) throw new Error(result.pesan);
  return result.rows as T[];
}
beforeAll(async () => {
  db = await bukaDbPenuh();
  await sql('INSERT INTO auth.users(id) VALUES ($1),($2),($3)', [owner, other, officer]);
  await sql('INSERT INTO auth.users(id) VALUES ($1)', [admin]);
  await sql("INSERT INTO public.petugas(auth_user_id,nama,role,aktif) VALUES ($1,'Admin pemberi','admin',true)", [admin]);
  await sql("INSERT INTO public.petugas(auth_user_id,nama,role,aktif,pemeriksa_umkm) VALUES ($1,'Pemeriksa produk','admin',true,true)", [officer]);
  const [{ id }] = await sql<{ id: string }>('SELECT id FROM public.petugas WHERE auth_user_id=$1', [officer]);
  await rpc(admin, 'umkm_atur_pemeriksa', '$1::uuid,true,$2::uuid', [id, randomUUID()]);
}, 30000);
afterAll(async () => { await db?.close(); });
async function validate(data: unknown) {
  return sql('SELECT umkm_private.validasi($1::jsonb)', [JSON.stringify(data)]);
}
it('validasi menolak kategori lintas jenis, kabupaten asing, dan dua foto utama', async () => {
  for (const data of [{ ...input, jenis: 'Jasa' }, { ...input, kabupaten_kota: 'Lampung' },
    { ...input, foto: [1, 2].map(() => ({ asal: 'eksternal', url: 'https://contoh.id/foto.jpg', utama: true })) }]) {
    await expect(validate(data)).rejects.toThrow('INPUT_TIDAK_VALID');
  }
  await expect(validate(input)).resolves.toBeDefined();
});
it('validasi menolak kapasitas setengah terisi dan tahun di depan', async () => {
  await expect(validate({ ...input, produk: [{ nama: 'Kopi', kapasitas_jumlah: 12 }] }))
    .rejects.toThrow('INPUT_TIDAK_VALID');
  await expect(validate({ ...input, tahun_mulai: 2099 })).rejects.toThrow('INPUT_TIDAK_VALID');
  await expect(validate({ ...input, produk: [{ nama: 'Kopi', kapasitas_jumlah: 1500,
    kapasitas_satuan: 'kg', kapasitas_periode: 'bulan' }] })).resolves.toBeDefined();
});
it('peringatan menandai nomor di produk dan kecamatan', async () => {
  const [{ id }] = await sql<{ id: string }>("INSERT INTO public.umkm_profil(sumber) VALUES ('kurasi') RETURNING id");
  const [{ id: rid }] = await sql<{ id: string }>(`INSERT INTO public.umkm_revisi(profil_id,versi,nama,deskripsi,jenis,kategori,kabupaten_kota,kecamatan,aktor_uid)
    VALUES ($1,1,'Kopi','Deskripsi','Produk','Makanan Olahan','Kota Bandar Lampung','wa.me/628123',$2) RETURNING id`, [id, owner]);
  await sql("INSERT INTO public.umkm_produk(revisi_id,urutan,nama) VALUES ($1,1,'Keripik 0812 3456 7890')", [rid]);
  expect((await sql<{ j: string[] }>('SELECT umkm_private.peringatan($1) AS j', [rid]))[0].j)
    .toEqual(expect.arrayContaining(['produk', 'kecamatan']));
});
it('label omzet hanya untuk 50 juta ke atas', async () => {
  expect((await sql('SELECT umkm_private.label_omzet($1) AS kecil, umkm_private.label_omzet($2) AS besar, umkm_private.skala_dari_omzet($3) AS skala',
    ['10_50jt', '2_15m', '300jt_2m']))[0]).toEqual({ kecil: null, besar: 'Omzet lebih dari Rp2 miliar per tahun', skala: 'Mikro' });
});

type Mutation = { id: string; versi: number; status: string; revisi_id: string };
type Photo = { id: string; utama: boolean; produk_urutan: number | null; tersembunyi: boolean; r2_key: string | null };
type Detail = { versi: number; revisi: Record<string, unknown>; foto: Photo[]; produk: Record<string, unknown>[] };
async function rpc<T = Mutation>(uid: string | null, name: string, args = '', params: unknown[] = [], role = 'authenticated'): Promise<T> {
  const result = await sebagai(db, role, uid, `SELECT public.${name}(${args}) AS j`, params);
  if (!result.ok) throw new Error(result.pesan);
  return (result.rows[0] as { j: T }).j;
}
const full = { ...input, kecamatan: 'Tanjung Karang Barat', nama_pemilik: 'Nama Tertutup', alamat: 'Alamat Tertutup',
  bentuk_usaha: 'CV', tahun_mulai: 2020, omzet_rentang: '50_300jt', tenaga_kerja_rentang: '5-19',
  foto: [{ asal: 'eksternal', url: 'https://contoh.id/utama.jpg', utama: true },
    { asal: 'eksternal', url: 'https://contoh.id/kedua.jpg' }],
  produk: [{ nama: 'Arabika Gunung Pesagi', keterangan: 'Biji kopi', kapasitas_jumlah: 1500,
    kapasitas_satuan: 'kg', kapasitas_periode: 'bulan', foto: { asal: 'eksternal', url: 'https://contoh.id/produk.jpg' } }] };
async function save(data: unknown = full, previous?: Mutation) {
  return rpc(officer, 'umkm_simpan_profil', '$1::jsonb,$2::uuid,$3::uuid,$4::integer',
    [JSON.stringify(data), randomUUID(), previous?.id ?? null, previous?.versi ?? null]);
}
async function visibility(p: Mutation, aksi: string, foto: string | null = null) {
  return rpc(officer, 'umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4,$5::uuid',
    [p.id, p.versi, randomUUID(), aksi, foto]);
}
async function approve(p: Mutation) {
  return rpc(officer, 'umkm_putuskan_profil', '$1::uuid,$2::integer,$3::uuid,$4', [p.id, p.versi, randomUUID(), 'terbit']);
}
async function detail(p: Mutation) { return rpc<Detail>(officer, 'umkm_detail_tugas', '$1::uuid', [p.id]); }
const ownerData = () => {
  const { sumber: _sumber, ...data } = full;
  void _sumber;
  return data;
};
it('petugas menyimpan profil dengan produk, kapasitas, foto produk, dan foto utama', async () => {
  const p = await save();
  const d = await detail(p);
  expect(d.revisi).toMatchObject({ kecamatan: full.kecamatan, nama_pemilik: full.nama_pemilik });
  expect(d.foto).toEqual(expect.arrayContaining([expect.objectContaining({ utama: true, produk_urutan: null }),
    expect.objectContaining({ utama: false, produk_urutan: 1 })]));
  expect((await sql('SELECT nama,kapasitas_jumlah::float AS jumlah FROM public.umkm_produk WHERE revisi_id=$1', [p.revisi_id]))[0])
    .toEqual({ nama: full.produk[0].nama, jumlah: 1500 });
});
it('simpan tanpa kunci produk mempertahankan produk lama', async () => {
  const p = await save();
  const updated = await save({ ...input, nama: 'Kopi diperbarui' }, p);
  expect(await sql('SELECT nama FROM public.umkm_produk WHERE revisi_id=$1', [updated.revisi_id]))
    .toEqual([{ nama: full.produk[0].nama }]);
  expect((await detail(updated)).foto.filter(f => f.produk_urutan === 1)).toHaveLength(1);
});
it('foto yang disembunyikan tetap tersembunyi saat formulir dikirim ulang', async () => {
  let p = await rpc(owner, 'umkm_daftar_usaha', '$1::jsonb,$2::uuid', [JSON.stringify(ownerData()), randomUUID()]);
  p = await rpc(officer, 'umkm_ambil_tugas', '$1::uuid,$2::integer,$3::uuid', [p.id, p.versi, randomUUID()]);
  p = await approve(p);
  const photo = (await detail(p)).foto.find(f => f.produk_urutan === 1)!;
  p = await visibility(p, 'sembunyikan', photo.id);
  p = await save(full, p);
  expect((await detail(p)).foto.find(f => f.produk_urutan === 1)?.tersembunyi).toBe(true);
  p = await rpc(owner, 'umkm_simpan_draf', '$1::uuid,$2::jsonb,$3::integer,$4::uuid',
    [p.id, JSON.stringify(ownerData()), p.versi, randomUUID()]);
  expect((await detail(p)).foto.find(f => f.produk_urutan === 1)?.tersembunyi).toBe(true);
  // Revisi terbit tetap melindungi identitas foto meski revisi terakhir pernah menghilangkannya.
  p = await save({ ...input, foto: [], produk: [] }, p);
  p = await save(full, p);
  expect((await detail(p)).foto.find(f => f.produk_urutan === 1)?.tersembunyi).toBe(true);
});
it('sembunyikan dan pulihkan profil menyalin produk dan foto produk', async () => {
  let p = await save();
  p = await visibility(p, 'sembunyikan');
  p = await visibility(p, 'pulihkan');
  expect(await sql('SELECT nama FROM public.umkm_produk WHERE revisi_id=$1', [p.revisi_id])).toEqual([{ nama: full.produk[0].nama }]);
  expect((await detail(p)).foto).toHaveLength(3);
  const photo = (await detail(p)).foto.find(f => f.produk_urutan === 1)!;
  p = await visibility(p, 'sembunyikan', photo.id);
  p = await visibility(p, 'pulihkan', photo.id);
  expect((await detail(p)).foto.find(f => f.produk_urutan === 1)?.tersembunyi).toBe(false);
  expect(await sql('SELECT nama FROM public.umkm_produk WHERE revisi_id=$1', [p.revisi_id])).toHaveLength(1);
});
let accountKeys: string[];
it('pemilik mendaftar dengan foto di folder akunnya', async () => {
  accountKeys = [1, 2].map(() => `umkm-draf/${owner}/${randomUUID()}.jpg`);
  const data = { ...ownerData(), foto: [{ asal: 'unggahan', r2_key: accountKeys[0], utama: true }],
    produk: [{ nama: 'Kopi unggah', foto: { asal: 'unggahan', r2_key: accountKeys[1] } }] };
  const p = await rpc(owner, 'umkm_daftar_usaha', '$1::jsonb,$2::uuid', [JSON.stringify(data), randomUUID()]);
  const d = await rpc<Detail>(owner, 'umkm_detail_usaha', '$1::uuid', [p.id]);
  expect(d.foto.map(f => f.r2_key).sort()).toEqual([...accountKeys].sort());
});
it('pemilik tidak bisa memakai folder akun lain', async () => {
  for (const data of [{ ...ownerData(), foto: [{ asal: 'unggahan', r2_key: `umkm-draf/${other}/${randomUUID()}.jpg` }] },
    { ...ownerData(), produk: [{ nama: 'Kopi', foto: { asal: 'unggahan', r2_key: `umkm-draf/${other}/${randomUUID()}.jpg` } }] }]) {
    await expect(rpc(owner, 'umkm_daftar_usaha', '$1::jsonb,$2::uuid', [JSON.stringify(data), randomUUID()])).rejects.toThrow('DILARANG');
  }
});
it('kunci di folder akun yang dipakai revisi terlindung dari pembersihan', async () => {
  expect(await rpc(null, 'umkm_draf_dilindungi', '$1::text[]', [accountKeys], 'service_role'))
    .toEqual({ dilindungi: expect.arrayContaining(accountKeys) });
});

type PublicProfile = { id: string; omzet_label: string | null; skala: string | null; bentuk_usaha: string | null;
  produk: { nama: string; kapasitas_jumlah: number | null; foto: { id: string; url: string } | null }[];
  foto: { id: string; url: string }[] };
const publicProfile = (p: Mutation) => rpc<PublicProfile>(null, 'umkm_profil_publik', '$1::uuid', [p.id], 'anon');
it('profil publik memuat produk, kapasitas, dan label omzet', async () => {
  const p = await approve(await save());
  const j = await publicProfile(p);
  expect(j).toMatchObject({ omzet_label: 'Omzet lebih dari Rp50 juta per tahun', skala: 'Mikro',
    produk: [{ nama: full.produk[0].nama, kapasitas_jumlah: 1500, foto: { url: 'https://contoh.id/produk.jpg' } }] });
  expect((await detail(p)).produk).toMatchObject([{ nama: full.produk[0].nama, kapasitas_jumlah: 1500 }]);
});
it('profil publik tidak memuat data tertutup', async () => {
  const p = await approve(await save({ ...full, omzet_rentang: '10_50jt', bentuk_usaha: 'Lainnya' }));
  const j = await publicProfile(p);
  expect(j).toMatchObject({ omzet_label: null, skala: null, bentuk_usaha: null });
  for (const secret of ['nama_pemilik', full.nama_pemilik, 'alamat', full.alamat, 'omzet_rentang', '10_50jt']) {
    expect(JSON.stringify(j)).not.toContain(secret);
  }
  const card = await sql<{ j: unknown }>('SELECT umkm_private.kartu($1) AS j', [p.id]);
  expect(JSON.stringify(card)).not.toMatch(/nama_pemilik|alamat|omzet_rentang/);
});
it('sampul kartu memakai foto utama dan jatuh ke foto berikutnya', async () => {
  let p = await approve(await save());
  const d = await detail(p);
  const primary = d.foto.find(f => f.utama)!;
  const second = d.foto.find(f => !f.utama && f.produk_urutan === null)!;
  const product = d.foto.find(f => f.produk_urutan === 1)!;
  const card = async () => (await sql<{ j: { foto: { id: string } } }>('SELECT umkm_private.kartu($1) AS j', [p.id]))[0].j;
  expect((await card()).foto.id).toBe(primary.id);
  p = await visibility(p, 'sembunyikan', primary.id);
  expect((await card()).foto.id).toBe(second.id);
  expect((await publicProfile(p)).foto.map(f => f.id)).toEqual([second.id]);
  expect((await publicProfile(p)).foto.map(f => f.id)).not.toContain(product.id);
  p = await save({ ...full, foto: [full.foto[1]] }, p);
  p = await approve(p);
  expect((await publicProfile(p)).foto).toHaveLength(1);
  expect((await publicProfile(p)).foto[0].url).toBe('https://contoh.id/kedua.jpg');
});
it('produk dari revisi diajukan tidak tampil publik', async () => {
  let p = await rpc(owner, 'umkm_daftar_usaha', '$1::jsonb,$2::uuid', [JSON.stringify(ownerData()), randomUUID()]);
  p = await rpc(officer, 'umkm_ambil_tugas', '$1::uuid,$2::integer,$3::uuid', [p.id, p.versi, randomUUID()]);
  p = await approve(p);
  p = await rpc(owner, 'umkm_simpan_draf', '$1::uuid,$2::jsonb,$3::integer,$4::uuid',
    [p.id, JSON.stringify({ ...ownerData(), produk: [{ nama: 'Produk belum disetujui' }] }), p.versi, randomUUID()]);
  expect((await publicProfile(p)).produk.map(pr => pr.nama)).toEqual([full.produk[0].nama]);
  expect((await rpc<Detail>(owner, 'umkm_detail_usaha', '$1::uuid', [p.id])).produk)
    .toMatchObject([{ nama: 'Produk belum disetujui' }]);
});
it('pencarian menemukan nama produk', async () => {
  const p = await approve(await save({ ...full, produk: [{ nama: 'Robusta Puncak Sekincau' }] }));
  const j = await rpc<{ items: { id: string; kecamatan: string }[] }>(null, 'umkm_cari_katalog', '$1', ['Sekincau'], 'anon');
  expect(j.items).toEqual([expect.objectContaining({ id: p.id, kecamatan: full.kecamatan })]);
});

it('tahun mulai berbentuk angka desimal bulat tetap tersimpan sebagai tahun', async () => {
  await expect(save({ ...full, tahun_mulai: 2000.5 })).rejects.toThrow('INPUT_TIDAK_VALID');
  const data = JSON.stringify({ ...full, tahun_mulai: 2000 }).replace('"tahun_mulai":2000', '"tahun_mulai":2000.0');
  const p = await rpc(officer, 'umkm_simpan_profil', '$1::jsonb,$2::uuid', [data, randomUUID()]);
  expect((await detail(p)).revisi.tahun_mulai).toBe(2000);
});

it('angka kapasitas yang mengandung nomor memicu peringatan produk, angka wajar tidak', async () => {
  let p = await save();
  expect((await sql<{ j: string[] }>('SELECT umkm_private.peringatan($1) AS j', [p.revisi_id]))[0].j).toEqual([]);
  p = await save({ ...full, produk: [{ ...full.produk[0], kapasitas_jumlah: 812345678.99 }] }, p);
  expect((await sql<{ j: string[] }>('SELECT umkm_private.peringatan($1) AS j', [p.revisi_id]))[0].j).toContain('produk');
  await expect(approve(p)).rejects.toThrow('KONTAK_PUBLIK');
});
