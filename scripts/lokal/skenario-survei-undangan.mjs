// Skenario PGlite untuk migrasi 202610270001_survei_undangan.sql (survei terpadu Fase A, Task 2).
// Membuktikan PERILAKU di atas stub skema (bukan pengganti dry-run/test:rls pemilik di DB nyata):
//   (a) kunjungan -> selesai membuat tepat satu undangan (token 64 hex, kedaluwarsa = selesai_at + 32 jam);
//   (b) ensure_undangan idempoten, tidak menggeser batas 32 jam (Review Focus 1);
//   (c) unit fo/layanan dari kunjungan_layanan_skm; (d) kunjungan belum selesai tanpa undangan;
//   (e) anon/authenticated tidak bisa menyentuh tabel; (f) ambil_qr_survei; (g) v_survei_status per boleh_kunjungan.
// Jalankan: node scripts/lokal/skenario-survei-undangan.mjs  (butuh `npm i --no-save @electric-sql/pglite`).
// Kode keluar 0 bila semua cek lolos, 1 bila ada yang gagal atau migrasi tidak bisa diterapkan.

import { fileURLToPath } from 'node:url';
import { bukaDb, sebagai, terapkanBerkas, cek } from './pglite-harness.mjs';

const MIGRASI = fileURLToPath(new URL('../../supabase/migrations/202610270001_survei_undangan.sql', import.meta.url));

const U_ADMIN = '00000000-0000-4000-8000-0000000000a1';
const U_FO = '00000000-0000-4000-8000-0000000000a2';
const U_PETUGAS_L1 = '00000000-0000-4000-8000-0000000000a3';
const U_PETUGAS_L2 = '00000000-0000-4000-8000-0000000000a4';
const U_PENGUNJUNG = '00000000-0000-4000-8000-0000000000a6';
const L1 = '00000000-0000-4000-8000-0000000000b1';
const L2 = '00000000-0000-4000-8000-0000000000b2';
const L_HAPUS = '00000000-0000-4000-8000-0000000000b3'; // untuk uji ON DELETE SET NULL
const K_LAYANAN = '00000000-0000-4000-8000-0000000000c1'; // tiket selesai di L1
const K_L2 = '00000000-0000-4000-8000-0000000000c2'; // tiket selesai di L2
const K_FO = '00000000-0000-4000-8000-0000000000c3'; // tanpa tiket sama sekali
const K_TIKET_BATAL = '00000000-0000-4000-8000-0000000000c4'; // hanya tiket batal di L2 -> tetap unit fo
const K_MENUNGGU = '00000000-0000-4000-8000-0000000000c5'; // tidak pernah selesai
const K_BATAL = '00000000-0000-4000-8000-0000000000c6'; // status batal
const K_NOSHOW = '00000000-0000-4000-8000-0000000000c7'; // status no_show
const K_GESER = '00000000-0000-4000-8000-0000000000c8'; // selesai 10 jam lalu, dipakai menguji "tidak menggeser"
const K_TANPA_SELESAI_AT = '00000000-0000-4000-8000-0000000000c9';
const K_HAPUS = '00000000-0000-4000-8000-0000000000ca'; // untuk uji CASCADE
const K_LAYANAN_HAPUS = '00000000-0000-4000-8000-0000000000cb';
const K_TIDAK_ADA = '00000000-0000-4000-8000-0000000000ff';

const HEX64 = /^[0-9a-f]{64}$/;

const db = await bukaDb();

/** Jalankan sebagai postgres dan lempar bila gagal (seed/pembacaan bukti). */
async function pg(sql, params) {
  const r = await sebagai(db, 'postgres', null, sql, params);
  if (!r.ok) throw new Error(`pernyataan gagal: ${r.pesan}\n${sql}`);
  return r.rows;
}

/** Baris undangan sebuah kunjungan (atau undefined). */
async function undangan(kunjunganId) {
  return (await pg('SELECT * FROM public.survei_undangan WHERE kunjungan_id = $1', [kunjunganId]))[0];
}

const jumlah = async (kunjunganId) =>
  (await pg('SELECT count(*)::int AS n FROM public.survei_undangan WHERE kunjungan_id = $1', [kunjunganId]))[0].n;

/** Sebagai pengguna terautentikasi: panggil ambil_qr_survei dan kembalikan objek jsonb atau galatnya. */
async function qr(uid, kunjunganId) {
  const r = await sebagai(db, 'authenticated', uid, 'SELECT public.ambil_qr_survei($1) AS j', [kunjunganId]);
  return r.ok ? r.rows[0].j : r;
}

/** Himpunan kunjungan_id (terurut) yang terlihat di v_survei_status oleh pengguna. */
async function terlihat(uid) {
  const r = await sebagai(db, 'authenticated', uid, 'SELECT kunjungan_id FROM public.v_survei_status ORDER BY kunjungan_id');
  return r.ok ? r.rows.map((x) => x.kunjungan_id) : r;
}

const urut = (...id) => [...id].sort();

// --- Terapkan migrasi (GAGAL bila berkas belum ada: fase RED) -----------------------------------
console.log('menerapkan migrasi');
await terapkanBerkas(db, MIGRASI);

// --- Seed (sebagai postgres) ---------------------------------------------------------------------
await pg(`INSERT INTO public.layanan (id, nama) VALUES ('${L1}', 'Layanan Satu'), ('${L2}', 'Layanan Dua'), ('${L_HAPUS}', 'Layanan Dihapus')`);
await pg(`INSERT INTO public.petugas (auth_user_id, role, aktif, layanan_id) VALUES
  ('${U_ADMIN}', 'admin', true, NULL),
  ('${U_FO}', 'front_office', true, NULL),
  ('${U_PETUGAS_L1}', 'petugas', true, '${L1}'),
  ('${U_PETUGAS_L2}', 'petugas', true, '${L2}')`);
await pg(`INSERT INTO public.kunjungan (id, nama, asal, tanggal, status) VALUES
  ('${K_LAYANAN}', 'Tamu Layanan', 'walk_in', current_date, 'dilayani'),
  ('${K_L2}', 'Tamu Dua', 'walk_in', current_date, 'dilayani'),
  ('${K_FO}', 'Tamu FO', 'walk_in', current_date, 'menunggu'),
  ('${K_TIKET_BATAL}', 'Tamu Tiket Batal', 'walk_in', current_date, 'menunggu'),
  ('${K_MENUNGGU}', 'Tamu Menunggu', 'walk_in', current_date, 'menunggu'),
  ('${K_BATAL}', 'Tamu Batal', 'walk_in', current_date, 'menunggu'),
  ('${K_NOSHOW}', 'Tamu No Show', 'walk_in', current_date, 'menunggu'),
  ('${K_LAYANAN_HAPUS}', 'Tamu Layanan Dihapus', 'walk_in', current_date, 'dilayani')`);
await pg(`INSERT INTO public.tiket_antrean (kunjungan_id, layanan_id, status, waktu_selesai) VALUES
  ('${K_LAYANAN}', '${L1}', 'selesai', now()),
  ('${K_L2}', '${L2}', 'selesai', now()),
  ('${K_TIKET_BATAL}', '${L2}', 'batal', NULL),
  ('${K_LAYANAN_HAPUS}', '${L_HAPUS}', 'selesai', now())`);

// --- (d) Sebelum selesai: tidak ada undangan -------------------------------------------------------
console.log('(d) kunjungan yang belum selesai tidak punya undangan');
await pg(`UPDATE public.kunjungan SET status = 'dilayani' WHERE id = '${K_MENUNGGU}'`);
await pg(`UPDATE public.kunjungan SET status = 'batal' WHERE id = '${K_BATAL}'`);
await pg(`UPDATE public.kunjungan SET status = 'no_show' WHERE id = '${K_NOSHOW}'`);
for (const [nama, id] of [['menunggu->dilayani', K_MENUNGGU], ['batal', K_BATAL], ['no_show', K_NOSHOW], ['masih dilayani (belum diselesaikan)', K_LAYANAN]]) {
  cek(`tanpa undangan: ${nama}`, (await jumlah(id)) === 0);
}
const ensBelum = await sebagai(db, 'service_role', null, 'SELECT public.ensure_undangan($1) AS id', [K_MENUNGGU]);
cek('ensure_undangan kunjungan belum selesai -> NULL dan tidak membuat baris', ensBelum.ok && ensBelum.rows[0].id === null && (await jumlah(K_MENUNGGU)) === 0, JSON.stringify(ensBelum));
const ensHilang = await sebagai(db, 'service_role', null, 'SELECT public.ensure_undangan($1) AS id', [K_TIDAK_ADA]);
cek('ensure_undangan kunjungan tidak ada -> NULL', ensHilang.ok && ensHilang.rows[0].id === null, JSON.stringify(ensHilang));

// --- (a)+(c) Trigger saat status menjadi selesai --------------------------------------------------
console.log('(a)(c) trigger: kunjungan -> selesai membuat tepat satu undangan');
await pg(`UPDATE public.kunjungan SET status = 'selesai' WHERE id IN ('${K_LAYANAN}', '${K_L2}', '${K_FO}', '${K_TIKET_BATAL}', '${K_LAYANAN_HAPUS}')`);
for (const [nama, id] of [['layanan L1', K_LAYANAN], ['layanan L2', K_L2], ['tanpa tiket (FO)', K_FO], ['tiket batal', K_TIKET_BATAL]]) {
  cek(`tepat satu undangan: ${nama}`, (await jumlah(id)) === 1);
}
const ul = await undangan(K_LAYANAN);
const kl = (await pg('SELECT selesai_at FROM public.kunjungan WHERE id = $1', [K_LAYANAN]))[0];
cek('token 64 karakter heksadesimal huruf kecil', HEX64.test(ul.token), ul.token);
const batas = (await pg(
  `SELECT (u.kedaluwarsa_pada = k.selesai_at + interval '32 hours') AS tepat
     FROM public.survei_undangan AS u JOIN public.kunjungan AS k ON k.id = u.kunjungan_id WHERE k.id = $1`,
  [K_LAYANAN],
))[0].tepat;
cek('kedaluwarsa_pada = selesai_at + 32 jam (tepat)', kl.selesai_at !== null && batas === true);
cek('dibuat_pada terisi, belum diisi, saran/pengaduan belum dikirim', ul.dibuat_pada instanceof Date && ul.diisi_pada === null && ul.saran_dikirim === false && ul.pengaduan_dikirim === false);
cek('layanan tiket selesai -> unit layanan dan layanan_id terisi', ul.unit === 'layanan' && ul.layanan_id === L1, JSON.stringify(ul));
const uf = await undangan(K_FO);
cek('tanpa tiket selesai -> unit fo, layanan_id NULL', uf.unit === 'fo' && uf.layanan_id === null, JSON.stringify(uf));
const ub = await undangan(K_TIKET_BATAL);
cek('hanya tiket batal (bukan selesai) -> unit fo, layanan_id NULL', ub.unit === 'fo' && ub.layanan_id === null, JSON.stringify(ub));
const semuaToken = (await pg('SELECT token FROM public.survei_undangan')).map((x) => x.token);
cek('semua token unik dan berformat 64 hex', new Set(semuaToken).size === semuaToken.length && semuaToken.every((t) => HEX64.test(t)));

// --- (b) Idempotensi: trigger + panggilan ensure_undangan berulang -----------------------------------
console.log('(b) ensure_undangan idempoten, batas 32 jam tidak bergeser');
const sebelum = await undangan(K_LAYANAN);
const dua = await sebagai(db, 'service_role', null, 'SELECT public.ensure_undangan($1) AS a, public.ensure_undangan($1) AS b', [K_LAYANAN]);
cek('dua panggilan ensure_undangan mengembalikan id undangan yang sama (milik trigger)', dua.ok && dua.rows[0].a === sebelum.id && dua.rows[0].b === sebelum.id, JSON.stringify(dua));
const sesudah = await undangan(K_LAYANAN);
cek(
  'baris tidak berubah: token, kedaluwarsa_pada, dibuat_pada sama; masih satu baris',
  (await jumlah(K_LAYANAN)) === 1 &&
    sesudah.token === sebelum.token &&
    sesudah.kedaluwarsa_pada.getTime() === sebelum.kedaluwarsa_pada.getTime() &&
    sesudah.dibuat_pada.getTime() === sebelum.dibuat_pada.getTime(),
);
await pg(`UPDATE public.kunjungan SET status = 'selesai' WHERE id = '${K_LAYANAN}'`);
await pg(`UPDATE public.kunjungan SET nama = 'Tamu Layanan (ubah)', status = 'selesai' WHERE id = '${K_LAYANAN}'`);
const stlh = await undangan(K_LAYANAN);
cek('UPDATE status berulang (selesai -> selesai) tidak menambah baris maupun mengubah baris', (await jumlah(K_LAYANAN)) === 1 && stlh.id === sebelum.id && stlh.token === sebelum.token && stlh.kedaluwarsa_pada.getTime() === sebelum.kedaluwarsa_pada.getTime());

// Pembuktian kuat "tidak menggeser": kunjungan selesai 10 jam lalu (INSERT langsung selesai: trigger UPDATE tidak
// aktif), undangan dibuat manual, lalu status dibuka lagi dan diselesaikan ulang. Trigger selesai_at stub
// men-stempel ulang selesai_at = now() (perilaku produksi), tetapi kedaluwarsa_pada harus tetap pada nilai pertama.
await pg(`INSERT INTO public.kunjungan (id, nama, asal, tanggal, status, selesai_at)
          VALUES ('${K_GESER}', 'Tamu Geser', 'walk_in', current_date, 'selesai', now() - interval '10 hours')`);
cek('INSERT langsung berstatus selesai tidak membuat undangan (trigger hanya UPDATE; tanpa backfill)', (await jumlah(K_GESER)) === 0);
const ens1 = await sebagai(db, 'service_role', null, 'SELECT public.ensure_undangan($1) AS id', [K_GESER]);
const g1 = await undangan(K_GESER);
const selesai1 = (await pg('SELECT selesai_at FROM public.kunjungan WHERE id = $1', [K_GESER]))[0].selesai_at;
cek('ensure_undangan manual: id dikembalikan dan baris dibuat', ens1.ok && g1 !== undefined && ens1.rows[0].id === g1.id, JSON.stringify(ens1));
cek('kedaluwarsa_pada = selesai_at (10 jam lalu) + 32 jam', g1.kedaluwarsa_pada.getTime() === selesai1.getTime() + 32 * 3600 * 1000, `${g1.kedaluwarsa_pada.toISOString()} vs ${selesai1.toISOString()}`);
await pg(`UPDATE public.kunjungan SET status = 'dilayani' WHERE id = '${K_GESER}'`);
cek('kembali ke dilayani tidak menghapus undangan', (await jumlah(K_GESER)) === 1);
await pg(`UPDATE public.kunjungan SET status = 'selesai' WHERE id = '${K_GESER}'`); // trigger aktif lagi (status berubah)
const g2 = await undangan(K_GESER);
const selesai2 = (await pg('SELECT selesai_at FROM public.kunjungan WHERE id = $1', [K_GESER]))[0].selesai_at;
cek('prasyarat bukti: selesai_at benar-benar bergeser maju (> 9 jam)', selesai2.getTime() - selesai1.getTime() > 9 * 3600 * 1000);
cek(
  'selesai ulang: tidak ada baris kedua, id/token/kedaluwarsa_pada TIDAK bergeser',
  (await jumlah(K_GESER)) === 1 && g2.id === g1.id && g2.token === g1.token && g2.kedaluwarsa_pada.getTime() === g1.kedaluwarsa_pada.getTime(),
  `kedaluwarsa awal=${g1.kedaluwarsa_pada.toISOString()} akhir=${g2.kedaluwarsa_pada.toISOString()}`,
);

// selesai_at kosong (bukan keadaan produksi; pertahanan): jatuh ke now() + 32 jam.
await pg('ALTER TABLE public.kunjungan DISABLE TRIGGER trg_kunjungan_selesai_at');
await pg(`INSERT INTO public.kunjungan (id, nama, asal, tanggal, status, selesai_at)
          VALUES ('${K_TANPA_SELESAI_AT}', 'Tamu Tanpa Selesai At', 'walk_in', current_date, 'selesai', NULL)`);
await pg('ALTER TABLE public.kunjungan ENABLE TRIGGER trg_kunjungan_selesai_at');
await sebagai(db, 'service_role', null, 'SELECT public.ensure_undangan($1)', [K_TANPA_SELESAI_AT]);
const tsa = await undangan(K_TANPA_SELESAI_AT);
const selisihDetik = tsa ? Math.abs(tsa.kedaluwarsa_pada.getTime() - (Date.now() + 32 * 3600 * 1000)) / 1000 : Infinity;
cek('selesai_at NULL: kedaluwarsa_pada = now() + 32 jam (COALESCE)', selisihDetik < 120, `selisih ${selisihDetik} detik`);

// --- (e) Akses langsung ke tabel ditutup --------------------------------------------------------
console.log('(e) anon dan authenticated tidak bisa menyentuh survei_undangan');
const flag = (await pg(`SELECT c.relrowsecurity AS rls, (SELECT count(*)::int FROM pg_catalog.pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'survei_undangan') AS policy
                         FROM pg_catalog.pg_class c WHERE c.oid = 'public.survei_undangan'::regclass`))[0];
cek('RLS aktif dan tidak ada satu pun policy', flag.rls === true && flag.policy === 0, JSON.stringify(flag));
for (const [nama, role, uid] of [['anon', 'anon', null], ['authenticated non-staf', 'authenticated', U_PENGUNJUNG], ['authenticated admin', 'authenticated', U_ADMIN], ['authenticated front_office', 'authenticated', U_FO]]) {
  const sel = await sebagai(db, role, uid, 'SELECT token FROM public.survei_undangan');
  cek(`${nama}: SELECT langsung ditolak (42501)`, sel.ok === false && sel.kode === '42501', JSON.stringify(sel));
}
const tulis = await sebagai(db, 'authenticated', U_ADMIN, `INSERT INTO public.survei_undangan (kunjungan_id, token, unit, kedaluwarsa_pada) VALUES ('${K_MENUNGGU}', '${'a'.repeat(64)}', 'fo', now())`);
cek('authenticated: INSERT langsung ditolak (42501)', tulis.ok === false && tulis.kode === '42501', JSON.stringify(tulis));
const ubah = await sebagai(db, 'authenticated', U_ADMIN, 'UPDATE public.survei_undangan SET diisi_pada = now()');
cek('authenticated: UPDATE langsung ditolak (42501)', ubah.ok === false && ubah.kode === '42501', JSON.stringify(ubah));
const hapus = await sebagai(db, 'authenticated', U_ADMIN, 'DELETE FROM public.survei_undangan');
cek('authenticated: DELETE langsung ditolak (42501)', hapus.ok === false && hapus.kode === '42501', JSON.stringify(hapus));
const ensAuth = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT public.ensure_undangan($1)', [K_LAYANAN]);
cek('ensure_undangan: authenticated ditolak (42501), hanya service_role', ensAuth.ok === false && ensAuth.kode === '42501', JSON.stringify(ensAuth));
const ensAnon = await sebagai(db, 'anon', null, 'SELECT public.ensure_undangan($1)', [K_LAYANAN]);
cek('ensure_undangan: anon ditolak (42501)', ensAnon.ok === false && ensAnon.kode === '42501', JSON.stringify(ensAnon));
const trigFn = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT public.kunjungan_selesai_undangan()');
cek('fungsi trigger tidak bisa dipanggil klien (42501)', trigFn.ok === false && trigFn.kode === '42501', JSON.stringify(trigFn));

// --- Constraint tabel ----------------------------------------------------------------------------
console.log('constraint tabel');
const cDup = await sebagai(db, 'postgres', null, `INSERT INTO public.survei_undangan (kunjungan_id, token, unit, kedaluwarsa_pada) VALUES ('${K_LAYANAN}', '${'b'.repeat(64)}', 'layanan', now())`);
cek('satu undangan per kunjungan (kunjungan_id unik, 23505)', cDup.ok === false && cDup.kode === '23505', JSON.stringify(cDup));
const cTok = await sebagai(db, 'postgres', null, `INSERT INTO public.survei_undangan (kunjungan_id, token, unit, kedaluwarsa_pada) VALUES ('${K_MENUNGGU}', '${ul.token}', 'fo', now())`);
cek('token unik (23505)', cTok.ok === false && cTok.kode === '23505', JSON.stringify(cTok));
const cUnit = await sebagai(db, 'postgres', null, `INSERT INTO public.survei_undangan (kunjungan_id, token, unit, kedaluwarsa_pada) VALUES ('${K_MENUNGGU}', '${'c'.repeat(64)}', 'lainnya', now())`);
cek('unit hanya layanan/fo (CHECK, 23514)', cUnit.ok === false && cUnit.kode === '23514', JSON.stringify(cUnit));
const cFmt = await sebagai(db, 'postgres', null, `INSERT INTO public.survei_undangan (kunjungan_id, token, unit, kedaluwarsa_pada) VALUES ('${K_MENUNGGU}', 'pendek', 'fo', now())`);
cek('token wajib 64 hex (CHECK, 23514)', cFmt.ok === false && cFmt.kode === '23514', JSON.stringify(cFmt));
const cFmt2 = await sebagai(db, 'postgres', null, `INSERT INTO public.survei_undangan (kunjungan_id, token, unit, kedaluwarsa_pada) VALUES ('${K_MENUNGGU}', '${'A'.repeat(64)}', 'fo', now())`);
cek('token huruf besar ditolak (hanya huruf kecil, 23514)', cFmt2.ok === false && cFmt2.kode === '23514', JSON.stringify(cFmt2));

// Siklus hidup FK: hapus kunjungan -> undangan ikut terhapus; hapus layanan -> layanan_id NULL, undangan tetap.
await pg(`INSERT INTO public.kunjungan (id, nama, asal, tanggal, status) VALUES ('${K_HAPUS}', 'Tamu Hapus', 'walk_in', current_date, 'menunggu')`);
await pg(`UPDATE public.kunjungan SET status = 'selesai' WHERE id = '${K_HAPUS}'`);
cek('prasyarat CASCADE: undangan K_HAPUS ada', (await jumlah(K_HAPUS)) === 1);
await pg(`DELETE FROM public.kunjungan WHERE id = '${K_HAPUS}'`);
cek('hapus kunjungan menghapus undangannya (ON DELETE CASCADE)', (await jumlah(K_HAPUS)) === 0);
const uh = await undangan(K_LAYANAN_HAPUS);
cek('prasyarat SET NULL: undangan K_LAYANAN_HAPUS unit layanan dengan layanan terhapus', uh.unit === 'layanan' && uh.layanan_id === L_HAPUS);
await pg(`DELETE FROM public.tiket_antrean WHERE layanan_id = '${L_HAPUS}'`);
await pg(`DELETE FROM public.layanan WHERE id = '${L_HAPUS}'`);
const uh2 = await undangan(K_LAYANAN_HAPUS);
cek('hapus layanan: undangan tetap ada, layanan_id jadi NULL (ON DELETE SET NULL)', uh2 !== undefined && uh2.layanan_id === null && uh2.unit === 'layanan');

// --- (f) ambil_qr_survei --------------------------------------------------------------------------
console.log('(f) ambil_qr_survei');
const tokenL1 = (await undangan(K_LAYANAN)).token;
const jFo = await qr(U_FO, K_LAYANAN);
cek('FO, belum_diisi: token + status + unit + layanan_nama + kedaluwarsa_pada',
  jFo.status === 'belum_diisi' && jFo.token === tokenL1 && jFo.unit === 'layanan' && jFo.layanan_nama === 'Layanan Satu' && typeof jFo.kedaluwarsa_pada === 'string',
  JSON.stringify(jFo));
const jKunciFo = Object.keys(jFo).sort().join(',');
cek('bentuk jsonb: tepat lima kunci', jKunciFo === 'kedaluwarsa_pada,layanan_nama,status,token,unit', jKunciFo);
const jKedaluwarsaSama = new Date(jFo.kedaluwarsa_pada).getTime() === (await undangan(K_LAYANAN)).kedaluwarsa_pada.getTime();
cek('kedaluwarsa_pada di jsonb sama dengan di tabel', jKedaluwarsaSama);
const jAdmin = await qr(U_ADMIN, K_LAYANAN);
cek('admin, belum_diisi: token diberikan', jAdmin.status === 'belum_diisi' && jAdmin.token === tokenL1, JSON.stringify(jAdmin));
const jP1 = await qr(U_PETUGAS_L1, K_LAYANAN);
cek('petugas layanan pemilik tiket, belum_diisi: token diberikan', jP1.status === 'belum_diisi' && jP1.token === tokenL1, JSON.stringify(jP1));

const jP2 = await qr(U_PETUGAS_L2, K_LAYANAN);
cek('petugas layanan lain: FORBIDDEN (42501)', jP2.ok === false && jP2.kode === '42501' && /FORBIDDEN/.test(jP2.pesan), JSON.stringify(jP2));
const jTamu = await qr(U_PENGUNJUNG, K_LAYANAN);
cek('authenticated non-staf: FORBIDDEN (42501)', jTamu.ok === false && jTamu.kode === '42501' && /FORBIDDEN/.test(jTamu.pesan), JSON.stringify(jTamu));
const jAnon = await sebagai(db, 'anon', null, 'SELECT public.ambil_qr_survei($1)', [K_LAYANAN]);
cek('anon: ditolak (42501)', jAnon.ok === false && jAnon.kode === '42501', JSON.stringify(jAnon));

const jBelumAda = await qr(U_FO, K_MENUNGGU);
cek('kunjungan tanpa undangan: tidak_ada, semua field NULL',
  jBelumAda.status === 'tidak_ada' && jBelumAda.token === null && jBelumAda.kedaluwarsa_pada === null && jBelumAda.unit === null && jBelumAda.layanan_nama === null,
  JSON.stringify(jBelumAda));
const jTidakAdaId = await qr(U_FO, K_TIDAK_ADA);
cek('id kunjungan tidak dikenal oleh FO: tidak_ada', jTidakAdaId.status === 'tidak_ada' && jTidakAdaId.token === null, JSON.stringify(jTidakAdaId));
const jTidakAdaP = await qr(U_PETUGAS_L1, K_TIDAK_ADA);
cek('id tidak dikenal oleh petugas: FORBIDDEN (tidak membocorkan keberadaan)', jTidakAdaP.ok === false && jTidakAdaP.kode === '42501', JSON.stringify(jTidakAdaP));

// sudah_diisi (K_L2), kedaluwarsa (K_FO), sudah_diisi + lewat batas sekaligus (K_GESER: sudah_diisi menang)
await pg(`UPDATE public.survei_undangan SET diisi_pada = now() WHERE kunjungan_id = '${K_L2}'`);
await pg(`UPDATE public.survei_undangan SET kedaluwarsa_pada = now() - interval '1 hour' WHERE kunjungan_id = '${K_FO}'`);
await pg(`UPDATE public.survei_undangan SET diisi_pada = now(), kedaluwarsa_pada = now() - interval '1 hour' WHERE kunjungan_id = '${K_GESER}'`);
const jDiisi = await qr(U_FO, K_L2);
cek('FO, sudah_diisi: TANPA token, unit dan layanan tetap dilaporkan', jDiisi.status === 'sudah_diisi' && jDiisi.token === null && jDiisi.unit === 'layanan' && jDiisi.layanan_nama === 'Layanan Dua', JSON.stringify(jDiisi));
const jKdl = await qr(U_FO, K_FO);
cek('FO, kedaluwarsa: TANPA token, unit fo, layanan_nama NULL', jKdl.status === 'kedaluwarsa' && jKdl.token === null && jKdl.unit === 'fo' && jKdl.layanan_nama === null, JSON.stringify(jKdl));
const jDiisiLewat = await qr(U_FO, K_GESER);
cek('sudah diisi DAN lewat batas: status sudah_diisi, tanpa token', jDiisiLewat.status === 'sudah_diisi' && jDiisiLewat.token === null, JSON.stringify(jDiisiLewat));
const jP2diisi = await qr(U_PETUGAS_L2, K_L2);
cek('petugas pemilik tiket, sudah_diisi: tanpa token', jP2diisi.status === 'sudah_diisi' && jP2diisi.token === null, JSON.stringify(jP2diisi));

// Batas tepat: kedaluwarsa_pada = now() pada transaksi yang sama (pernyataan majemuk = satu transaksi implisit,
// jadi now() sama persis) -> kedaluwarsa. Dijalankan sebagai postgres dengan auth.uid() = U_FO (parameter uid);
// ambil_qr_survei SECURITY DEFINER membaca auth.uid() dari GUC, jadi penjaga boleh_kunjungan tetap berlaku.
const batasTepat = await sebagai(
  db, 'postgres', U_FO,
  `UPDATE public.survei_undangan SET kedaluwarsa_pada = pg_catalog.now() WHERE kunjungan_id = '${K_TIKET_BATAL}';
   SELECT public.ambil_qr_survei('${K_TIKET_BATAL}') AS j`,
);
cek('tepat di batas (kedaluwarsa_pada = now()): kedaluwarsa, tanpa token', batasTepat.ok && batasTepat.rows[0].j.status === 'kedaluwarsa' && batasTepat.rows[0].j.token === null, JSON.stringify(batasTepat));

// --- (g) v_survei_status --------------------------------------------------------------------------
console.log('(g) v_survei_status menyaring per boleh_kunjungan');
const SEMUA = urut(K_LAYANAN, K_L2, K_FO, K_TIKET_BATAL, K_GESER, K_TANPA_SELESAI_AT, K_LAYANAN_HAPUS);
const tAdmin = await terlihat(U_ADMIN);
cek('admin melihat semua undangan', JSON.stringify(tAdmin) === JSON.stringify(SEMUA), JSON.stringify(tAdmin));
const tFo = await terlihat(U_FO);
cek('front_office melihat semua undangan', JSON.stringify(tFo) === JSON.stringify(SEMUA), JSON.stringify(tFo));
const tP1 = await terlihat(U_PETUGAS_L1);
cek('petugas L1 hanya kunjungan bertiket L1', JSON.stringify(tP1) === JSON.stringify(urut(K_LAYANAN)), JSON.stringify(tP1));
const tP2 = await terlihat(U_PETUGAS_L2);
cek('petugas L2 hanya kunjungan bertiket L2 (termasuk tiket batal)', JSON.stringify(tP2) === JSON.stringify(urut(K_L2, K_TIKET_BATAL)), JSON.stringify(tP2));
const tTamu = await terlihat(U_PENGUNJUNG);
cek('authenticated non-staf: 0 baris', Array.isArray(tTamu) && tTamu.length === 0, JSON.stringify(tTamu));
const tAnon = await sebagai(db, 'anon', null, 'SELECT kunjungan_id FROM public.v_survei_status');
cek('anon: SELECT view ditolak (42501)', tAnon.ok === false && tAnon.kode === '42501', JSON.stringify(tAnon));

const baris = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT * FROM public.v_survei_status');
const kolom = baris.ok && baris.rows.length > 0 ? Object.keys(baris.rows[0]).sort().join(',') : JSON.stringify(baris);
cek('kolom view persis enam dan TANPA token', kolom === 'diisi_pada,kedaluwarsa_pada,kunjungan_id,layanan_id,status,unit', kolom);
const tokenDiView = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT token FROM public.v_survei_status');
cek('SELECT token dari view gagal (kolom tidak ada, 42703)', tokenDiView.ok === false && tokenDiView.kode === '42703', JSON.stringify(tokenDiView));

const statusView = Object.fromEntries((await sebagai(db, 'authenticated', U_ADMIN, 'SELECT kunjungan_id, status, unit FROM public.v_survei_status')).rows.map((r) => [r.kunjungan_id, `${r.status}/${r.unit}`]));
cek('status turunan: K_L2 sudah_diisi/layanan', statusView[K_L2] === 'sudah_diisi/layanan', statusView[K_L2]);
cek('status turunan: K_FO kedaluwarsa/fo', statusView[K_FO] === 'kedaluwarsa/fo', statusView[K_FO]);
cek('status turunan: K_GESER sudah_diisi (menang atas kedaluwarsa)', statusView[K_GESER] === 'sudah_diisi/fo', statusView[K_GESER]);
cek('status turunan: K_TIKET_BATAL kedaluwarsa tepat di batas', statusView[K_TIKET_BATAL] === 'kedaluwarsa/fo', statusView[K_TIKET_BATAL]);
cek('status turunan: K_LAYANAN belum_diisi/layanan', statusView[K_LAYANAN] === 'belum_diisi/layanan', statusView[K_LAYANAN]);
cek('kunjungan tanpa undangan tidak ada di view (UI menampilkan "-")', statusView[K_MENUNGGU] === undefined && statusView[K_BATAL] === undefined && statusView[K_NOSHOW] === undefined);

// --- Migrasi dapat diterapkan ulang (idempoten) tanpa mengubah data ------------------------------------
console.log('penerapan ulang migrasi (idempoten)');
const snapshot = async () => JSON.stringify(await pg('SELECT id, kunjungan_id, token, unit, layanan_id, dibuat_pada, kedaluwarsa_pada, diisi_pada FROM public.survei_undangan ORDER BY kunjungan_id'));
const foto = await snapshot();
let galatUlang = '';
try {
  await terapkanBerkas(db, MIGRASI);
} catch (e) {
  galatUlang = String(e.message);
}
cek('migrasi bisa diterapkan dua kali tanpa galat', galatUlang === '', galatUlang);
cek('data undangan tidak berubah setelah penerapan ulang', (await snapshot()) === foto);
const nTrig = (await pg(`SELECT count(*)::int AS n FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.kunjungan'::regclass AND tgname = 'trg_kunjungan_selesai_undangan'`))[0].n;
cek('tepat satu trigger trg_kunjungan_selesai_undangan', nTrig === 1);

// --- Rollback (docs/rollback-survei-undangan-202610270001.sql) -------------------------------------------
console.log('rollback');
const ROLLBACK = fileURLToPath(new URL('../../docs/rollback-survei-undangan-202610270001.sql', import.meta.url));

/** Keadaan objek migrasi: true = ADA. Dipakai untuk membuktikan "tidak ada yang terhapus" dan "semua terhapus". */
const adaObjek = async () => (await pg(
  `SELECT pg_catalog.to_regclass('public.survei_undangan') IS NOT NULL AS tabel,
          pg_catalog.to_regclass('public.v_survei_status') IS NOT NULL AS tampilan,
          pg_catalog.to_regprocedure('public.ensure_undangan(uuid)') IS NOT NULL AS ensure,
          pg_catalog.to_regprocedure('public.ambil_qr_survei(uuid)') IS NOT NULL AS qr,
          pg_catalog.to_regprocedure('public.kunjungan_selesai_undangan()') IS NOT NULL AS fungsi_trigger,
          (SELECT count(*)::int FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.kunjungan'::regclass AND tgname = 'trg_kunjungan_selesai_undangan') AS trigger_ada`,
))[0];
const semuaAda = (k) => k.tabel && k.tampilan && k.ensure && k.qr && k.fungsi_trigger && k.trigger_ada === 1;

/** Terapkan rollback; kembalikan pesan galat ('' bila berhasil). */
async function jalankanRollback() {
  try {
    await terapkanBerkas(db, ROLLBACK);
    return '';
  } catch (e) {
    return String(e.message);
  }
}

// Penjaga rollback (review putaran 1). PREMIS: Postgres tidak mencatat ketergantungan dari badan plpgsql/sql ke fungsi
// atau tabel yang dipanggilnya, jadi DROP tanpa CASCADE TIDAK menolak pemakai semacam itu (nanti gagal saat dipakai:
// "function ... does not exist"). Dibuktikan dulu di blok DO yang selalu dibatalkan (RAISE di akhir = ROLLBACK).
console.log('rollback: penjaga terhadap pemakai plpgsql yang tidak tercatat sebagai ketergantungan');
await pg(`CREATE FUNCTION public.pemakai_ensure_uji() RETURNS void LANGUAGE plpgsql AS $$
  BEGIN PERFORM public.ensure_undangan(NULL::uuid); END $$`);
const premisFungsi = await sebagai(db, 'postgres', null,
  `DO $$ BEGIN DROP FUNCTION public.ensure_undangan(uuid); RAISE EXCEPTION 'PREMIS_TERBUKTI'; END $$`);
cek('premis: tanpa penjaga, DROP FUNCTION ensure_undangan BERHASIL walau fungsi plpgsql lain memanggilnya',
  premisFungsi.ok === false && /PREMIS_TERBUKTI/.test(premisFungsi.pesan), JSON.stringify(premisFungsi));
const premisTabel = await sebagai(db, 'postgres', null,
  `DO $$ BEGIN DROP VIEW public.v_survei_status; DROP FUNCTION public.ambil_qr_survei(uuid); DROP TABLE public.survei_undangan; RAISE EXCEPTION 'PREMIS_TERBUKTI'; END $$`);
cek('premis: DROP TABLE survei_undangan (tanpa CASCADE) berhasil walau badan fungsi masih menyebutnya',
  premisTabel.ok === false && /PREMIS_TERBUKTI/.test(premisTabel.pesan), JSON.stringify(premisTabel));
cek('premis tidak mengubah apa pun (blok DO dibatalkan)', semuaAda(await adaObjek()));

const fotoSebelumTolak = await snapshot();
const tolakEnsure = await jalankanRollback();
cek('penjaga: rollback DITOLAK (PRASYARAT ROLLBACK) bila fungsi plpgsql lain memanggil ensure_undangan, nama fungsi disebut',
  /PRASYARAT ROLLBACK/.test(tolakEnsure) && /pemakai_ensure_uji/.test(tolakEnsure), tolakEnsure.slice(0, 300));
const keadaanTolak = await adaObjek();
cek('penjaga: tidak ada yang terhapus (tabel, view, 3 fungsi, trigger) dan data undangan utuh', semuaAda(keadaanTolak) && (await snapshot()) === fotoSebelumTolak, JSON.stringify(keadaanTolak));
const masihBerfungsi = await qr(U_FO, K_LAYANAN);
cek('penjaga: sesudah penolakan ambil_qr_survei dan trigger tetap berfungsi', masihBerfungsi.status === 'belum_diisi' && typeof masihBerfungsi.token === 'string', JSON.stringify(masihBerfungsi));

await pg('DROP FUNCTION public.pemakai_ensure_uji()');
await pg(`CREATE FUNCTION public.pemakai_tabel_uji() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.survei_undangan $$`);
const tolakTabel = await jalankanRollback();
cek('penjaga: rollback juga DITOLAK bila fungsi lain (sql) hanya menyebut tabel survei_undangan',
  /PRASYARAT ROLLBACK/.test(tolakTabel) && /pemakai_tabel_uji/.test(tolakTabel), tolakTabel.slice(0, 300));
cek('penjaga: tetap tidak ada yang terhapus pada penolakan kedua', semuaAda(await adaObjek()) && (await snapshot()) === fotoSebelumTolak);
await pg('DROP FUNCTION public.pemakai_tabel_uji()');
// Tanpa pemakai lain, rollback lolos penjaga walau tiga fungsi sendiri saling menyebut (ambil_qr_survei menyebut
// survei_undangan, fungsi trigger menyebut ensure_undangan): berhasil pada langkah berikut.

const galatRollback = await jalankanRollback();
cek('penjaga: setelah pemakai lain dihapus, rollback BERHASIL (tiga fungsi milik sendiri tidak dihitung)', galatRollback === '', galatRollback.slice(0, 300));
const sisa = (await pg(
  `SELECT pg_catalog.to_regclass('public.survei_undangan') IS NULL AS tabel,
          pg_catalog.to_regclass('public.v_survei_status') IS NULL AS tampilan,
          pg_catalog.to_regprocedure('public.ensure_undangan(uuid)') IS NULL AS ensure,
          pg_catalog.to_regprocedure('public.ambil_qr_survei(uuid)') IS NULL AS qr,
          pg_catalog.to_regprocedure('public.kunjungan_selesai_undangan()') IS NULL AS fungsi_trigger,
          (SELECT count(*)::int FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.kunjungan'::regclass AND tgname = 'trg_kunjungan_selesai_undangan') AS trigger_tersisa`,
))[0];
cek('rollback menghapus tabel, view, tiga fungsi, dan trigger', sisa.tabel && sisa.tampilan && sisa.ensure && sisa.qr && sisa.fungsi_trigger && sisa.trigger_tersisa === 0, JSON.stringify(sisa));
const masihJalan = await sebagai(db, 'postgres', null, `UPDATE public.kunjungan SET status = 'selesai' WHERE id = '${K_MENUNGGU}'`);
cek('setelah rollback, kunjungan tetap bisa diselesaikan (trigger tidak tertinggal)', masihJalan.ok, JSON.stringify(masihJalan));
let galatRollbackUlang = '';
try {
  await terapkanBerkas(db, ROLLBACK);
} catch (e) {
  galatRollbackUlang = String(e.message);
}
cek('rollback idempoten (dua kali tanpa galat)', galatRollbackUlang === '', galatRollbackUlang);

await terapkanBerkas(db, MIGRASI);
cek('migrasi dapat diterapkan lagi setelah rollback; tabel kosong (data lama hilang, tanpa backfill)',
  (await pg('SELECT count(*)::int AS n FROM public.survei_undangan'))[0].n === 0 && (await jumlah(K_LAYANAN)) === 0);
await pg(`UPDATE public.kunjungan SET status = 'dilayani' WHERE id = '${K_BATAL}'`);
await pg(`UPDATE public.kunjungan SET status = 'selesai' WHERE id = '${K_BATAL}'`);
cek('trigger aktif lagi setelah diterapkan ulang: selesai berikutnya membuat undangan', (await jumlah(K_BATAL)) === 1);

await db.close();
