// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';
import type { Detail, Mutasi } from './types';

let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
const uid = randomUUID(), staff = randomUUID();
const data = { nama: 'Keripik Lampung', deskripsi: 'Olahan pangan', jenis: 'Produk', kategori: 'Pangan', kabupaten_kota: 'Lampung', sumber: 'kurasi' };
async function rpc<T>(nama: string, args: string, params: unknown[]): Promise<T> {
  const r = await sebagai(db, 'authenticated', uid, `SELECT public.${nama}(${args}) AS j`, params);
  if (!r.ok) throw new Error(r.pesan);
  return (r.rows[0] as { j: T }).j;
}
const simpan = (d: object, id: string | null = null, version: number | null = null) =>
  rpc<Mutasi>('umkm_simpan_profil', '$1::jsonb,$2::uuid,$3::uuid,$4::integer', [JSON.stringify(d), randomUUID(), id, version]);
const putus = (p: Mutasi) => rpc<Mutasi>('umkm_putuskan_profil', '$1::uuid,$2::integer,$3::uuid,$4::text', [p.id,p.versi,randomUUID(),'terbit']);
beforeAll(async () => {
  db = await bukaDbPenuh();
  const seed = await sebagai(db, 'postgres', null, `INSERT INTO auth.users(id) VALUES ($1);
  `, [uid]);
  expect(seed.ok).toBe(true);
  const s = await sebagai(db, 'postgres', null, `INSERT INTO petugas(id,auth_user_id,nama,role,aktif,pemeriksa_umkm) VALUES ($1,$2,'Pemeriksa','admin',true,true)`, [staff,uid]);
  expect(s.ok).toBe(true);
  const adminUser = randomUUID(), admin = randomUUID();
  expect((await sebagai(db, 'postgres', null, 'INSERT INTO auth.users(id) VALUES ($1)', [adminUser])).ok).toBe(true);
  expect((await sebagai(db, 'postgres', null, `
    INSERT INTO petugas(id,auth_user_id,nama,role,aktif) VALUES ($1,$2,'Admin pemberi','admin',true)`,
  [admin, adminUser])).ok).toBe(true);
  const flag = await sebagai(db, 'authenticated', adminUser,
    'SELECT public.umkm_atur_pemeriksa($1,true,$2)', [staff, randomUUID()]);
  expect(flag.ok).toBe(true);
}, 30000);
afterAll(async () => { await db?.close(); });

describe('perilaku DB melalui RPC UMKM', () => {
  it('izin tidak mengubah mendesak dan profil selesai tersembunyi keluar antrean', async () => {
    let p = await putus(await simpan({ ...data, nomor: '081234567890' }));
    p = await rpc<Mutasi>('umkm_ubah_izin', '$1::uuid,$2::integer,$3::uuid,$4::text', [
      p.id, p.versi, randomUUID(), 'dicabut',
    ]);
    let detail = await rpc<Detail>('umkm_detail_tugas', '$1::uuid', [p.id]);
    expect(detail.mendesak).toBe(false);
    expect((await sebagai(db, 'postgres', null, 'UPDATE umkm_profil SET mendesak=true WHERE id=$1', [p.id])).ok)
      .toBe(true);
    p = await rpc<Mutasi>('umkm_ubah_izin', '$1::uuid,$2::integer,$3::uuid,$4::text', [
      p.id, p.versi, randomUUID(), 'diberikan',
    ]);
    detail = await rpc<Detail>('umkm_detail_tugas', '$1::uuid', [p.id]);
    expect(detail.mendesak).toBe(true);
    expect((await sebagai(db, 'postgres', null, 'UPDATE umkm_profil SET mendesak=false WHERE id=$1', [p.id])).ok)
      .toBe(true);
    p = await rpc<Mutasi>('umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4::text', [
      p.id, p.versi, randomUUID(), 'sembunyikan',
    ]);
    const queue = await rpc<{ items: { id: string }[] }>('umkm_daftar_tugas', '', []);
    expect(queue.items.map(item => item.id)).not.toContain(p.id);
  });
  it('nomor ditutup setelah putusan, ambil alih tetap boleh, revisi terbuka membuka akses', async () => {
    let p = await putus(await simpan({ ...data, nomor: '081234567890' }));
    p = await rpc<Mutasi>('umkm_ambil_tugas', '$1::uuid,$2::integer,$3::uuid', [
      p.id, p.versi, randomUUID(),
    ]);
    await expect(rpc('umkm_akses_kontak_petugas', '$1::uuid', [p.id])).rejects.toThrow('DILARANG');
    p = await simpan({ ...data, nama: 'Koreksi kontak terbuka' }, p.id, p.versi);
    await expect(rpc('umkm_akses_kontak_petugas', '$1::uuid', [p.id]))
      .resolves.toEqual({ nomor: '081234567890' });
    await putus(p);
  });
  it('admin tidak mengaktifkan penanda sendiri tetapi boleh mematikannya', async () => {
    await expect(rpc('umkm_atur_pemeriksa', '$1::uuid,$2::boolean,$3::uuid', [staff, true, randomUUID()]))
      .rejects.toThrow('DILARANG');
    await expect(rpc('umkm_atur_pemeriksa', '$1::uuid,$2::boolean,$3::uuid', [staff, false, randomUUID()]))
      .resolves.toMatchObject({ pemeriksa_umkm: false });
    const adminUser = randomUUID();
    expect((await sebagai(db, 'postgres', null, 'INSERT INTO auth.users(id) VALUES ($1)', [adminUser])).ok)
      .toBe(true);
    expect((await sebagai(db, 'postgres', null, `
      INSERT INTO petugas(auth_user_id,nama,role,aktif) VALUES ($1,'Admin pemulih','admin',true)`, [adminUser])).ok)
      .toBe(true);
    expect((await sebagai(db, 'authenticated', adminUser,
      'SELECT public.umkm_atur_pemeriksa($1,true,$2)', [staff, randomUUID()])).ok).toBe(true);
  });
  it('penanda hanya lewat RPC dan perubahan identitas diaudit, layanan tidak mencabut', async () => {
    const user = randomUUID(), target = randomUUID(), nextUser = randomUUID();
    expect((await sebagai(db, 'postgres', null, 'INSERT INTO auth.users(id) VALUES ($1),($2)',
      [user, nextUser])).ok).toBe(true);
    const inserted = await sebagai(db, 'postgres', null, `
      INSERT INTO public.petugas(id,auth_user_id,nama,role,aktif,pemeriksa_umkm)
      VALUES ($1,$2,'Petugas baru','petugas',true,true) RETURNING pemeriksa_umkm`, [target, user]);
    expect(inserted.rows).toEqual([{ pemeriksa_umkm: false }]);
    const direct = await sebagai(db, 'authenticated', uid,
      'UPDATE public.petugas SET pemeriksa_umkm=true WHERE id=$1', [target]);
    expect(direct).toMatchObject({ ok: false, kode: '42501' });
    await rpc('umkm_atur_pemeriksa', '$1::uuid,$2::boolean,$3::uuid', [target, true, randomUUID()]);
    const layanan = await sebagai(db, 'postgres', null, `
      INSERT INTO public.layanan(nama,tipe) VALUES ('Layanan penanda','konsultatif') RETURNING id`);
    expect(layanan.ok).toBe(true);
    const changed = await sebagai(db, 'authenticated', uid, `
      UPDATE public.petugas SET layanan_id=$1 WHERE id=$2 RETURNING pemeriksa_umkm`,
    [(layanan.rows[0] as { id: string }).id, target]);
    expect(changed.rows).toEqual([{ pemeriksa_umkm: true }]);
    const relink = await sebagai(db, 'authenticated', uid, `
      UPDATE public.petugas SET auth_user_id=$1 WHERE id=$2 RETURNING pemeriksa_umkm`, [nextUser, target]);
    expect(relink.rows).toEqual([{ pemeriksa_umkm: false }]);
    const audit = await sebagai(db, 'postgres', null,
      "SELECT nilai_lama,nilai_baru FROM audit_log WHERE entitas='petugas' AND entitas_id=$1", [target]);
    expect(audit.rows).toContainEqual(expect.objectContaining({
      nilai_lama: expect.objectContaining({ auth_user_id: user, pemeriksa_umkm: true }),
      nilai_baru: expect.objectContaining({ auth_user_id: nextUser, pemeriksa_umkm: false }),
    }));
  });
  it('alamat privat dan foto tersembunyi tidak menghalangi penerbitan', async () => {
    let p = await simpan({ ...data, alamat: 'Jalan Usaha 081234567890', foto: [
      { asal: 'eksternal', url: 'https://example.test/081234567890.jpg' },
    ] });
    const detail = await rpc<Detail>('umkm_detail_tugas', '$1::uuid', [p.id]);
    p = await rpc<Mutasi>('umkm_ubah_visibilitas', '$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid', [
      p.id, p.versi, randomUUID(), 'sembunyikan', detail.foto[0].id,
    ]);
    expect(p.peringatan_kontak).toEqual([]);
    await expect(putus(p)).resolves.toMatchObject({ status: 'terbit' });
  });
  it('deteksi kontak menormalkan digit dan pemisah tanpa memblokir angka wajar', async () => {
    const kontak = [
      '0812\u00a03456\u00a07890', '0812–3456–7890', '0812\n3456\n7890', '0812\t3456\t7890',
      '0812\u200b3456\u200b7890', '0812_3456_7890', '0812,,,3456,,,7890', '0812:3456*7890',
      '０８１２３４５６７８９０', '٠٨١٢٣٤٥٦٧٨٩٠', '۰۸۱۲۳۴۵۶۷۸۹۰', '०८१२३४५६७८९०',
      'https://instagram.com/0812_3456_7890', 'https://a.test/%30%38%31%32%33%34%35%36%37%38%39%30.jpg',
      'wa . me', 'wa.link/abc', 't . me/abc', 'linktr . ee/abc', 'tel:123', 'mailto:a@b.id',
      'seri 123 0812 3456 7890', '6281234567890', '8123456789',
    ];
    const wajar = [
      'Rp 10.000.000', 'Rp 1.000.000.000', 'sejak 2010', 'foto_1699999999.jpg',
      'kode pos 35111', 'NIB 1234567890123', 'NIB 7891234567890', '0812----3456----7890',
    ];
    for (const [values, expected] of [[kontak, true], [wajar, false]] as const) {
      for (const value of values) {
        const result = await sebagai(db, 'postgres', null, 'SELECT umkm_private.ada_kontak($1) AS ada', [value]);
        expect(result.ok).toBe(true);
        expect(result.rows[0], value).toEqual({ ada: expected });
      }
    }
  });
  it('menambah foto tidak memulihkan foto lama yang disembunyikan', async () => {
    const foto = { asal: 'eksternal', url: 'https://example.test/keripik.jpg' };
    let p = await putus(await simpan({ ...data, foto: [foto] }));
    const detail = await rpc<Detail>('umkm_detail_tugas','$1::uuid',[p.id]);
    p = await rpc<Mutasi>('umkm_ubah_visibilitas','$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid',[p.id,p.versi,randomUUID(),'sembunyikan',detail.foto[0].id]);
    p = await putus(await simpan({ ...data, foto: [foto, {asal:'eksternal',url:'https://example.test/baru.jpg'}] },p.id,p.versi));
    const result = await sebagai(db,'anon',null,'SELECT public.umkm_profil_publik($1) AS j',[p.id]);
    expect(result.ok).toBe(true);
    const pub = (result.rows[0] as {j:{foto:{url:string}[]}}).j;
    expect(pub.foto.map(f => f.url)).toEqual(['https://example.test/baru.jpg']);
  });
  it('hide foto pada koreksi langsung menyembunyikan foto snapshot terbit', async () => {
    const foto = {asal:'eksternal',url:'https://example.test/kopi.jpg'};
    let p = await putus(await simpan({...data,foto:[foto]}));
    p = await simpan({...data,nama:'Koreksi nama'},p.id,p.versi);
    const detail = await rpc<Detail>('umkm_detail_tugas','$1::uuid',[p.id]);
    const op=randomUUID();
    p = await rpc<Mutasi>('umkm_ubah_visibilitas','$1::uuid,$2::integer,$3::uuid,$4::text,$5::uuid',[p.id,p.versi,op,'sembunyikan',detail.foto[0].id]);
    const result=await sebagai(db,'anon',null,'SELECT public.umkm_profil_publik($1) AS j',[p.id]);
    expect(result.ok).toBe(true);
    expect((result.rows[0] as {j:{foto:unknown[]}}).j.foto).toEqual([]);
    const history=await sebagai(db,'postgres',null,'SELECT referensi FROM umkm_riwayat WHERE operasi_id=$1',[op]);
    expect(history.ok).toBe(true);
    expect((history.rows[0] as {referensi:unknown}).referensi).toMatchObject({foto_id:detail.foto[0].id,aksi_visibilitas:'sembunyikan'});
    await putus(p);
  });
  it('nomor di label publik juga menghalangi penerbitan', async () => {
    for (const field of ['jenis','kategori','spesifik','kabupaten_kota']) {
      const p = await simpan({...data,[field]:'Hubungi 081234567890'});
      await expect(putus(p)).rejects.toThrow('KONTAK_PUBLIK');
      await rpc<Mutasi>('umkm_putuskan_profil','$1::uuid,$2::integer,$3::uuid,$4::text,$5::text',[p.id,p.versi,randomUUID(),'ditolak','Perlu diperbaiki']);
    }
  });
  it('menolak field aktor serta URL sosial di luar domain langsung di RPC', async () => {
    await expect(simpan({...data,aktor_id:staff})).rejects.toThrow('INPUT_TIDAK_VALID');
    await expect(simpan({...data,instagram:'https://instagram.com.evil.test/p'})).rejects.toThrow('INPUT_TIDAK_VALID');
    await expect(simpan({...data,foto:[{asal:'eksternal',url:'https://127.0.0.1/foto.jpg'}]})).rejects.toThrow('INPUT_TIDAK_VALID');
  });
  it('daftar maksimal 20 dan mendahulukan tugas mendesak', async () => {
    const ids: string[] = [];
    for(let i=0;i<22;i++) ids.push((await simpan({...data,nama:`Usaha ${i}`})).id);
    const urgent=ids[ids.length-1];
    const update=await sebagai(db,'postgres',null,'UPDATE umkm_profil SET mendesak=true WHERE id=$1',[urgent]);
    expect(update.ok).toBe(true);
    const first=await rpc<{items:{id:string}[];next_cursor:string|null}>('umkm_daftar_tugas','',[]);
    expect(first.items).toHaveLength(20); expect(first.items[0].id).toBe(urgent); expect(first.next_cursor).toBeTruthy();
    const second=await rpc<{items:{id:string}[];next_cursor:string|null}>('umkm_daftar_tugas','$1::uuid',[first.next_cursor]);
    expect(second.items).toHaveLength(2); expect(new Set([...first.items,...second.items].map(p=>p.id)).size).toBe(22);
  });
});
