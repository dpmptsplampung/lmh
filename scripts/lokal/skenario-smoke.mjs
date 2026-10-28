// Skenario asap harness PGlite: membuktikan stub + sebagai() + cek() bekerja sebelum dipakai migrasi baru.
// Jalankan: node scripts/lokal/skenario-smoke.mjs  (butuh `npm i --no-save @electric-sql/pglite`).
// Kode keluar 0 bila semua cek lolos, 1 bila ada yang gagal.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bukaDb, sebagai, terapkanBerkas, cek } from './pglite-harness.mjs';

const U_ADMIN = '00000000-0000-4000-8000-0000000000a1';
const U_FO = '00000000-0000-4000-8000-0000000000a2';
const U_PETUGAS_L1 = '00000000-0000-4000-8000-0000000000a3';
const U_PETUGAS_L2 = '00000000-0000-4000-8000-0000000000a4';
const U_NONAKTIF = '00000000-0000-4000-8000-0000000000a5';
const U_PENGUNJUNG = '00000000-0000-4000-8000-0000000000a6';
const L1 = '00000000-0000-4000-8000-0000000000b1';
const L2 = '00000000-0000-4000-8000-0000000000b2';
const K1 = '00000000-0000-4000-8000-0000000000c1';
const K2 = '00000000-0000-4000-8000-0000000000c2';
const K3 = '00000000-0000-4000-8000-0000000000c3';

const db = await bukaDb();

/** Seed sebagai postgres; gagal seed = skenario tidak bermakna, jadi langsung dilempar. */
async function seed(sql, params) {
  const r = await sebagai(db, 'postgres', null, sql, params);
  if (!r.ok) throw new Error(`seed gagal: ${r.pesan}\n${sql}`);
  return r.rows;
}

await seed(`INSERT INTO public.layanan (id, nama) VALUES ('${L1}', 'Layanan Satu'), ('${L2}', 'Layanan Dua')`);
await seed(`INSERT INTO public.petugas (auth_user_id, role, aktif, layanan_id) VALUES
  ('${U_ADMIN}', 'admin', true, NULL),
  ('${U_FO}', 'front_office', true, NULL),
  ('${U_PETUGAS_L1}', 'petugas', true, '${L1}'),
  ('${U_PETUGAS_L2}', 'petugas', true, '${L2}'),
  ('${U_NONAKTIF}', 'admin', false, NULL)`);
await seed(`INSERT INTO public.kunjungan (id, nama, asal, tanggal, status) VALUES
  ('${K1}', 'Tamu Satu', 'walk_in', current_date, 'menunggu'),
  ('${K2}', 'Tamu Dua', 'walk_in', current_date, 'menunggu')`);
await seed(`INSERT INTO public.tiket_antrean (kunjungan_id, layanan_id, status, waktu_selesai) VALUES
  ('${K1}', '${L1}', 'selesai', now())`);
await seed(`INSERT INTO public.skm_respons (layanan_id, kunjungan_id, u1_persyaratan, saran)
  VALUES ('${L1}', '${K1}', 4, 'rahasia')`);

// --- 1. sebagai(): peralihan role dan auth.uid() -------------------------------------------------
console.log('sebagai(): role dan auth.uid()');
for (const role of ['anon', 'authenticated', 'service_role', 'postgres']) {
  const r = await sebagai(db, role, null, 'SELECT current_user AS u');
  cek(`current_user = ${role}`, r.ok && r.rows[0].u === role, JSON.stringify(r));
}
const sesudah = await db.query('SELECT current_user AS u');
cek('role kembali ke postgres setelah sebagai()', sesudah.rows[0].u === 'postgres');

const uid1 = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT auth.uid()::text AS uid');
cek('auth.uid() mengikuti parameter uid', uid1.ok && uid1.rows[0].uid === U_ADMIN, JSON.stringify(uid1));
const uid2 = await sebagai(db, 'authenticated', U_PENGUNJUNG, 'SELECT auth.uid()::text AS uid');
cek('auth.uid() berganti saat uid berganti', uid2.ok && uid2.rows[0].uid === U_PENGUNJUNG, JSON.stringify(uid2));
const uid3 = await sebagai(db, 'anon', null, 'SELECT auth.uid() AS uid');
cek('auth.uid() NULL bila uid null', uid3.ok && uid3.rows[0].uid === null, JSON.stringify(uid3));
const uid4 = await sebagai(db, 'postgres', null, 'SELECT auth.uid() AS uid');
cek('uid tidak bocor ke panggilan berikutnya', uid4.ok && uid4.rows[0].uid === null, JSON.stringify(uid4));

const param = await sebagai(db, 'service_role', null, 'SELECT $1::int + 1 AS n', [41]);
cek('sebagai() dengan params', param.ok && param.rows[0].n === 42, JSON.stringify(param));
const banyak = await sebagai(db, 'postgres', null, 'SELECT 1 AS a; SELECT 2 AS b');
cek('sebagai() tanpa params menerima banyak pernyataan (hasil terakhir)', banyak.ok && banyak.rows[0].b === 2, JSON.stringify(banyak));
const galat = await sebagai(db, 'postgres', null, 'SELECT * FROM public.tabel_tidak_ada');
cek('galat SQL dikembalikan sebagai { ok: false, pesan }', galat.ok === false && /tabel_tidak_ada/.test(galat.pesan), JSON.stringify(galat));
const sesudahGalat = await sebagai(db, 'anon', null, 'SELECT current_user AS u');
cek('sebagai() pulih setelah galat', sesudahGalat.ok && sesudahGalat.rows[0].u === 'anon', JSON.stringify(sesudahGalat));

// --- 2. RLS skm_respons -------------------------------------------------------------------------
console.log('RLS skm_respons');
const HITUNG = 'SELECT count(*)::int AS n FROM public.skm_respons';
const sr = await sebagai(db, 'service_role', null, HITUNG);
cek('service_role membaca skm_respons (BYPASSRLS)', sr.ok && sr.rows[0].n === 1, JSON.stringify(sr));
const an = await sebagai(db, 'anon', null, HITUNG);
cek('anon SELECT skm_respons ditolak (galat atau 0 baris)', an.ok ? an.rows[0].n === 0 : true, JSON.stringify(an));
const anIns = await sebagai(db, 'anon', null, `INSERT INTO public.skm_respons (layanan_id) VALUES ('${L1}')`);
cek('anon INSERT skm_respons ditolak', anIns.ok === false, JSON.stringify(anIns));
const au = await sebagai(db, 'authenticated', U_PENGUNJUNG, HITUNG);
cek('authenticated non-staf melihat 0 baris', au.ok && au.rows[0].n === 0, JSON.stringify(au));
const ad = await sebagai(db, 'authenticated', U_ADMIN, HITUNG);
cek('admin aktif melihat baris (peran_saya -> policy)', ad.ok && ad.rows[0].n === 1, JSON.stringify(ad));
const fo = await sebagai(db, 'authenticated', U_FO, HITUNG);
cek('front_office melihat baris', fo.ok && fo.rows[0].n === 1, JSON.stringify(fo));
const pt = await sebagai(db, 'authenticated', U_PETUGAS_L1, HITUNG);
cek('petugas layanan tidak membaca tabel rinci', pt.ok && pt.rows[0].n === 0, JSON.stringify(pt));
const nonaktif = await sebagai(db, 'authenticated', U_NONAKTIF, HITUNG);
cek('admin nonaktif melihat 0 baris', nonaktif.ok && nonaktif.rows[0].n === 0, JSON.stringify(nonaktif));

// --- 3. Fungsi helper dan hak EXECUTE -----------------------------------------------------------
console.log('fungsi helper dan hak EXECUTE');
const peranAnon = await sebagai(db, 'anon', null, 'SELECT public.peran_saya() AS p');
cek('anon tidak boleh EXECUTE peran_saya (42501)', peranAnon.ok === false && peranAnon.kode === '42501', JSON.stringify(peranAnon));
const peranAdmin = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT public.peran_saya() AS p');
cek('peran_saya() = admin untuk admin aktif', peranAdmin.ok && peranAdmin.rows[0].p === 'admin', JSON.stringify(peranAdmin));
const peranTamu = await sebagai(db, 'authenticated', U_PENGUNJUNG, 'SELECT public.peran_saya() AS p');
cek('peran_saya() NULL untuk non-staf', peranTamu.ok && peranTamu.rows[0].p === null, JSON.stringify(peranTamu));
const peranNon = await sebagai(db, 'authenticated', U_NONAKTIF, 'SELECT public.peran_saya() AS p');
cek('peran_saya() NULL untuk staf nonaktif', peranNon.ok && peranNon.rows[0].p === null, JSON.stringify(peranNon));

const BOLEH = 'SELECT public.boleh_kunjungan($1) AS b';
for (const [nama, uid, harap] of [
  ['admin', U_ADMIN, true],
  ['front_office', U_FO, true],
  ['petugas layanan yang punya tiket', U_PETUGAS_L1, true],
  ['petugas layanan lain', U_PETUGAS_L2, false],
  ['non-staf', U_PENGUNJUNG, false],
]) {
  const r = await sebagai(db, 'authenticated', uid, BOLEH, [K1]);
  cek(`boleh_kunjungan(K1) untuk ${nama} = ${harap}`, r.ok && r.rows[0].b === harap, JSON.stringify(r));
}

const layananSkm = await sebagai(db, 'service_role', null, 'SELECT public.kunjungan_layanan_skm($1)::text AS l', [K1]);
cek('kunjungan_layanan_skm: layanan tiket selesai (service_role)', layananSkm.ok && layananSkm.rows[0].l === L1, JSON.stringify(layananSkm));
const layananKosong = await sebagai(db, 'service_role', null, 'SELECT public.kunjungan_layanan_skm($1)::text AS l', [K2]);
cek('kunjungan_layanan_skm NULL tanpa tiket selesai', layananKosong.ok && layananKosong.rows[0].l === null, JSON.stringify(layananKosong));
const layananAuth = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT public.kunjungan_layanan_skm($1)', [K1]);
cek('kunjungan_layanan_skm hanya service_role (authenticated ditolak)', layananAuth.ok === false && layananAuth.kode === '42501', JSON.stringify(layananAuth));

// --- 4. Trigger selesai_at dan indeks unik parsial ----------------------------------------------
console.log('trigger selesai_at dan indeks unik parsial');
const awal = await seed('SELECT selesai_at FROM public.kunjungan WHERE id = $1', [K2]);
cek('selesai_at NULL sebelum selesai', awal[0].selesai_at === null);
await seed(`UPDATE public.kunjungan SET status = 'selesai' WHERE id = $1`, [K2]);
const akhir = await seed('SELECT selesai_at FROM public.kunjungan WHERE id = $1', [K2]);
cek('selesai_at terisi saat status menjadi selesai', akhir[0].selesai_at !== null);

// Pelestarian selesai_at: kunjungan dibuat langsung 'selesai' dengan selesai_at 2 hari lalu (INSERT memakai
// COALESCE, jadi nilai kiriman dipakai). UPDATE yang tidak mengubah status harus membiarkannya. Dengan jarak
// 2 hari, trigger yang salah men-stempel ulang now() pada tiap UPDATE pasti terdeteksi; membandingkan
// String(Date) tidak cukup karena resolusinya satu detik, jadi dibandingkan lewat getTime() (milidetik).
await seed(
  `INSERT INTO public.kunjungan (id, nama, asal, tanggal, status, selesai_at)
   VALUES ('${K3}', 'Tamu Tiga', 'walk_in', current_date, 'selesai', now() - interval '2 days')`,
);
const mundur = await seed('SELECT selesai_at FROM public.kunjungan WHERE id = $1', [K3]);
cek(
  'INSERT status selesai memakai selesai_at kiriman (prasyarat cek berikut)',
  mundur[0].selesai_at instanceof Date && Date.now() - mundur[0].selesai_at.getTime() > 24 * 3600 * 1000,
  String(mundur[0].selesai_at),
);
await seed(`UPDATE public.kunjungan SET nama = 'Tamu Tiga (ubah)' WHERE id = $1`, [K3]);
const tetap = await seed('SELECT selesai_at FROM public.kunjungan WHERE id = $1', [K3]);
cek(
  'selesai_at dipertahankan bila status tidak berubah',
  tetap[0].selesai_at instanceof Date && tetap[0].selesai_at.getTime() === mundur[0].selesai_at.getTime(),
  `sebelum=${mundur[0].selesai_at?.toISOString?.()} sesudah=${tetap[0].selesai_at?.toISOString?.()}`,
);

const dup = await sebagai(db, 'postgres', null, `INSERT INTO public.skm_respons (layanan_id, kunjungan_id) VALUES ('${L1}', '${K1}')`);
cek('indeks unik parsial: kunjungan_id ganda ditolak (23505)', dup.ok === false && dup.kode === '23505', JSON.stringify(dup));
const duaNull = await sebagai(db, 'postgres', null, `INSERT INTO public.skm_respons (layanan_id) VALUES ('${L1}'), ('${L1}')`);
cek('kunjungan_id NULL boleh berulang', duaNull.ok, JSON.stringify(duaNull));

// --- 5. Hak default ala Supabase, pgcrypto, terapkanBerkas -------------------------------------
console.log('hak default, pgcrypto, terapkanBerkas');
const folder = mkdtempSync(join(tmpdir(), 'pglite-smoke-'));
try {
  const berkas = join(folder, 'tabel-baru.sql');
  writeFileSync(berkas, 'CREATE TABLE public.tabel_lupa_revoke (a int);\nINSERT INTO public.tabel_lupa_revoke VALUES (7);\n');
  await terapkanBerkas(db, berkas);
  const baru = await sebagai(db, 'anon', null, 'SELECT a FROM public.tabel_lupa_revoke');
  cek('terapkanBerkas membuat tabel; hak default memberi anon akses (meniru Supabase)', baru.ok && baru.rows[0]?.a === 7, JSON.stringify(baru));

  const buruk = join(folder, 'rusak.sql');
  writeFileSync(buruk, 'SELECT * FROM tabel_yang_tidak_ada_sama_sekali;');
  let pesanGalat = '';
  try {
    await terapkanBerkas(db, buruk);
  } catch (e) {
    pesanGalat = String(e.message);
  }
  cek('terapkanBerkas melempar galat berisi nama berkas', pesanGalat.includes('rusak.sql') && pesanGalat.includes('tabel_yang_tidak_ada_sama_sekali'), pesanGalat);
} finally {
  rmSync(folder, { recursive: true, force: true });
}

const acak = await sebagai(db, 'service_role', null, `SELECT encode(extensions.gen_random_bytes(32), 'hex') AS t`);
cek('extensions.gen_random_bytes(32) menghasilkan 64 heksadesimal', acak.ok && /^[0-9a-f]{64}$/.test(acak.rows[0].t), JSON.stringify(acak));

await db.close();
