// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bukaDbPenuh, sebagai } from '../../../scripts/lokal-rantai/harness.mjs';

let db: Awaited<ReturnType<typeof bukaDbPenuh>>;
const akun = { biasa: randomUUID(), anonim: randomUUID(), admin: randomUUID(), fo: randomUUID(),
  pemeriksa: randomUUID() };
const staf = randomUUID();
let profil: string;
async function sql(teks: string, args: unknown[] = []) {
  const r = await sebagai(db, 'postgres', null, teks, args);
  if (!r.ok) throw new Error(r.pesan);
  return r.rows as Record<string, unknown>[];
}
async function rpc(who: keyof typeof akun | 'service_role' | 'anon', fn: string, args = '', values: unknown[] = []) {
  const role = who === 'service_role' || who === 'anon' ? who : 'authenticated';
  const uid = who in akun ? akun[who as keyof typeof akun] : null;
  const r = await sebagai(db, role, uid, `SELECT public.${fn}(${args}) j`, values,
    who === 'anonim' ? { is_anonymous: true } : undefined);
  if (!r.ok) throw new Error(r.pesan);
  return (r.rows[0] as { j: Record<string, unknown> }).j;
}
async function buatProfil(nama = 'Kopi', kategori = 'Pangan', kota = 'Lampung') {
  const id = randomUUID(), revisi = randomUUID();
  await sql("INSERT INTO umkm_profil(id,sumber,status,terbit_pada) VALUES ($1,'kurasi','terbit',now())", [id]);
  await sql(`INSERT INTO umkm_revisi(id,profil_id,versi,nama,deskripsi,jenis,kategori,kabupaten_kota,
    keputusan,dibuat_oleh) VALUES ($1,$2,1,$3,'Olahan','Produk',$4,$5,'terbit',$6)`,
  [revisi, id, nama, kategori, kota, staf]);
  await sql('UPDATE umkm_profil SET revisi_disetujui_id=$2,revisi_terakhir_id=$2 WHERE id=$1', [id, revisi]);
  return id;
}
beforeAll(async () => {
  db = await bukaDbPenuh();
  await sql('INSERT INTO auth.users(id) SELECT unnest($1::uuid[])', [Object.values(akun)]);
  await sql(`INSERT INTO petugas(id,auth_user_id,nama,role,aktif)
    VALUES ($1,$2,'Admin statistik','admin',true)`, [staf, akun.admin]);
  await sql(`INSERT INTO petugas(auth_user_id,nama,role,aktif)
    VALUES ($1,'FO statistik','front_office',true)`, [akun.fo]);
  const pemeriksa = randomUUID();
  await sql(`INSERT INTO petugas(id,auth_user_id,nama,role,aktif)
    VALUES ($1,$2,'Pemeriksa statistik','petugas',true)`, [pemeriksa, akun.pemeriksa]);
  await rpc('admin', 'umkm_atur_pemeriksa', '$1::uuid,true,$2::uuid', [pemeriksa, randomUUID()]);
  profil = await buatProfil();
}, 30000);
afterAll(async () => { await db?.close(); });

it('suka true/false idempoten, tanggal pertama tetap dan hapus akun mengurangi total sekali', async () => {
  const suka = (aktif: boolean) => rpc('biasa', 'umkm_suka', '$1::uuid,$2::boolean', [profil, aktif]);
  expect(await suka(true)).toMatchObject({ suka_saya: true, suka: 1 });
  expect(await suka(true)).toMatchObject({ suka: 1 });
  const pertama = (await sql('SELECT pertama_pada FROM umkm_stat_suka WHERE profil_id=$1', [profil]))[0];
  expect(await suka(false)).toMatchObject({ suka_saya: false, suka: 0 });
  expect(await suka(false)).toMatchObject({ suka: 0 });
  expect(await suka(true)).toMatchObject({ suka: 1 });
  expect((await sql('SELECT pertama_pada FROM umkm_stat_suka WHERE profil_id=$1', [profil]))[0]).toEqual(pertama);
  for (const who of ['anonim', 'admin', 'fo', 'anon'] as const) {
    await expect(rpc(who, 'umkm_suka', '$1::uuid,true', [profil])).rejects.toThrow();
  }
  await sql('DELETE FROM auth.users WHERE id=$1', [akun.biasa]);
  expect((await sql('SELECT suka::integer suka FROM umkm_stat_total WHERE profil_id=$1', [profil]))[0])
    .toEqual({ suka: 0 });
  await sql('INSERT INTO auth.users(id) VALUES ($1)', [akun.biasa]);
});

it('sakelar mati tanpa baris, aktif dedup atomik, staf dikecualikan dan input grup bebas dibuang', async () => {
  const catat = (identity = 'cookie-acak', uid: string | null = null) => rpc('service_role',
    'umkm_catat_statistik', '$1::text,$2::uuid,$3::text,$4::uuid', ['dilihat', profil, identity, uid]);
  expect(await catat()).toEqual({ dicatat: false });
  expect((await sql('SELECT count(*)::integer n FROM umkm_stat_kejadian'))[0]).toEqual({ n: 0 });
  await expect(rpc('fo', 'umkm_atur_telemetri', 'true,$1,true', ['v1'])).rejects.toThrow('DILARANG');
  await expect(rpc('admin', 'umkm_atur_telemetri', 'true,$1,false', ['v1'])).rejects.toThrow();
  await rpc('admin', 'umkm_atur_telemetri', 'true,$1,true', ['v1']);
  expect(await catat()).toEqual({ dicatat: true });
  expect(await catat()).toEqual({ dicatat: false });
  expect(await catat('staf', akun.admin)).toEqual({ dicatat: false });
  expect(await catat('perangkat-a', akun.biasa)).toEqual({ dicatat: true });
  expect(await catat('perangkat-b', akun.biasa)).toEqual({ dicatat: false });
  const klik = await rpc('service_role', 'umkm_catat_statistik', '$1,$2::uuid,$3',
    ['klik_formulir', profil, 'cookie-acak']);
  expect(klik).toEqual({ dicatat: true });
  expect((await sql('SELECT dilihat::integer,klik_formulir::integer FROM umkm_stat_total WHERE profil_id=$1',
    [profil]))[0]).toEqual({ dilihat: 2, klik_formulir: 1 });
  const hari = (await sql("SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date::text hari"))[0].hari;
  expect((await sql(`SELECT hari::text,dilihat::integer,klik_formulir::integer FROM umkm_stat_harian
    WHERE profil_id=$1`, [profil]))[0]).toEqual({ hari, dilihat: 2, klik_formulir: 1 });
  await rpc('service_role', 'umkm_catat_tanpa_hasil', '$1,$2', ['nomor 081234567890', 'kata bebas']);
  await rpc('service_role', 'umkm_catat_tanpa_hasil', '$1,$2', ['Pangan', 'Lampung']);
  expect(await sql('SELECT kategori,kabupaten_kota,jumlah::integer FROM umkm_stat_tanpa_hasil ORDER BY kategori'))
    .toEqual([{ kategori: '', kabupaten_kota: '', jumlah: 1 },
      { kategori: 'Pangan', kabupaten_kota: 'Lampung', jumlah: 1 }]);
  await expect(rpc('biasa', 'umkm_catat_statistik', '$1,$2::uuid,$3',
    ['dilihat', profil, 'pemalsuan'])).rejects.toThrow('permission denied');
});

it('formula 90 hari, snapshot aktif tunggal, slot baru dan cursor tanpa kehilangan profil', async () => {
  const ids: string[] = [];
  for (let i = 0; i < 31; i++) ids.push(await buatProfil(`Urutan ${i}`, 'Urutan'));
  await sql(`UPDATE umkm_profil SET terbit_pada=now()-interval '40 days'
    WHERE id=ANY($1::uuid[])`, [ids.slice(0, 29)]);
  await rpc('biasa', 'umkm_suka', '$1::uuid,true', [ids[0]]);
  await sql(`INSERT INTO umkm_stat_harian(hari,profil_id,dilihat) VALUES
    ((now() AT TIME ZONE 'Asia/Jakarta')::date,$1,7),
    ((now() AT TIME ZONE 'Asia/Jakarta')::date-90,$1,99)`, [ids[0]]);
  await sql('SELECT umkm_private.perbarui_skor()');
  expect((await sql('SELECT l90::integer,v90::integer,skor::integer FROM umkm_skor WHERE profil_id=$1',
    [ids[0]]))[0]).toEqual({ l90: 1, v90: 7, skor: 12 });
  const cari = (cursor: string | null = null) => rpc('anon', 'umkm_cari_katalog',
    "NULL,NULL,'Urutan',NULL,NULL,'paling_sesuai',$1::text", [cursor]);
  const page = await cari();
  const items = page.items as { id: string; baru: boolean }[];
  expect(items).toHaveLength(20);
  expect(items[0].id).toBe(ids[0]);
  expect([items[4].id, items[14].id].sort()).toEqual(ids.slice(29).sort());
  expect(items[4].baru && items[14].baru).toBe(true);
  const page2 = await cari(page.next_cursor as string);
  const semua = [...items, ...(page2.items as { id: string }[])].map(x => x.id);
  expect(semua).toHaveLength(31);
  expect(new Set(semua).size).toBe(31);
  expect(semua.sort()).toEqual(ids.sort());
  await rpc('admin', 'umkm_atur_telemetri', 'false,$1,false', ['v1']);
  expect((await sql('SELECT skor::integer FROM umkm_skor WHERE profil_id=$1', [items[0].id]))[0])
    .toEqual({ skor: 1 });
  expect((await sql('SELECT count(DISTINCT snapshot)::integer n FROM umkm_skor'))[0]).toEqual({ n: 1 });
  await expect(cari(page.next_cursor as string)).rejects.toThrow('SNAPSHOT_BERUBAH');
  const detail = await rpc('anon', 'umkm_profil_publik', '$1::uuid', [items[0].id]);
  expect(detail).toMatchObject({ suka: 1, dilihat: null, telemetri_opsional_aktif: false, baru: false });
  const serupa = await rpc('anon', 'umkm_serupa', '$1::uuid', [items[0].id]);
  expect((serupa.items as { id: string }[])).toHaveLength(10);
  expect((serupa.items as { id: string }[]).map(x => x.id)).not.toContain(items[0].id);
});

it('laporan berisi statistik per profil, tanpa PII, CSV mendapat semua profil dan FO ditolak', async () => {
  const laporan = await rpc('admin', 'umkm_laporan_statistik');
  expect(laporan).toMatchObject({ telemetri_opsional_aktif: false, dilihat: null, tanpa_hasil: null });
  expect(laporan.profil_statistik).toHaveLength(20);
  expect(await rpc('pemeriksa', 'umkm_laporan_statistik')).toEqual(laporan);
  const lanjut = await rpc('admin', 'umkm_laporan_statistik', '$1', [laporan.next_cursor]);
  const semua = [...laporan.profil_statistik as { id: string }[], ...lanjut.profil_statistik as { id: string }[]];
  expect(semua).toHaveLength(32);
  expect(new Set(semua.map(p => p.id)).size).toBe(32);
  const ekspor = await rpc('admin', 'umkm_ekspor_statistik');
  expect(ekspor.profil_statistik).toHaveLength(32);
  expect(JSON.stringify(ekspor)).not.toContain('081234567890');
  for (const who of ['anon', 'biasa', 'fo'] as const) {
    await expect(rpc(who, 'umkm_laporan_statistik')).rejects.toThrow();
  }
});

it('retensi menghapus konten kadaluwarsa, menjaga total, merangkum sekali dan mempertahankan jejak FO', async () => {
  const pesan = randomUUID(), laporan = randomUUID(), operasi = randomUUID();
  await sql(`INSERT INTO umkm_pesan_kontak(id,nama,perusahaan,nomor,pesan,aktor_uid,aktivitas_pada)
    VALUES ($1,'Nama rahasia','Usaha rahasia','081234567890','Isi rahasia',$2,now()-interval '181 days')`,
  [pesan, akun.biasa]);
  await sql(`INSERT INTO umkm_laporan(id,profil_id,alasan,aktor_uid,aktivitas_pada)
    VALUES ($1,$2,'data_salah',$3,now()-interval '181 days')`, [laporan, profil, akun.biasa]);
  await sql(`INSERT INTO umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_baru)
    VALUES($1,'pesan','selesai',$2,'admin','ditangani')`, [pesan, staf]);
  await sql(`INSERT INTO umkm_private.operasi_publik(aktor_uid,operasi_id,aksi,payload_hash,hasil,dibuat_pada)
    VALUES($1,$2,'umkm_pesan','hash','{}',now()-interval '181 days')`, [akun.biasa, operasi]);
  await sql(`INSERT INTO umkm_stat_tanpa_hasil(hari,kategori,kabupaten_kota,jumlah)
    VALUES ((now() AT TIME ZONE 'Asia/Jakarta')::date-100,'Pangan','Lampung',17)`);
  const sebelum = (await sql('SELECT suka,dilihat FROM umkm_stat_total WHERE profil_id=$1', [profil]))[0];
  await sql('SELECT umkm_private.bersihkan_retensi()');
  expect(await sql('SELECT id FROM umkm_pesan_kontak WHERE id=$1', [pesan])).toEqual([]);
  expect(await sql('SELECT id FROM umkm_laporan WHERE id=$1', [laporan])).toEqual([]);
  expect(await sql('SELECT operasi_id FROM umkm_private.operasi_publik WHERE operasi_id=$1', [operasi]))
    .toEqual([]);
  expect((await sql('SELECT suka,dilihat FROM umkm_stat_total WHERE profil_id=$1', [profil]))[0]).toEqual(sebelum);
  expect((await sql('SELECT sum(tanpa_hasil)::integer n FROM umkm_stat_bulanan'))[0]).toEqual({ n: 17 });
  await sql('SELECT umkm_private.bersihkan_retensi()');
  expect((await sql('SELECT sum(tanpa_hasil)::integer n FROM umkm_stat_bulanan'))[0]).toEqual({ n: 17 });
  const jejak = await rpc('fo', 'umkm_jejak_pengawasan');
  expect((jejak.items as { id: string; aksi: string }[]).some(h => h.aksi === 'selesai')).toBe(true);
  const key = `umkm-draf/${randomUUID()}.jpg`;
  const r = (await sql('SELECT revisi_disetujui_id id FROM umkm_profil WHERE id=$1', [profil]))[0].id;
  await sql("INSERT INTO umkm_foto(revisi_id,asal,r2_key) VALUES($1,'unggahan',$2)", [r, key]);
  expect(await rpc('service_role', 'umkm_draf_dilindungi', '$1::text[]', [[key, 'umkm-draf/yatim.jpg']]))
    .toEqual({ dilindungi: [key] });
  await expect(rpc('biasa', 'umkm_draf_dilindungi', '$1::text[]', [[key]])).rejects.toThrow('permission denied');
});

it('guard global diam tidak membuat baris tambahan, kegagalan agregat membatalkan dedup dan total', async () => {
  await rpc('admin', 'umkm_atur_telemetri', 'true,$1,true', ['v2']);
  const jumlah = (await sql('SELECT count(*)::integer n FROM umkm_stat_kejadian'))[0].n as number;
  await sql(`INSERT INTO umkm_stat_kejadian(hari,profil_id,jenis,identitas_hash)
    SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date,$1,'dilihat','uji-global-' || x
    FROM generate_series(1,$2::integer) x`, [profil, 1000 - jumlah]);
  expect(await rpc('service_role', 'umkm_catat_statistik', '$1,$2::uuid,$3',
    ['dilihat', profil, 'sesudah-ambang'])).toEqual({ dicatat: false });
  expect((await sql('SELECT count(*)::integer n FROM umkm_stat_kejadian'))[0]).toEqual({ n: 1000 });
  await sql("DELETE FROM umkm_stat_kejadian WHERE identitas_hash LIKE 'uji-global-%'");
  const sebelum = (await sql('SELECT dilihat,klik_formulir FROM umkm_stat_total WHERE profil_id=$1', [profil]))[0];
  await sql(`CREATE FUNCTION public.uji_gagal_agregat() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN RAISE EXCEPTION 'uji kegagalan agregat'; END $$`);
  await sql(`CREATE TRIGGER uji_gagal_agregat BEFORE INSERT OR UPDATE ON umkm_stat_harian
    FOR EACH ROW EXECUTE FUNCTION public.uji_gagal_agregat()`);
  await expect(rpc('service_role', 'umkm_catat_statistik', '$1,$2::uuid,$3',
    ['dilihat', profil, 'uji-rollback'])).rejects.toThrow('uji kegagalan agregat');
  await sql('DROP TRIGGER uji_gagal_agregat ON umkm_stat_harian');
  await sql('DROP FUNCTION public.uji_gagal_agregat()');
  expect((await sql('SELECT count(*)::integer n FROM umkm_stat_kejadian'))[0]).toEqual({ n: jumlah });
  expect((await sql('SELECT dilihat,klik_formulir FROM umkm_stat_total WHERE profil_id=$1', [profil]))[0])
    .toEqual(sebelum);
});

it('perlindungan draf memakai aktivitas tinjauan dan waktu keputusan, bukan umur unggahan saja', async () => {
  const keys: string[] = [];
  for (const [keputusan, usia] of [[null, 89], [null, 91], ['ditolak', 29], ['ditolak', 31]] as const) {
    const id = await buatProfil('Draf retensi', 'Draf');
    const key = `umkm-draf/${randomUUID()}.jpg`;
    keys.push(key);
    await sql(`UPDATE umkm_revisi SET keputusan=$2,dibuat_pada=now()-make_interval(days=>$3::integer)
      WHERE profil_id=$1`, [id, keputusan, usia]);
    await sql(`UPDATE umkm_profil SET status='diajukan',revisi_disetujui_id=NULL WHERE id=$1`, [id]);
    await sql(`INSERT INTO umkm_foto(revisi_id,asal,r2_key)
      SELECT revisi_terakhir_id,'unggahan',$2 FROM umkm_profil WHERE id=$1`, [id, key]);
  }
  expect(await rpc('service_role', 'umkm_draf_dilindungi', '$1::text[]', [keys]))
    .toEqual({ dilindungi: [keys[0], keys[2]].sort() });
});

it('baris sakelar hilang menolak kedua pencatat tanpa perubahan statistik', async () => {
  const [sakelar] = await sql('SELECT to_jsonb(s) data FROM umkm_private.statistik s WHERE tunggal');
  const ringkasan = () => sql(`SELECT
    (SELECT count(*)::integer FROM umkm_stat_kejadian) kejadian,
    (SELECT count(*)::integer FROM umkm_stat_harian) harian,
    (SELECT coalesce(sum(jumlah),0)::integer FROM umkm_stat_tanpa_hasil) tanpa_hasil,
    (SELECT coalesce(sum(dilihat+klik_formulir),0)::integer FROM umkm_stat_total) total`);
  const sebelum = await ringkasan();
  await sql('DELETE FROM umkm_private.statistik WHERE tunggal');
  try {
    expect(await rpc('service_role', 'umkm_catat_statistik', '$1,$2::uuid,$3',
      ['dilihat', profil, 'sakelar-hilang'])).toEqual({ dicatat: false });
    expect(await rpc('service_role', 'umkm_catat_tanpa_hasil', '$1,$2',
      ['Pangan', 'Lampung'])).toEqual({ dicatat: false });
    expect(await ringkasan()).toEqual(sebelum);
  } finally {
    await sql(`INSERT INTO umkm_private.statistik
      SELECT * FROM jsonb_populate_record(NULL::umkm_private.statistik,$1::jsonb)`, [JSON.stringify(sakelar.data)]);
  }
});

it('draf revisi lama lepas perlindungan, key bersama dan foto tersembunyi revisi tayang tetap dilindungi', async () => {
  const id = await buatProfil('Foto berganti', 'Foto');
  const [lama] = await sql('SELECT revisi_disetujui_id id FROM umkm_profil WHERE id=$1', [id]);
  const terbaru = randomUUID();
  const keys = ['lama', 'bersama', 'tersembunyi'].map(k => `umkm-draf/${id}-${k}.jpg`);
  await sql(`INSERT INTO umkm_foto(revisi_id,asal,r2_key)
    VALUES ($1,'unggahan',$2),($1,'unggahan',$3)`, [lama.id, keys[0], keys[1]]);
  await sql(`INSERT INTO umkm_revisi(id,profil_id,versi,nama,deskripsi,jenis,kategori,kabupaten_kota,
    keputusan,dibuat_oleh) VALUES($1,$2,2,'Foto baru','Olahan','Produk','Foto','Lampung','terbit',$3)`,
  [terbaru, id, staf]);
  await sql(`INSERT INTO umkm_foto(revisi_id,asal,r2_key,tersembunyi)
    VALUES ($1,'unggahan',$2,false),($1,'unggahan',$3,true)`, [terbaru, keys[1], keys[2]]);
  await sql('UPDATE umkm_profil SET revisi_disetujui_id=$2,revisi_terakhir_id=$2 WHERE id=$1', [id, terbaru]);
  expect(await rpc('service_role', 'umkm_draf_dilindungi', '$1::text[]', [keys]))
    .toEqual({ dilindungi: [keys[1], keys[2]].sort() });
});
