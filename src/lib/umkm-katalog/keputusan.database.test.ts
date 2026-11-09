// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';

let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
const user = randomUUID(), staffUser = randomUUID(), admin = randomUUID(), staff = randomUUID();
const profil = randomUUID(), revisi = randomUUID(), kontak = randomUUID();
let need: string;
async function rpc(fn: string, args = '', values: unknown[] = [], uid = staffUser) {
  const r = await sebagai(db, 'authenticated', uid, `SELECT public.${fn}(${args}) j`, values);
  if (!r.ok) throw new Error(r.pesan);
  return (r.rows[0] as { j: Record<string, unknown> }).j;
}
beforeAll(async () => {
  db = await bukaDbPenuh();
  await db.query('INSERT INTO auth.users(id) VALUES ($1),($2),($3)', [user, staffUser, admin]);
  await db.query(`INSERT INTO petugas(id,auth_user_id,nama,role,aktif)
    VALUES ($1,$2,'Petugas','petugas',true),(gen_random_uuid(),$3,'Admin','admin',true)`,
  [staff, staffUser, admin]);
  await rpc('umkm_atur_pemeriksa', '$1::uuid,true,$2::uuid', [staff, randomUUID()], admin);
  await db.query(`INSERT INTO pengunjung(auth_user_id,nama,no_hp) VALUES ($1,'Pemohon','081111111111')`, [user]);
  await db.query("INSERT INTO umkm_profil(id,sumber,status) VALUES ($1,'kurasi','terbit')", [profil]);
  await db.query(`INSERT INTO umkm_revisi(id,profil_id,versi,nama,deskripsi,jenis,kategori,
    kabupaten_kota,keputusan,dibuat_oleh) VALUES ($1,$2,1,'Kopi','Olahan','Produk','Pangan',
    'Lampung','terbit',$3)`, [revisi, profil, staff]);
  await db.query(`INSERT INTO umkm_kontak_versi(id,profil_id,nomor,dibuat_oleh)
    VALUES ($1,$2,'082222222222',$3)`, [kontak, profil, staff]);
  await db.query(`UPDATE umkm_profil SET revisi_disetujui_id=$2,revisi_terakhir_id=$2,
    kontak_terakhir_id=$3 WHERE id=$1`, [profil, revisi, kontak]);
  await rpc('umkm_simpan_perusahaan', "'Perusahaan','Pembeli',true", [], user);
  need = (await rpc('umkm_simpan_kebutuhan', "'Membeli kopi','Pangan'", [], user)).id as string;
}, 30000);
afterAll(async () => { await db?.close(); });

it('Setujui menunggu izin, izin tidak membuka otomatis, pembukaan dan replay tanpa nomor', async () => {
  const batch = await rpc('umkm_ajukan_kontak', '$1::uuid,$2::uuid[],$3::uuid',
    [need, [profil], randomUUID()], user);
  const request = (batch.items as { id: string; versi: number }[])[0];
  const action = (fn: string, version: number, op = randomUUID()) =>
    rpc(fn, '$1::uuid,$2::integer,$3::uuid', [request.id, version, op]);
  await rpc('umkm_ambil_pekerjaan', "'permintaan',$1::uuid,$2::integer,$3::uuid",
    [request.id, request.versi, randomUUID()]);
  expect(await action('umkm_setujui_dan_buka', 2)).toMatchObject({ status: 'menunggu_izin', versi: 3 });
  await expect(rpc('umkm_baca_nomor', '$1::uuid', [request.id], user))
    .rejects.toThrow('NOMOR_TIDAK_TERSEDIA');
  expect(await rpc('umkm_akses_kontak_petugas', '$1::uuid', [profil])).toEqual({ nomor: '082222222222' });
  await rpc('umkm_ubah_izin', '$1::uuid,1,$2::uuid,\'diberikan\'', [profil, randomUUID()]);
  await expect(rpc('umkm_baca_nomor', '$1::uuid', [request.id], user))
    .rejects.toThrow('NOMOR_TIDAK_TERSEDIA');
  const op = randomUUID(), opened = await action('umkm_setujui_dan_buka', 3, op);
  expect(opened).toMatchObject({ status: 'nomor_dibuka', versi: 4 });
  expect(JSON.stringify(opened)).not.toContain('082222222222');
  expect(await action('umkm_setujui_dan_buka', 3, op)).toEqual(opened);
  const detail = await rpc('umkm_detail_permintaan', '$1::uuid', [request.id]);
  expect(await rpc('umkm_cari_profil', '$1', [String(detail.kode).toLowerCase()]))
    .toMatchObject({ items: [{ id: request.id, jenis: 'permintaan', status: 'nomor_dibuka' }] });
  expect(await rpc('umkm_baca_nomor', '$1::uuid', [request.id], user)).toMatchObject({ nomor: '082222222222' });
  await expect(rpc('umkm_baca_nomor', '$1::uuid', [request.id], admin)).rejects.toThrow('DILARANG');
});

it('kode bantuan hanya sekali di respons dan tertaut hanya sekali dengan normalisasi', async () => {
  const op = randomUUID();
  const args = "'Perusahaan bantuan','Pembeli','Rina','081333333333','Membeli kopi','Pangan'," +
    'NULL,$1::uuid,$2::uuid';
  const bantuan = await rpc('umkm_bantu_permintaan', args, [profil, op]);
  expect(bantuan.kode_tautan).toMatch(/^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){2}$/);
  expect(await rpc('umkm_bantu_permintaan', args, [profil, op])).toMatchObject({ kode_tautan: null });
  await expect(rpc('umkm_setujui_dan_buka', '$1::uuid,1,$2::uuid', [bantuan.id, randomUUID()]))
    .rejects.toThrow('BELUM_TERTAUT');
  expect(await rpc('umkm_tautkan_akun', "'SALAH'", [], user)).toEqual({ tertaut: false });
  const kode = String(bantuan.kode_tautan).toLowerCase().replaceAll('-', ' ');
  expect(await rpc('umkm_tautkan_akun', '$1', [kode], user)).toMatchObject({ id: bantuan.id });
  expect(await rpc('umkm_tautkan_akun', '$1', [kode], user)).toEqual({ tertaut: false });
});

it('pengawasan tanpa data pemohon, laporan memisahkan hasil dan retensi hanya mengosongkan rincian layak', async () => {
  const report = await rpc('umkm_laporan_statistik', '', [], admin);
  expect(report).toMatchObject({ permintaan: { nomor_dibuka: 1 },
    hasil: { belum_diketahui: 1, kerja_sama: 0 } });
  const trace = await rpc('umkm_jejak_pengawasan', '', [], admin);
  const text = JSON.stringify(trace);
  expect(text).not.toMatch(/082222222222|081111111111|081333333333|Membeli kopi|Perusahaan bantuan/);
  expect(trace).toMatchObject({ items: expect.arrayContaining([
    expect.objectContaining({ aksi: 'ajukan', aktor_nama: 'Pemohon', permintaan_versi: expect.any(Number) }),
  ]) });
  const bantuan = await rpc('umkm_bantu_permintaan',
    "'Perusahaan lama','Pembeli','Rina','081444444444','Kebutuhan lama','Pangan',NULL,$1::uuid,$2::uuid",
    [profil, randomUUID()]);
  await rpc('umkm_tolak_permintaan', "$1::uuid,1,$2::uuid,'Tidak cocok'", [bantuan.id, randomUUID()]);
  await db.query("UPDATE umkm_permintaan_kontak SET ditutup_pada=now()-interval '731 days' WHERE id=$1",
    [bantuan.id]);
  await db.query(`UPDATE umkm_kebutuhan SET status='ditutup',ditutup_pada=now()-interval '731 days'
    WHERE id=$1`, [bantuan.kebutuhan_id]);
  await db.query('SELECT umkm_private.bersihkan_retensi()');
  const cleared = await db.query(`SELECT r.status,r.nama_bantuan,r.kontak_bantuan,r.tautan_hash,k.teks
    FROM umkm_permintaan_kontak r JOIN umkm_kebutuhan k ON k.id=r.kebutuhan_id WHERE r.id=$1`, [bantuan.id]);
  expect(cleared.rows[0]).toEqual({ status: 'ditolak', nama_bantuan: null,
    kontak_bantuan: null, tautan_hash: null, teks: '' });
  expect(await rpc('umkm_laporan_statistik', '', [], admin)).toMatchObject({ permintaan: { ditolak: 1 } });
});
