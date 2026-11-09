// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';

let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
const staffUser = randomUUID(), staff = randomUUID(), admin = randomUUID();
const profil = randomUUID(), revisi = randomUUID(), kontak = randomUUID();
async function rpc(fn: string, args = '', values: unknown[] = [], uid: string = staffUser) {
  const result = await sebagai(db, 'authenticated', uid, `SELECT public.${fn}(${args}) j`, values);
  if (!result.ok) throw new Error(result.pesan);
  return (result.rows[0] as { j: Record<string, unknown> }).j;
}
async function perusahaan() {
  const uid = randomUUID();
  await db.query('INSERT INTO auth.users(id) VALUES ($1)', [uid]);
  const company = await rpc('umkm_simpan_perusahaan', "'Perusahaan pribadi','Pembeli',true", [], uid);
  const need = await rpc('umkm_simpan_kebutuhan', "'Membeli kopi','Pangan'", [], uid);
  return { uid, company: company.id, need: need.id };
}
async function ajukan(uid: string, need: unknown) {
  const batch = await rpc('umkm_ajukan_kontak', '$1::uuid,$2::uuid[],$3::uuid',
    [need, [profil], randomUUID()], uid);
  return (batch.items as { id: string; versi: number }[])[0];
}
beforeAll(async () => {
  db = await bukaDbPenuh();
  await db.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [staffUser, admin]);
  await db.query(`INSERT INTO petugas(id,auth_user_id,nama,role,aktif)
    VALUES ($1,$2,'Petugas','petugas',true),(gen_random_uuid(),$3,'Admin','admin',true)`,
  [staff, staffUser, admin]);
  await rpc('umkm_atur_pemeriksa', '$1::uuid,true,$2::uuid', [staff, randomUUID()], admin);
  await db.query("INSERT INTO umkm_profil(id,sumber,status) VALUES ($1,'kurasi','terbit')", [profil]);
  await db.query(`INSERT INTO umkm_revisi(id,profil_id,versi,nama,deskripsi,jenis,kategori,
    kabupaten_kota,keputusan,dibuat_oleh) VALUES ($1,$2,1,'Kopi','Olahan','Produk','Pangan',
    'Lampung','terbit',$3)`, [revisi, profil, staff]);
  await db.query(`INSERT INTO umkm_kontak_versi(id,profil_id,nomor,dibuat_oleh)
    VALUES ($1,$2,'082222222222',$3)`, [kontak, profil, staff]);
  await db.query(`UPDATE umkm_profil SET revisi_disetujui_id=$2,revisi_terakhir_id=$2,
    kontak_terakhir_id=$3 WHERE id=$1`, [profil, revisi, kontak]);
}, 30000);
afterAll(async () => { await db?.close(); });

it('akun terhapus menutup kebutuhan dan retensi semua permintaannya tanpa membuka nomor', async () => {
  const { uid, need, company } = await perusahaan();
  const opened = await ajukan(uid, need);
  await rpc('umkm_ambil_pekerjaan', "'permintaan',$1::uuid,1,$2::uuid", [opened.id, randomUUID()]);
  await rpc('umkm_ubah_izin', "$1::uuid,1,$2::uuid,'diberikan'", [profil, randomUUID()]);
  await rpc('umkm_setujui_dan_buka', '$1::uuid,2,$2::uuid', [opened.id, randomUUID()]);
  const secondNeed = await rpc('umkm_simpan_kebutuhan', "'Kebutuhan kedua','Pangan'", [], uid);
  const pending = await ajukan(uid, secondNeed.id);
  await rpc('umkm_tahan_permintaan', "$1::uuid,'Periksa lagi',3,$2::uuid", [opened.id, randomUUID()], admin);
  await rpc('umkm_tahan_permintaan', "$1::uuid,'Periksa lagi',1,$2::uuid", [pending.id, randomUUID()], admin);
  await db.query('DELETE FROM auth.users WHERE id=$1', [uid]);
  const needs = await db.query('SELECT status FROM umkm_kebutuhan WHERE perusahaan_id=$1', [company]);
  expect(needs.rows).toEqual([{ status: 'ditutup' }, { status: 'ditutup' }]);
  const requests = await db.query(`SELECT id,status,pemohon_uid,ditutup_pada IS NOT NULL tertutup
    FROM umkm_permintaan_kontak WHERE id=ANY($1::uuid[]) ORDER BY status`, [[opened.id, pending.id]]);
  expect(requests.rows).toEqual([
    { id: pending.id, status: 'dibatalkan', pemohon_uid: null, tertutup: true },
    { id: opened.id, status: 'nomor_dibuka', pemohon_uid: null, tertutup: true },
  ]);
  const queue = await rpc('umkm_daftar_tugas');
  expect((queue.items as { id: string }[]).map(item => item.id)).not.toContain(pending.id);
  expect((queue.items as { id: string }[]).map(item => item.id)).not.toContain(opened.id);
  await expect(rpc('umkm_baca_nomor', '$1::uuid', [opened.id], uid)).rejects.toThrow();
});

it('retensi memakai penutupan kebutuhan dan menjaga teks aktif serta perusahaan yang masih punya akun', async () => {
  const live = await perusahaan(), deleted = await perusahaan();
  await rpc('umkm_tutup_kebutuhan', '$1::uuid', [deleted.need], deleted.uid);
  const closed = await db.query('SELECT ditutup_pada FROM umkm_kebutuhan WHERE id=$1', [deleted.need]);
  expect(closed.rows[0].ditutup_pada).not.toBeNull();
  await db.query('DELETE FROM auth.users WHERE id=$1', [deleted.uid]);
  const liveRequest = await ajukan(live.uid, live.need);
  await rpc('umkm_batalkan_permintaan', '$1::uuid', [liveRequest.id], live.uid);
  await db.query(`UPDATE umkm_permintaan_kontak SET ditutup_pada=now()-interval '731 days'
    WHERE id=$1`, [liveRequest.id]);
  await db.query(`UPDATE umkm_kebutuhan SET ditutup_pada=now()-interval '731 days',
    dibuat_pada=now()-interval '800 days' WHERE id=$1`, [deleted.need]);
  await db.query("UPDATE umkm_perusahaan SET dibuat_pada=now()-interval '800 days' WHERE id=ANY($1::uuid[])",
    [[live.company, deleted.company]]);
  await db.query('SELECT umkm_private.bersihkan_retensi()');
  expect((await db.query('SELECT teks FROM umkm_kebutuhan WHERE id=$1', [deleted.need])).rows)
    .toEqual([{ teks: '' }]);
  expect((await db.query('SELECT teks FROM umkm_kebutuhan WHERE id=$1', [live.need])).rows)
    .toEqual([{ teks: 'Membeli kopi' }]);
  expect((await db.query('SELECT nama,jabatan FROM umkm_perusahaan WHERE id=$1', [deleted.company])).rows)
    .toEqual([{ nama: 'Perusahaan dihapus', jabatan: 'Dihapus' }]);
  expect(await rpc('umkm_perusahaan_saya', '', [], live.uid))
    .toMatchObject({ perusahaan: { nama: 'Perusahaan pribadi', jabatan: 'Pembeli' } });
});

it('retensi menunggu penutupan dan permintaan terakhir, termasuk perusahaan bantuan tanpa kebutuhan', async () => {
  const { uid, company } = await perusahaan();
  for (const [closedDays, requestDays] of [[729, null], [1, null], [731, 729], [731, null]]) {
    const need = await rpc('umkm_simpan_kebutuhan', "'Teks masih diperlukan','Pangan'", [], uid);
    if (requestDays !== null) {
      const request = await ajukan(uid, need.id);
      await rpc('umkm_batalkan_permintaan', '$1::uuid', [request.id], uid);
      await db.query(`UPDATE umkm_permintaan_kontak SET ditutup_pada=now()-make_interval(days=>$2)
        WHERE id=$1`, [request.id, requestDays]);
    }
    await rpc('umkm_tutup_kebutuhan', '$1::uuid', [need.id], uid);
    await db.query(`UPDATE umkm_kebutuhan SET dibuat_pada=now()-interval '800 days',
      ditutup_pada=now()-make_interval(days=>$2) WHERE id=$1`, [need.id, closedDays]);
    await db.query('SELECT umkm_private.bersihkan_retensi()');
    expect((await db.query('SELECT teks FROM umkm_kebutuhan WHERE id=$1', [need.id])).rows[0].teks)
      .toBe(closedDays === 731 && requestDays === null ? '' : 'Teks masih diperlukan');
  }
  await db.query("UPDATE umkm_perusahaan SET dibuat_pada=now()-interval '800 days' WHERE id=$1", [company]);
  await db.query('SELECT umkm_private.bersihkan_retensi()');
  expect(await rpc('umkm_perusahaan_saya', '', [], uid))
    .toMatchObject({ perusahaan: { nama: 'Perusahaan pribadi' } });
  const orphan = randomUUID(), recent = randomUUID();
  await db.query(`INSERT INTO umkm_perusahaan(id,nama,jabatan,dibuat_pada) VALUES
    ($1,'Bantuan lama','Pembeli',now()-interval '731 days'),($2,'Bantuan baru','Pembeli',now())`,
  [orphan, recent]);
  await db.query('SELECT umkm_private.bersihkan_retensi()');
  expect((await db.query('SELECT nama FROM umkm_perusahaan WHERE id=$1', [orphan])).rows[0].nama)
    .toBe('Perusahaan dihapus');
  expect((await db.query('SELECT nama FROM umkm_perusahaan WHERE id=$1', [recent])).rows[0].nama)
    .toBe('Bantuan baru');
});

it('detail mempertahankan pembanding bantuan setelah tertaut dan mengosongkannya sesudah retensi', async () => {
  const { uid, need } = await perusahaan();
  const normal = await ajukan(uid, need);
  expect(await rpc('umkm_detail_permintaan', '$1::uuid', [normal.id])).toMatchObject({ bantuan: null });
  const bantuan = await rpc('umkm_bantu_permintaan',
    "'Perusahaan bantuan','Pembeli','Rina','081333333333','Membeli kopi','Pangan',NULL,$1::uuid,$2::uuid",
    [profil, randomUUID()]);
  expect(await rpc('umkm_detail_permintaan', '$1::uuid', [bantuan.id]))
    .toMatchObject({ bantuan: { nama: 'Rina', kontak: '081333333333' }, tertaut: false });
  await rpc('umkm_tautkan_akun', '$1', [bantuan.kode_tautan], uid);
  expect(await rpc('umkm_detail_permintaan', '$1::uuid', [bantuan.id]))
    .toMatchObject({ bantuan: { nama: 'Rina', kontak: '081333333333' }, tertaut: true });
  await rpc('umkm_batalkan_permintaan', '$1::uuid', [bantuan.id], uid);
  await db.query("UPDATE umkm_permintaan_kontak SET ditutup_pada=now()-interval '731 days' WHERE id=$1",
    [bantuan.id]);
  await db.query('SELECT umkm_private.bersihkan_retensi()');
  expect(await rpc('umkm_detail_permintaan', '$1::uuid', [bantuan.id])).toMatchObject({ bantuan: null });
});

it('tahan menolak status tertutup, tetapi permintaan yang dibatalkan saat ditahan tetap bisa diambil dan dilepas',
  async () => {
    const { uid, need } = await perusahaan();
    const request = await ajukan(uid, need);
    await rpc('umkm_batalkan_permintaan', '$1::uuid', [request.id], uid);
    await expect(rpc('umkm_tahan_permintaan', "$1::uuid,'Periksa lagi',2,$2::uuid",
      [request.id, randomUUID()], admin)).rejects.toThrow('KONFLIK_STATUS');
    const rejected = await ajukan(uid, need);
    await rpc('umkm_ambil_pekerjaan', "'permintaan',$1::uuid,1,$2::uuid", [rejected.id, randomUUID()]);
    await rpc('umkm_tolak_permintaan', "$1::uuid,2,$2::uuid,'Tidak cocok'", [rejected.id, randomUUID()]);
    await expect(rpc('umkm_tahan_permintaan', "$1::uuid,'Periksa lagi',3,$2::uuid",
      [rejected.id, randomUUID()], admin)).rejects.toThrow('KONFLIK_STATUS');
    const held = await ajukan(uid, need);
    await rpc('umkm_tahan_permintaan', "$1::uuid,'Periksa lagi',1,$2::uuid", [held.id, randomUUID()], admin);
    await rpc('umkm_batalkan_permintaan', '$1::uuid', [held.id], uid);
    expect(await rpc('umkm_ambil_pekerjaan', "'permintaan',$1::uuid,3,$2::uuid", [held.id, randomUUID()]))
      .toMatchObject({ status: 'dibatalkan', tahan_darurat: true, versi: 4 });
    expect(await rpc('umkm_lepas_tahan', '$1::uuid,4,$2::uuid', [held.id, randomUUID()]))
      .toMatchObject({ status: 'dibatalkan', tahan_darurat: false, versi: 5 });
  });
