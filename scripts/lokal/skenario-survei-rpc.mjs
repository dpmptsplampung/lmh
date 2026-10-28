// Skenario PGlite untuk migrasi 202611020003_survei_rpc.sql (survei terpadu Fase A, Task 4).
// Membuktikan PERILAKU RPC publik (bisa dipanggil anon dengan sekadar memegang token) di atas stub skema; bukan pengganti
// dry-run/test:rls pemilik di DB nyata:
//   (a) kiriman sah -> submitted, tepat satu baris di spak_respons dan skm_respons, kolom terpetakan benar, diisi_pada terisi,
//       get_survei_context menjadi sudah_diisi; (b) urutan hasil kirim_survei dan get_survei_context;
//   (c) kedaluwarsa dari jam database: TEPAT di batas dan 1 detik sesudahnya ditolak, 1 mikrodetik sebelumnya diterima (R8, Review Focus 2);
//   (d) kiriman ganda: satu submitted, sisanya duplicate, tanpa baris setengah jadi (Review Focus 3);
//   (e) matriks payload nakal -> invalid dengan NOL baris tertulis (Review Focus 4);
//   (f) atomik: kegagalan setelah INSERT pertama (INSERT kedua, UPDATE diisi_pada) dan pelanggaran unik tidak menyisakan baris;
//   (g) hak: anon/authenticated memanggil kedua RPC tetapi tidak membaca/menulis tabel; tanpa EXECUTE untuk PUBLIC;
//   (h) integrasi dengan ringkasan IKM/SPAK/response rate (Task 3) dan trigger response rate lama; (i) rollback beserta urutannya.
// Objek ASLI yang tidak ada di stub (hitung_ikm, v_skm_petugas, skm_response_rate + trigger) diekstrak apa adanya dari berkas
// migrasi lama; lalu migrasi 202611020001 dan 202611020002 (prasyarat), lalu migrasi yang diuji.
// BATAS PGlite: satu sesi, tidak ada dua koneksi yang saling menunggu kunci baris. Kiriman "bersamaan" di sini = berurutan (dua
// peran/sesi berbeda, satu pernyataan, satu transaksi, dan simulasi TOCTOU lewat diisi_pada dikosongkan). Penyerialan oleh
// SELECT ... FOR UPDATE dijaga test statis (urutan FOR UPDATE terhadap pemeriksaan diisi_pada dan INSERT), bukan di sini.
// Jalankan: node scripts/lokal/skenario-survei-rpc.mjs  (butuh `npm i --no-save @electric-sql/pglite`).
// Kode keluar 0 bila semua cek lolos, 1 bila ada yang gagal atau migrasi tidak bisa diterapkan.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bukaDb, sebagai, terapkanBerkas, cek } from './pglite-harness.mjs';

const dariRepo = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const MIGRASI_UNDANGAN = dariRepo('supabase/migrations/202611020001_survei_undangan.sql');
const MIGRASI_JAWABAN = dariRepo('supabase/migrations/202611020002_survei_jawaban.sql');
const MIGRASI = dariRepo('supabase/migrations/202611020003_survei_rpc.sql');
const ROLLBACK = dariRepo('docs/rollback-survei-rpc-202611020003.sql');
const ROLLBACK_JAWABAN = dariRepo('docs/rollback-survei-jawaban-202611020002.sql');
const ROLLBACK_UNDANGAN = dariRepo('docs/rollback-survei-undangan-202611020001.sql');
const ASAL_HITUNG_IKM = dariRepo('supabase/migrations/202607140004_security_and_automation.sql');
const ASAL_V_SKM_PETUGAS = dariRepo('supabase/migrations/202610090001_rbac_tahap1.sql');
const ASAL_RR = dariRepo('supabase/migrations/202607290006_skm_response_rate.sql');

const id = (hex) => `00000000-0000-4000-8000-${hex.padStart(12, '0')}`;
const U_ADMIN = id('a1');
const U_FO = id('a2');
const U_PETUGAS_L1 = id('a3');
const U_PENGUNJUNG = id('a6'); // terautentikasi tetapi bukan staf
const L1 = id('b1'); // 'Layanan Satu'
const L2 = id('b2'); // 'Layanan Dua'
const L3 = id('b3'); // khusus uji integrasi ringkasan (satu-satunya undangan di layanan ini)

const TOKEN_ACAK = 'f'.repeat(64);

const SPAK_KOLOM = ['p1_tanpa_diskriminasi', 'p2_tanpa_kecurangan', 'p3_tanpa_imbalan', 'p4_tanpa_pungli', 'p5_tanpa_percaloan'];
const SKM_KOLOM = ['u1_persyaratan', 'u2_prosedur', 'u3_waktu', 'u4_biaya', 'u5_produk', 'u6_kompetensi', 'u7_perilaku', 'u8_sarana', 'u9_pengaduan', 'u10_transparansi', 'u11_integritas'];

// Nilai berbeda-beda tiap butir/unsur agar kolom yang tertukar terdeteksi.
const SPAK_OK = { p1: 6, p2: 5, p3: 4, p4: 3, p5: 2 };
const SKM_OK = { u1: 4, u2: 3, u3: 2, u4: 1, u5: 4, u6: 3, u7: 2, u8: 1, u9: 4, u10: 3, u11: 2 };
const nilai = (o) => Object.values(o);
const teks = (o) => JSON.stringify(o);
const SPAK_TEKS = teks(SPAK_OK);
const SKM_TEKS = teks(SKM_OK);
const JUMLAH_SKM = nilai(SKM_OK).reduce((a, b) => a + b, 0); // 29

/** Teks JSON dengan SATU nilai diganti teks mentah (agar 3.0, 1e1000, "3", dsb. persis seperti yang dikirim). */
const ganti = (o, kunci, mentah) => `{${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}:${k === kunci ? mentah : v}`).join(',')}}`;
const tanpa = (o, kunci) => teks(Object.fromEntries(Object.entries(o).filter(([k]) => k !== kunci)));
const tambah = (o, kunci, mentah) => `${teks(o).slice(0, -1)},${JSON.stringify(kunci)}:${mentah}}`;
const semua = (o, v) => teks(Object.fromEntries(Object.keys(o).map((k) => [k, v])));

const db = await bukaDb();
// PGlite mengambil zona waktu mesin; sesi Supabase berzona UTC. Kunci ke UTC supaya hasil tidak bergantung pada mesin.
await db.exec("SET TIME ZONE 'UTC'");

/** Jalankan sebagai postgres dan lempar bila gagal (seed/pembacaan bukti). */
async function pg(sql, params) {
  const r = await sebagai(db, 'postgres', null, sql, params);
  if (!r.ok) throw new Error(`pernyataan gagal: ${r.pesan}\n${sql}`);
  return r.rows;
}

/** Ekstrak blok teks dari berkas migrasi lama (apa adanya) untuk dimuat ke stub. */
function blok(berkas, awal, akhir) {
  const isi = readFileSync(berkas, 'utf8').replace(/\r\n/g, '\n');
  const i = isi.indexOf(awal);
  const j = i < 0 ? -1 : isi.indexOf(akhir, i);
  if (i < 0 || j < 0) throw new Error(`blok tidak ditemukan di ${berkas}: ${awal}`);
  return isi.slice(i, j + akhir.length);
}

// --- Prasyarat: objek ASLI yang tidak ada di stub, lalu migrasi 0001 dan 0002 ----------------------------------
console.log('memuat hitung_ikm, v_skm_petugas, skm_response_rate (+trigger) ASLI, lalu migrasi 202611020001 dan 202611020002');
await pg(blok(ASAL_HITUNG_IKM, 'CREATE FUNCTION public.hitung_ikm(', 'GRANT EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) TO anon, authenticated;'));
await pg(blok(ASAL_V_SKM_PETUGAS, 'CREATE OR REPLACE VIEW public.v_skm_petugas AS', 'GRANT SELECT ON public.v_skm_petugas TO authenticated;'));
await pg(blok(ASAL_RR, 'CREATE TABLE IF NOT EXISTS public.skm_response_rate (', 'PRIMARY KEY (layanan_id, tanggal)\n);'));
await pg('ALTER TABLE public.skm_response_rate ENABLE ROW LEVEL SECURITY');
await pg(blok(ASAL_RR, 'CREATE OR REPLACE FUNCTION public.skm_rr_tambah(', 'END $$;'));
await pg(blok(ASAL_RR, 'CREATE OR REPLACE FUNCTION public.trg_skm_insert_rr()', 'EXECUTE FUNCTION public.trg_skm_insert_rr();'));
await terapkanBerkas(db, MIGRASI_UNDANGAN);
await terapkanBerkas(db, MIGRASI_JAWABAN);
cek('prasyarat: zona waktu sesi = UTC (seperti Supabase), bukan zona mesin', (await pg('SHOW TimeZone'))[0].TimeZone === 'UTC');

// --- Sarana uji (HANYA di DB lokal ini): jejak INSERT lewat sekuens (tidak ikut rollback) dan kegagalan paksa -----------------
// Sekuens tidak transaksional: nextval yang sudah terpakai tetap terlihat walau barisnya di-rollback. Itu bukti bahwa INSERT pertama
// BENAR-BENAR berjalan sebelum kegagalan (tanpa ini cek "tidak ada baris" bisa lolos karena kegagalan terjadi sebelum INSERT apa pun).
await pg(`
  CREATE SEQUENCE public.uji_urut_spak;
  CREATE SEQUENCE public.uji_urut_skm;
  CREATE FUNCTION public.uji_fn_jejak_spak() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('public.uji_urut_spak'); RETURN NEW; END $$;
  CREATE FUNCTION public.uji_fn_jejak_skm() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('public.uji_urut_skm'); RETURN NEW; END $$;
  CREATE TRIGGER trg_uji_jejak_spak AFTER INSERT ON public.spak_respons FOR EACH ROW EXECUTE FUNCTION public.uji_fn_jejak_spak();
  CREATE TRIGGER trg_uji_jejak_skm AFTER INSERT ON public.skm_respons FOR EACH ROW EXECUTE FUNCTION public.uji_fn_jejak_skm();
  CREATE FUNCTION public.uji_fn_gagal_skm() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF pg_catalog.current_setting('app.uji_gagal', true) = 'skm' THEN RAISE EXCEPTION 'uji: kegagalan paksa pada INSERT skm_respons'; END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER trg_uji_gagal_skm BEFORE INSERT ON public.skm_respons FOR EACH ROW EXECUTE FUNCTION public.uji_fn_gagal_skm();
  CREATE FUNCTION public.uji_fn_gagal_undangan() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF pg_catalog.current_setting('app.uji_gagal', true) = 'update' AND NEW.diisi_pada IS NOT NULL THEN RAISE EXCEPTION 'uji: kegagalan paksa pada UPDATE diisi_pada'; END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER trg_uji_gagal_undangan BEFORE UPDATE ON public.survei_undangan FOR EACH ROW EXECUTE FUNCTION public.uji_fn_gagal_undangan();
`);
/** Jumlah INSERT yang pernah dicoba ke tiap tabel jawaban (sekuens tidak ikut rollback). */
const jejak = async () => {
  const [a] = await pg('SELECT last_value::int AS n, is_called FROM public.uji_urut_spak');
  const [b] = await pg('SELECT last_value::int AS n, is_called FROM public.uji_urut_skm');
  return { spak: a.is_called ? a.n : 0, skm: b.is_called ? b.n : 0 };
};
const gagalPaksa = (mode) => pg("SELECT set_config('app.uji_gagal', $1, false)", [mode]);

// --- Seed ----------------------------------------------------------------------------------------------------------
await pg(`INSERT INTO public.layanan (id, nama) VALUES ('${L1}', 'Layanan Satu'), ('${L2}', 'Layanan Dua'), ('${L3}', 'Layanan Tiga')`);
await pg(`INSERT INTO public.petugas (auth_user_id, role, aktif, layanan_id) VALUES
  ('${U_ADMIN}', 'admin', true, NULL),
  ('${U_FO}', 'front_office', true, NULL),
  ('${U_PETUGAS_L1}', 'petugas', true, '${L1}')`);

let urutan = 0;
/** Kunjungan baru yang diselesaikan (trigger 0001 membuat undangan). layanan = null -> unit fo. */
async function selesaikan({ layanan = L1, nama = 'Tamu Rahasia Uji' } = {}) {
  const k = id((0x1000 + (urutan += 1)).toString(16));
  await pg(
    `INSERT INTO public.kunjungan (id, nama, kontak_hp, email, asal, tanggal, status)
     VALUES ($1, $2, '081200000000', 'rahasia@example.test', 'walk_in', current_date, 'dilayani')`,
    [k, nama],
  );
  if (layanan) {
    await pg(`INSERT INTO public.tiket_antrean (kunjungan_id, layanan_id, status, waktu_selesai) VALUES ($1, $2, 'selesai', now())`, [k, layanan]);
  }
  await pg(`UPDATE public.kunjungan SET status = 'selesai' WHERE id = $1`, [k]);
  const [u] = await pg('SELECT id, token FROM public.survei_undangan WHERE kunjungan_id = $1', [k]);
  return { kunjungan: k, undangan: u.id, token: u.token };
}

/** Panggil kirim_survei dan kembalikan teks hasilnya (atau objek galat). */
async function kirim(role, uid, token, spakTeks, skmTeks) {
  const r = await sebagai(db, role, uid, 'SELECT public.kirim_survei($1, $2::jsonb, $3::jsonb) AS h', [token, spakTeks, skmTeks]);
  return r.ok ? r.rows[0].h : r;
}
const kirimAnon = (token, s = SPAK_TEKS, m = SKM_TEKS) => kirim('anon', null, token, s, m);

/** Panggil get_survei_context dan kembalikan objek jsonb (atau objek galat). */
async function konteks(role, uid, token) {
  const r = await sebagai(db, role, uid, 'SELECT public.get_survei_context($1) AS j', [token]);
  return r.ok ? r.rows[0].j : r;
}
const konteksAnon = (token) => konteks('anon', null, token);

/** Jumlah baris jawaban untuk sebuah kunjungan (kunjungan = null: seluruh tabel). */
async function hitungBaris(k = null) {
  const w = k === null ? '' : ' WHERE kunjungan_id = $1';
  const p = k === null ? undefined : [k];
  const [a] = await pg(`SELECT count(*)::int AS n FROM public.spak_respons${w}`, p);
  const [b] = await pg(`SELECT count(*)::int AS n FROM public.skm_respons${w}`, p);
  return { spak: a.n, skm: b.n };
}
const kosong = (j) => j.spak === 0 && j.skm === 0;
const satuSatu = (j) => j.spak === 1 && j.skm === 1;
const undangan = async (k) => (await pg('SELECT * FROM public.survei_undangan WHERE kunjungan_id = $1', [k]))[0];
const mengisiRr = async (layanan) => (await pg('SELECT COALESCE(sum(mengisi), 0)::int AS n FROM public.skm_response_rate WHERE layanan_id = $1', [layanan]))[0].n;
const nilaiSpak = async (k) => { const [r] = await pg('SELECT * FROM public.spak_respons WHERE kunjungan_id = $1', [k]); return r && SPAK_KOLOM.map((c) => r[c]); };
const nilaiSkm = async (k) => { const [r] = await pg('SELECT * FROM public.skm_respons WHERE kunjungan_id = $1', [k]); return r && SKM_KOLOM.map((c) => r[c]); };
const sama = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Atur kedaluwarsa_pada dengan ekspresi SQL LALU panggil dalam SATU transaksi: now() adalah waktu mulai transaksi, jadi now() di dalam
 * fungsi persis sama dengan now() pada ekspresi batas (uji batas TEPAT). Dijalankan sebagai anon lewat SET LOCAL ROLE.
 */
async function denganBatas(token, batasSql, panggil) {
  await db.exec('RESET ROLE');
  return db.transaction(async (tx) => {
    await tx.query(`UPDATE public.survei_undangan SET kedaluwarsa_pada = ${batasSql} WHERE token = $1`, [token]);
    await tx.exec('SET LOCAL ROLE anon');
    return panggil(tx);
  });
}
const kirimDiTx = (token) => async (tx) =>
  (await tx.query('SELECT public.kirim_survei($1, $2::jsonb, $3::jsonb) AS h', [token, SPAK_TEKS, SKM_TEKS])).rows[0].h;
const konteksDiTx = (token) => async (tx) => (await tx.query('SELECT public.get_survei_context($1) AS j', [token])).rows[0].j;

// --- Terapkan migrasi (GAGAL bila berkas belum ada: fase RED) ------------------------------------------------------------
console.log('menerapkan migrasi 202611020003');
await terapkanBerkas(db, MIGRASI);

// --- (g1) Hak EXECUTE dan sifat fungsi ---------------------------------------------------------------------------
console.log('(g) hak EXECUTE, SECURITY DEFINER, search_path');
await pg('CREATE ROLE uji_tanpa_hak NOLOGIN');
const SIG = { kirim: 'public.kirim_survei(text,jsonb,jsonb)', konteks: 'public.get_survei_context(text)' };
for (const [nama, sig] of Object.entries(SIG)) {
  const [p] = await pg(`SELECT p.prosecdef AS definer, p.provolatile AS vol, p.proconfig::text AS cfg, p.prorettype::regtype::text AS ret FROM pg_catalog.pg_proc AS p WHERE p.oid = '${sig}'::regprocedure`);
  cek(`${nama}: SECURITY DEFINER, search_path = pg_catalog, public`, p.definer === true && /search_path=pg_catalog, public/.test(p.cfg), JSON.stringify(p));
  cek(`${nama}: VOLATILE (PostgREST hanya mengekspos lewat POST: token tidak masuk query string/log akses)`, p.vol === 'v', JSON.stringify(p));
  const ret = nama === 'kirim' ? 'text' : 'jsonb';
  cek(`${nama}: RETURNS ${ret}`, p.ret === ret, JSON.stringify(p));
  const [anon] = await pg(`SELECT has_function_privilege('anon', '${sig}', 'EXECUTE') AS ok`);
  const [auth] = await pg(`SELECT has_function_privilege('authenticated', '${sig}', 'EXECUTE') AS ok`);
  const [tanpaHak] = await pg(`SELECT has_function_privilege('uji_tanpa_hak', '${sig}', 'EXECUTE') AS ok`);
  const [publik] = await pg(`SELECT count(*)::int AS n FROM pg_catalog.pg_proc AS p, LATERAL pg_catalog.aclexplode(p.proacl) AS a WHERE p.oid = '${sig}'::regprocedure AND a.grantee = 0`);
  cek(`${nama}: EXECUTE untuk anon dan authenticated`, anon.ok === true && auth.ok === true);
  cek(`${nama}: TIDAK ada EXECUTE untuk PUBLIC (role tanpa hak ditolak)`, publik.n === 0 && tanpaHak.ok === false, JSON.stringify({ publik, tanpaHak }));
  const grantee = (await pg(`SELECT DISTINCT COALESCE(r.rolname, 'PUBLIC') AS nama FROM pg_catalog.pg_proc AS p, LATERAL pg_catalog.aclexplode(p.proacl) AS a LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = a.grantee WHERE p.oid = '${sig}'::regprocedure ORDER BY 1`)).map((x) => x.nama);
  cek(`${nama}: pemegang EXECUTE hanya anon, authenticated, pemilik, dan service_role (default Supabase)`, grantee.every((n) => ['anon', 'authenticated', 'postgres', 'service_role'].includes(n)) && grantee.includes('anon') && grantee.includes('authenticated'), grantee.join(','));
}
cek('waktu hanya dari database: kedua fungsi tidak punya parameter bertipe waktu/tanggal', (await pg(`SELECT count(*)::int AS n FROM pg_catalog.pg_proc AS p WHERE p.proname IN ('kirim_survei', 'get_survei_context') AND pg_catalog.pg_get_function_arguments(p.oid) ~* '(time|date)'`))[0].n === 0);

// --- (b) Konteks untuk token dalam berbagai keadaan (read-only) -------------------------------------------------------
console.log('(b) get_survei_context: isi minimal dan token tidak sah');
const kL1 = await selesaikan({ layanan: L1, nama: 'Nama Pengunjung Rahasia' });
const kFo = await selesaikan({ layanan: null });
const c1 = await konteksAnon(kL1.token);
cek('konteks token sah (anon): status ok, unit layanan, layanan_nama terisi', c1.status === 'ok' && c1.unit === 'layanan' && c1.layanan_nama === 'Layanan Satu', JSON.stringify(c1));
cek('konteks: kunci persis {status, unit, layanan_nama, kedaluwarsa_pada} (tanpa yang lain)', sama(Object.keys(c1).sort(), ['kedaluwarsa_pada', 'layanan_nama', 'status', 'unit']), JSON.stringify(c1));
const bocor = JSON.stringify(c1);
cek('konteks tidak membocorkan id kunjungan/undangan/layanan, token, nama, HP, email', ![kL1.kunjungan, kL1.undangan, L1, kL1.token, 'Rahasia', '081200000000', 'example.test'].some((s) => bocor.includes(s)), bocor);
const [{ persis }] = await pg(
  `SELECT ((public.get_survei_context(u.token) ->> 'kedaluwarsa_pada')::timestamptz = u.kedaluwarsa_pada) AS persis FROM public.survei_undangan AS u WHERE u.token = $1`,
  [kL1.token],
);
cek('konteks: kedaluwarsa_pada = batas undangan (selesai_at + 32 jam) persis', persis === true);
const cFo = await konteksAnon(kFo.token);
cek('konteks unit fo: layanan_nama NULL, unit fo, status ok', cFo.status === 'ok' && cFo.unit === 'fo' && cFo.layanan_nama === null && cFo.kedaluwarsa_pada !== null, JSON.stringify(cFo));
cek('konteks juga bisa dipanggil authenticated (pengunjung login) dengan hasil sama', sama(await konteks('authenticated', U_PENGUNJUNG, kL1.token), c1));
for (const [nama, token] of [['token acak 64 hex', TOKEN_ACAK], ['token pendek', 'abc'], ['string kosong', ''], ['NULL', null], ['teks tautan', `https://x.test/survei/${kL1.token}`]]) {
  const c = await konteksAnon(token);
  cek(`konteks ${nama} -> tidak_valid dengan unit/layanan_nama/kedaluwarsa_pada semua null`, c.status === 'tidak_valid' && c.unit === null && c.layanan_nama === null && c.kedaluwarsa_pada === null && Object.keys(c).length === 4, JSON.stringify(c));
}

// --- (e) Matriks payload nakal: SEMUA invalid, nol baris, undangan utuh ---------------------------------------------
console.log('(e) payload nakal -> invalid, tidak ada baris tertulis');
const kN = await selesaikan({ layanan: L1 });
const jejakAwal = await jejak();
const MATRIKS = [
  ['kunci asing pada SPAK (p6)', tambah(SPAK_OK, 'p6', '3'), SKM_TEKS],
  ['kunci asing menggantikan p5 (x5)', teks({ p1: 1, p2: 1, p3: 1, p4: 1, x5: 1 }), SKM_TEKS],
  ['kunci asing pada SKM (u12)', SPAK_TEKS, tambah(SKM_OK, 'u12', '3')],
  ['SPAK kunci kurang (tanpa p5)', tanpa(SPAK_OK, 'p5'), SKM_TEKS],
  ['SPAK kunci kurang (tanpa p1)', tanpa(SPAK_OK, 'p1'), SKM_TEKS],
  ['SKM kunci kurang (tanpa u11)', SPAK_TEKS, tanpa(SKM_OK, 'u11')],
  ['SKM 9 unsur gaya lama (u1..u9 saja)', SPAK_TEKS, teks(Object.fromEntries(Object.entries(SKM_OK).slice(0, 9)))],
  ['SPAK objek kosong', '{}', SKM_TEKS],
  ['SKM objek kosong', SPAK_TEKS, '{}'],
  ['kunci huruf besar (P1)', SPAK_TEKS.replace('"p1"', '"P1"'), SKM_TEKS],
  ['SPAK nilai 0', ganti(SPAK_OK, 'p1', '0'), SKM_TEKS],
  ['SPAK skala 7 (di atas 6)', ganti(SPAK_OK, 'p3', '7'), SKM_TEKS],
  ['SPAK nilai 3.5', ganti(SPAK_OK, 'p2', '3.5'), SKM_TEKS],
  ['SPAK nilai string "3"', ganti(SPAK_OK, 'p4', '"3"'), SKM_TEKS],
  ['SPAK nilai null', ganti(SPAK_OK, 'p5', 'null'), SKM_TEKS],
  ['SPAK nilai array [3]', ganti(SPAK_OK, 'p1', '[3]'), SKM_TEKS],
  ['SPAK nilai objek {"a":3}', ganti(SPAK_OK, 'p1', '{"a":3}'), SKM_TEKS],
  ['SPAK nilai boolean true', ganti(SPAK_OK, 'p1', 'true'), SKM_TEKS],
  ['SKM nilai 0', SPAK_TEKS, ganti(SKM_OK, 'u1', '0')],
  ['SKM skala 5 (di atas 4)', SPAK_TEKS, ganti(SKM_OK, 'u6', '5')],
  ['SKM skala 6 (valid untuk SPAK, bukan SKM)', SPAK_TEKS, ganti(SKM_OK, 'u11', '6')],
  ['SKM nilai 3.5', SPAK_TEKS, ganti(SKM_OK, 'u3', '3.5')],
  ['SKM nilai string "3"', SPAK_TEKS, ganti(SKM_OK, 'u10', '"3"')],
  ['SKM nilai null', SPAK_TEKS, ganti(SKM_OK, 'u11', 'null')],
  ['SKM nilai array [3]', SPAK_TEKS, ganti(SKM_OK, 'u2', '[3]')],
  ['SKM nilai objek', SPAK_TEKS, ganti(SKM_OK, 'u2', '{"a":3}')],
  ['SKM nilai boolean true', SPAK_TEKS, ganti(SKM_OK, 'u9', 'true')],
  ['payload tertukar (SKM sebagai SPAK dan sebaliknya)', SKM_TEKS, SPAK_TEKS],
  ['SPAK bukan objek: array kosong', '[]', SKM_TEKS],
  ['SPAK bukan objek: array berisi nilai', '[6,5,4,3,2]', SKM_TEKS],
  ['SPAK bukan objek: string', '"p1"', SKM_TEKS],
  ['SPAK bukan objek: angka', '5', SKM_TEKS],
  ['SPAK bukan objek: JSON null', 'null', SKM_TEKS],
  ['SPAK bukan objek: boolean', 'true', SKM_TEKS],
  ['SPAK SQL NULL', null, SKM_TEKS],
  ['SKM bukan objek: array kosong', SPAK_TEKS, '[]'],
  ['SKM bukan objek: string', SPAK_TEKS, '"u1"'],
  ['SKM bukan objek: angka', SPAK_TEKS, '4'],
  ['SKM bukan objek: JSON null', SPAK_TEKS, 'null'],
  ['SKM SQL NULL', SPAK_TEKS, null],
  ['keduanya SQL NULL', null, null],
];
for (const [nama, s, m] of MATRIKS) {
  const h = await kirimAnon(kN.token, s, m);
  cek(`payload nakal: ${nama} -> invalid`, h === 'invalid', JSON.stringify(h));
}
// Matriks nilai x kunci (sisi pertama, tengah, dan terakhir tiap objek menangkap galat batas perulangan).
const NILAI_SPAK_NAKAL = ['0', '7', '-1', '3.5', '"3"', 'null', 'true', 'false', '[3]', '[]', '{}', '{"a":3}', '""', '1e1000', '-1e1000', '2.9999999999999999999', '6.0000000000000000001', '0.9999999999999999999', '7.0', '6.5', '"6"'];
const NILAI_SKM_NAKAL = ['0', '5', '6', '7', '-1', '3.5', '"3"', 'null', 'true', 'false', '[3]', '[]', '{}', '{"a":3}', '""', '1e1000', '-1e1000', '3.9999999999999999999', '4.0000000000000000001', '0.9999999999999999999', '5.0', '4.5', '"4"'];
const lolosNakal = [];
let jumlahNakal = 0;
for (const kunci of ['p1', 'p3', 'p5']) {
  for (const v of NILAI_SPAK_NAKAL) {
    jumlahNakal += 1;
    const h = await kirimAnon(kN.token, ganti(SPAK_OK, kunci, v), SKM_TEKS);
    if (h !== 'invalid') lolosNakal.push(`SPAK ${kunci}=${v} -> ${JSON.stringify(h)}`);
  }
}
for (const kunci of ['u1', 'u6', 'u10', 'u11']) {
  for (const v of NILAI_SKM_NAKAL) {
    jumlahNakal += 1;
    const h = await kirimAnon(kN.token, SPAK_TEKS, ganti(SKM_OK, kunci, v));
    if (h !== 'invalid') lolosNakal.push(`SKM ${kunci}=${v} -> ${JSON.stringify(h)}`);
  }
}
cek(`matriks ${jumlahNakal} kombinasi nilai nakal x kunci (SPAK p1/p3/p5, SKM u1/u6/u10/u11) semuanya invalid`, lolosNakal.length === 0, lolosNakal.join('; '));
for (const [nama, token] of [['NULL', null], ['string kosong', ''], ['3 karakter', 'abc'], ['15 karakter', 'a'.repeat(15)]]) {
  const h = await kirimAnon(token, SPAK_TEKS, SKM_TEKS);
  cek(`token ${nama} (payload sah) -> invalid (panjang token minimal 16)`, h === 'invalid', JSON.stringify(h));
}
cek('setelah seluruh matriks: NOL baris di spak_respons dan skm_respons', kosong(await hitungBaris()), JSON.stringify(await hitungBaris()));
cek('setelah seluruh matriks: tidak ada INSERT yang pernah dicoba (jejak sekuens nol) dan undangan tetap belum diisi', sama(await jejak(), jejakAwal) && (await undangan(kN.kunjungan)).diisi_pada === null);
cek('payload nakal tidak menghanguskan undangan: konteks masih ok', (await konteksAnon(kN.token)).status === 'ok');

// --- (b) Urutan pemeriksaan kirim_survei ---------------------------------------------------------------------------
console.log('(b) urutan hasil kirim_survei: invalid -> not_found -> duplicate -> expired -> invalid (status kunjungan)');
cek('payload invalid menang atas token yang tidak ada (64 hex acak) -> invalid', (await kirimAnon(TOKEN_ACAK, ganti(SPAK_OK, 'p1', '0'), SKM_TEKS)) === 'invalid');
cek('payload sah + token 64 hex yang tidak ada -> not_found', (await kirimAnon(TOKEN_ACAK)) === 'not_found');
cek('payload sah + token 16 karakter yang tidak ada -> not_found', (await kirimAnon('a'.repeat(16))) === 'not_found');
cek('payload sah + token 200 karakter yang tidak ada -> not_found (tidak galat)', (await kirimAnon('b'.repeat(200))) === 'not_found');
cek('token berhuruf besar (format beda dari token asli) -> not_found', (await kirimAnon(kN.token.toUpperCase())) === 'not_found');
const kUrut = await selesaikan({ layanan: L1 });
await pg(`UPDATE public.survei_undangan SET kedaluwarsa_pada = now() - interval '1 hour' WHERE token = $1`, [kUrut.token]);
cek('undangan kedaluwarsa + payload nakal -> invalid (payload dicek lebih dulu)', (await kirimAnon(kUrut.token, ganti(SPAK_OK, 'p1', '9'), SKM_TEKS)) === 'invalid');
cek('undangan kedaluwarsa + payload sah -> expired', (await kirimAnon(kUrut.token)) === 'expired');
cek('kedaluwarsa: konteks melaporkan kedaluwarsa', (await konteksAnon(kUrut.token)).status === 'kedaluwarsa');
await pg(`UPDATE public.kunjungan SET status = 'dilayani' WHERE id = $1`, [kUrut.kunjungan]);
cek('undangan kedaluwarsa DAN kunjungan dibuka lagi -> expired (kedaluwarsa dicek sebelum status kunjungan)', (await kirimAnon(kUrut.token)) === 'expired');
await pg(`UPDATE public.survei_undangan SET kedaluwarsa_pada = now() + interval '1 hour' WHERE token = $1`, [kUrut.token]);
cek('kunjungan dibuka lagi (bukan selesai) + undangan masih berlaku -> invalid', (await kirimAnon(kUrut.token)) === 'invalid');
cek('... tanpa baris tertulis dan diisi_pada tetap kosong', kosong(await hitungBaris(kUrut.kunjungan)) && (await undangan(kUrut.kunjungan)).diisi_pada === null);
cek('... sedangkan konteks (tanpa cek status kunjungan, sesuai kontrak) tetap ok', (await konteksAnon(kUrut.token)).status === 'ok');
await pg(`UPDATE public.kunjungan SET status = 'selesai' WHERE id = $1`, [kUrut.kunjungan]);
cek('kunjungan diselesaikan lagi -> kiriman sah diterima (undangan tidak rusak oleh percobaan sebelumnya)', (await kirimAnon(kUrut.token)) === 'submitted');

// --- (c) Batas kedaluwarsa dari jam database (R8: now() >= kedaluwarsa_pada = kedaluwarsa) ----------------------------------
console.log('(c) batas kedaluwarsa tepat, 1 detik sesudah, dan 1 mikrodetik sebelum');
const kB1 = await selesaikan({ layanan: L1 });
const kB2 = await selesaikan({ layanan: L1 });
const kB3 = await selesaikan({ layanan: L1 });
const kB4 = await selesaikan({ layanan: L1 });
const kB5 = await selesaikan({ layanan: L1 });
cek('kirim TEPAT di batas (kedaluwarsa_pada = now()) -> expired', (await denganBatas(kB1.token, 'now()', kirimDiTx(kB1.token))) === 'expired');
cek('... dan tidak ada baris tertulis', kosong(await hitungBaris(kB1.kunjungan)));
cek('kirim 1 detik SESUDAH batas (kedaluwarsa_pada = now() - 1 detik) -> expired', (await denganBatas(kB2.token, "now() - interval '1 second'", kirimDiTx(kB2.token))) === 'expired');
cek('... dan tidak ada baris tertulis', kosong(await hitungBaris(kB2.kunjungan)));
cek('konteks TEPAT di batas -> kedaluwarsa', (await denganBatas(kB3.token, 'now()', konteksDiTx(kB3.token))).status === 'kedaluwarsa');
cek('konteks 1 detik sesudah batas -> kedaluwarsa', (await denganBatas(kB4.token, "now() - interval '1 second'", konteksDiTx(kB4.token))).status === 'kedaluwarsa');
cek('konteks 1 mikrodetik SEBELUM batas (kedaluwarsa_pada = now() + 1 mikrodetik) -> ok', (await denganBatas(kB5.token, "now() + interval '1 microsecond'", konteksDiTx(kB5.token))).status === 'ok');
cek('kirim 1 mikrodetik SEBELUM batas -> submitted (batas tidak menolak lebih awal)', (await denganBatas(kB5.token, "now() + interval '1 microsecond'", kirimDiTx(kB5.token))) === 'submitted');
cek('... dan tepat satu baris di tiap tabel', satuSatu(await hitungBaris(kB5.kunjungan)));
// sudah_diisi menang atas kedaluwarsa (konteks) dan duplicate menang atas expired (kirim), seperti ambil_qr_survei.
await pg(`UPDATE public.survei_undangan SET kedaluwarsa_pada = now() - interval '1 hour' WHERE token = $1`, [kB5.token]);
cek('sudah diisi DAN lewat batas: konteks sudah_diisi (menang atas kedaluwarsa)', (await konteksAnon(kB5.token)).status === 'sudah_diisi');
cek('sudah diisi DAN lewat batas: kirim -> duplicate (menang atas expired)', (await kirimAnon(kB5.token)) === 'duplicate');

// --- (a) Kiriman sah: tepat satu baris, kolom terpetakan, diisi_pada, konteks ------------------------------------------
console.log('(a) kiriman sah: satu baris per tabel, pemetaan kolom, sudah_diisi');
const rrSebelum = await mengisiRr(L1);
const jejakSebelum = await jejak();
cek('kiriman sah (anon) -> submitted', (await kirimAnon(kL1.token)) === 'submitted');
const jejakSesudah = await jejak();
cek('tepat satu baris di spak_respons dan satu di skm_respons untuk kunjungan itu', satuSatu(await hitungBaris(kL1.kunjungan)));
cek('... masing-masing hanya SATU INSERT yang dijalankan (jejak +1 SPAK, +1 SKM)', jejakSesudah.spak === jejakSebelum.spak + 1 && jejakSesudah.skm === jejakSebelum.skm + 1, JSON.stringify({ jejakSebelum, jejakSesudah }));
const [spak] = await pg('SELECT * FROM public.spak_respons WHERE kunjungan_id = $1', [kL1.kunjungan]);
const [skm] = await pg('SELECT * FROM public.skm_respons WHERE kunjungan_id = $1', [kL1.kunjungan]);
cek('SPAK: p1..p5 masuk ke kolom yang tepat (nilai 6,5,4,3,2 berurutan)', sama(SPAK_KOLOM.map((c) => spak[c]), nilai(SPAK_OK)), JSON.stringify(spak));
cek('SKM: u1..u11 masuk ke kolom yang tepat (nilai berurutan)', sama(SKM_KOLOM.map((c) => skm[c]), nilai(SKM_OK)), JSON.stringify(skm));
cek('SPAK: sumber wizard, unit layanan, layanan_id dari undangan, kolom impor kosong', spak.sumber === 'wizard' && spak.unit === 'layanan' && spak.layanan_id === L1 && spak.jenis_kelamin === null && spak.pendidikan === null, JSON.stringify(spak));
cek('SKM: sumber wizard, versi 2, unit layanan, layanan_id dari undangan, visit_id/saran/jenis_kelamin/pendidikan kosong', skm.sumber === 'wizard' && skm.versi === 2 && skm.unit === 'layanan' && skm.layanan_id === L1 && skm.visit_id === null && skm.saran === null && skm.jenis_kelamin === null && skm.pendidikan === null, JSON.stringify(skm));
const [serempak] = await pg(
  'SELECT (u.diisi_pada IS NOT NULL) AS terisi, (u.diisi_pada = sp.created_at AND u.diisi_pada = sk.created_at) AS serempak FROM public.survei_undangan AS u, public.spak_respons AS sp, public.skm_respons AS sk WHERE u.kunjungan_id = $1 AND sp.kunjungan_id = $1 AND sk.kunjungan_id = $1',
  [kL1.kunjungan],
);
cek('diisi_pada terisi', serempak.terisi === true);
cek('diisi_pada, spak.created_at, dan skm.created_at sama persis (satu transaksi, jam database)', serempak.serempak === true);
const cSesudah = await konteksAnon(kL1.token);
cek('konteks sesudah kiriman -> sudah_diisi (unit dan layanan_nama tetap ada)', cSesudah.status === 'sudah_diisi' && cSesudah.unit === 'layanan' && cSesudah.layanan_nama === 'Layanan Satu', JSON.stringify(cSesudah));
cek('trigger response rate lama ikut berjalan dalam transaksi yang sama: mengisi layanan +1', (await mengisiRr(L1)) === rrSebelum + 1, `${rrSebelum} -> ${await mengisiRr(L1)}`);

// --- (d) Kiriman ganda --------------------------------------------------------------------------------------------------
console.log('(d) kiriman ganda: satu submitted, sisanya duplicate, tanpa baris setengah jadi');
const rr0 = await mengisiRr(L1);
const jejakGanda0 = await jejak();
cek('kiriman kedua (anon, nilai berbeda) -> duplicate', (await kirimAnon(kL1.token, teks({ p1: 1, p2: 1, p3: 1, p4: 1, p5: 1 }), semua(SKM_OK, 1))) === 'duplicate');
cek('kiriman ketiga dari sesi lain (authenticated) -> duplicate', (await kirim('authenticated', U_PENGUNJUNG, kL1.token, SPAK_TEKS, SKM_TEKS)) === 'duplicate');
cek('jumlah baris tetap 1/1, nilai pertama tidak tertimpa, tidak ada INSERT yang dicoba lagi (jejak sama)', satuSatu(await hitungBaris(kL1.kunjungan)) && sama(await nilaiSpak(kL1.kunjungan), nilai(SPAK_OK)) && sama(await nilaiSkm(kL1.kunjungan), nilai(SKM_OK)) && sama(await jejak(), jejakGanda0));
cek('response rate tidak bertambah oleh kiriman ganda', (await mengisiRr(L1)) === rr0);
const kGanda = await selesaikan({ layanan: L2 });
const [seStatement] = await pg('SELECT public.kirim_survei($1, $2::jsonb, $3::jsonb) AS a, public.kirim_survei($1, $2::jsonb, $3::jsonb) AS b', [kGanda.token, SPAK_TEKS, SKM_TEKS]);
cek('dua panggilan dalam SATU pernyataan/transaksi (ketukan ganda): submitted lalu duplicate', seStatement.a === 'submitted' && seStatement.b === 'duplicate', JSON.stringify(seStatement));
cek('... tepat satu baris di tiap tabel', satuSatu(await hitungBaris(kGanda.kunjungan)));
const kGanda2 = await selesaikan({ layanan: L2 });
const rrL2 = await mengisiRr(L2);
const berurutan = [];
for (let i = 0; i < 8; i += 1) berurutan.push(await kirimAnon(kGanda2.token));
cek('8 kiriman beruntun pada undangan yang sama: kiriman pertama submitted, 7 sisanya duplicate', berurutan[0] === 'submitted' && berurutan.slice(1).every((h) => h === 'duplicate'), berurutan.join(','));
cek('... tepat satu baris di tiap tabel dan response rate L2 hanya +1', satuSatu(await hitungBaris(kGanda2.kunjungan)) && (await mengisiRr(L2)) === rrL2 + 1);
// Pertahanan berlapis: bila pemeriksaan diisi_pada terlewat (TOCTOU: transaksi kedua membaca undangan sebelum yang pertama commit),
// indeks unik kunjungan_id pada kedua tabel tetap menolak -> duplicate tanpa baris tambahan. Disimulasikan dengan mengosongkan diisi_pada.
const kToctou = await selesaikan({ layanan: L1 });
cek('TOCTOU: kiriman pertama -> submitted', (await kirimAnon(kToctou.token)) === 'submitted');
await pg('UPDATE public.survei_undangan SET diisi_pada = NULL WHERE token = $1', [kToctou.token]);
const j0 = await jejak();
cek('TOCTOU (diisi_pada dikosongkan): kiriman kedua tetap duplicate lewat indeks unik', (await kirimAnon(kToctou.token, teks({ p1: 1, p2: 1, p3: 1, p4: 1, p5: 1 }), semua(SKM_OK, 1))) === 'duplicate');
cek('TOCTOU: tetap satu baris per tabel dan nilai pertama utuh', satuSatu(await hitungBaris(kToctou.kunjungan)) && sama(await nilaiSpak(kToctou.kunjungan), nilai(SPAK_OK)) && sama(await nilaiSkm(kToctou.kunjungan), nilai(SKM_OK)));
const j1 = await jejak();
cek('TOCTOU: INSERT SPAK memang menabrak indeks unik (dicoba lebih dulu) sehingga SKM tidak sempat dicoba (jejak SKM tetap)', j1.skm === j0.skm, JSON.stringify({ j0, j1 }));

// --- (f) Atomik ---------------------------------------------------------------------------------------------------------------
console.log('(f) atomik: kegagalan di tengah tidak menyisakan baris di tabel mana pun');
const rrA = await mengisiRr(L1);
const kA = await selesaikan({ layanan: L1 });
{
  const a0 = await jejak();
  await gagalPaksa('skm');
  const r = await sebagai(db, 'anon', null, 'SELECT public.kirim_survei($1, $2::jsonb, $3::jsonb) AS h', [kA.token, SPAK_TEKS, SKM_TEKS]);
  await gagalPaksa('');
  const a1 = await jejak();
  cek('kegagalan paksa pada INSERT skm_respons: panggilan gagal (galat sampai ke pemanggil, bukan teks palsu)', r.ok === false && /kegagalan paksa pada INSERT skm_respons/.test(r.pesan), JSON.stringify(r));
  cek('... INSERT SPAK memang berjalan lebih dulu (jejak +1), skm tidak sempat masuk (jejak SKM tetap)', a1.spak === a0.spak + 1 && a1.skm === a0.skm, JSON.stringify({ a0, a1 }));
  cek('... namun NOL baris di spak_respons dan skm_respons (INSERT pertama ikut di-rollback)', kosong(await hitungBaris(kA.kunjungan)), JSON.stringify(await hitungBaris(kA.kunjungan)));
  cek('... diisi_pada tetap kosong dan response rate tidak berubah', (await undangan(kA.kunjungan)).diisi_pada === null && (await mengisiRr(L1)) === rrA);
  cek('... undangan tetap bisa dipakai: konteks ok', (await konteksAnon(kA.token)).status === 'ok');
}
{
  const a0 = await jejak();
  await gagalPaksa('update');
  const r = await sebagai(db, 'anon', null, 'SELECT public.kirim_survei($1, $2::jsonb, $3::jsonb) AS h', [kA.token, SPAK_TEKS, SKM_TEKS]);
  await gagalPaksa('');
  const a1 = await jejak();
  cek('kegagalan paksa pada UPDATE diisi_pada (langkah terakhir): panggilan gagal', r.ok === false && /kegagalan paksa pada UPDATE diisi_pada/.test(r.pesan), JSON.stringify(r));
  cek('... KEDUA INSERT berjalan (jejak SPAK +1 dan SKM +1) tetapi NOL baris tersisa di kedua tabel', a1.spak === a0.spak + 1 && a1.skm === a0.skm + 1 && kosong(await hitungBaris(kA.kunjungan)), JSON.stringify({ a0, a1, baris: await hitungBaris(kA.kunjungan) }));
  cek('... diisi_pada kosong dan response rate (trigger AFTER INSERT skm) ikut dibatalkan', (await undangan(kA.kunjungan)).diisi_pada === null && (await mengisiRr(L1)) === rrA);
  cek('setelah kegagalan paksa dicabut, kiriman ulang -> submitted (percobaan gagal tidak mengunci undangan)', (await kirimAnon(kA.token)) === 'submitted');
  cek('... tepat satu baris di tiap tabel dan response rate +1', satuSatu(await hitungBaris(kA.kunjungan)) && (await mengisiRr(L1)) === rrA + 1);
}
// Pelanggaran unik: jawaban lama untuk kunjungan yang sama sudah ada (mis. form SKM lama, atau impor) -> duplicate, tanpa baris tertinggal.
const kU1 = await selesaikan({ layanan: L1 });
await pg(`INSERT INTO public.skm_respons (layanan_id, kunjungan_id, u1_persyaratan, u2_prosedur, u3_waktu, u4_biaya, u5_produk, u6_kompetensi, u7_perilaku, u8_sarana, u9_pengaduan, unit)
          VALUES ($1, $2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 'layanan')`, [L1, kU1.kunjungan]);
{
  const u0 = await jejak();
  const rrU = await mengisiRr(L1);
  const h = await kirimAnon(kU1.token);
  const u1 = await jejak();
  cek('jawaban SKM lama untuk kunjungan itu sudah ada: kiriman wizard -> duplicate', h === 'duplicate', JSON.stringify(h));
  cek('... INSERT SPAK sempat berjalan (jejak +1), INSERT SKM menabrak indeks unik, dan SPAK ikut dibatalkan: spak 0, skm tetap 1 (baris lama)', u1.spak === u0.spak + 1 && sama(await hitungBaris(kU1.kunjungan), { spak: 0, skm: 1 }), JSON.stringify({ u0, u1, baris: await hitungBaris(kU1.kunjungan) }));
  cek('... response rate tidak berubah dan diisi_pada tetap kosong (dicatat: undangan tidak otomatis dianggap terisi)', (await mengisiRr(L1)) === rrU && (await undangan(kU1.kunjungan)).diisi_pada === null);
}
const kU2 = await selesaikan({ layanan: L1 });
await pg(`INSERT INTO public.spak_respons (kunjungan_id, layanan_id, unit, sumber, p1_tanpa_diskriminasi, p2_tanpa_kecurangan, p3_tanpa_imbalan, p4_tanpa_pungli, p5_tanpa_percaloan)
          VALUES ($1, $2, 'layanan', 'impor', 3, 3, 3, 3, 3)`, [kU2.kunjungan, L1]);
{
  const u0 = await jejak();
  const h = await kirimAnon(kU2.token);
  const u1 = await jejak();
  cek('jawaban SPAK untuk kunjungan itu sudah ada: kiriman wizard -> duplicate', h === 'duplicate', JSON.stringify(h));
  cek('... INSERT SPAK menabrak indeks unik lebih dulu, SKM tidak dicoba: spak tetap 1 (baris lama), skm 0', u1.skm === u0.skm && sama(await hitungBaris(kU2.kunjungan), { spak: 1, skm: 0 }), JSON.stringify({ u0, u1 }));
}

// --- Bentuk angka yang diterima -------------------------------------------------------------------------------------------
console.log('bentuk angka: bilangan bulat apa pun bentuk tulisnya diterima dan disimpan sebagai bilangan bulat');
const kAng = await selesaikan({ layanan: L1 });
const spakBentuk = '{"p1":3.0,"p2":1e0,"p3":6.00,"p4":2,"p5":0.5e1}';
const skmBentuk = '{"u1":4.0,"u2":3,"u3":2,"u4":1,"u5":1e0,"u6":2,"u7":3,"u8":4,"u9":0.4e1,"u10":3.000,"u11":2}';
cek('3.0, 1e0, 6.00, 0.5e1, 4.0, 0.4e1 (bilangan bulat bertulisan lain) -> submitted', (await kirimAnon(kAng.token, spakBentuk, skmBentuk)) === 'submitted');
cek('... tersimpan sebagai 3,1,6,2,5 dan 4,3,2,1,1,2,3,4,4,3,2', sama(await nilaiSpak(kAng.kunjungan), [3, 1, 6, 2, 5]) && sama(await nilaiSkm(kAng.kunjungan), [4, 3, 2, 1, 1, 2, 3, 4, 4, 3, 2]));
const kMin = await selesaikan({ layanan: L1 });
cek('batas bawah: SPAK semua 1 dan SKM semua 1 -> submitted', (await kirimAnon(kMin.token, semua(SPAK_OK, 1), semua(SKM_OK, 1))) === 'submitted' && sama(await nilaiSpak(kMin.kunjungan), [1, 1, 1, 1, 1]) && sama(await nilaiSkm(kMin.kunjungan), Array(11).fill(1)));
const kMaks = await selesaikan({ layanan: L1 });
cek('batas atas: SPAK semua 6 dan SKM semua 4 -> submitted', (await kirimAnon(kMaks.token, semua(SPAK_OK, 6), semua(SKM_OK, 4))) === 'submitted' && sama(await nilaiSpak(kMaks.kunjungan), Array(5).fill(6)) && sama(await nilaiSkm(kMaks.kunjungan), Array(11).fill(4)));
const kSpasi = await selesaikan({ layanan: L1 });
cek(
  'JSON dengan spasi dan urutan kunci terbalik -> submitted dan tetap terpetakan menurut NAMA kunci, bukan urutan',
  (await kirimAnon(kSpasi.token, '{ "p5" : 2, "p4" : 3, "p3": 4, "p2": 5, "p1": 6 }', '{"u11":2,"u10":3,"u9":4,"u8":1,"u7":2,"u6":3,"u5":4,"u4":1,"u3":2,"u2":3,"u1":4}')) === 'submitted' &&
    sama(await nilaiSpak(kSpasi.kunjungan), nilai(SPAK_OK)) && sama(await nilaiSkm(kSpasi.kunjungan), nilai(SKM_OK)),
);

// --- Unit Front Office -----------------------------------------------------------------------------------------------------
console.log('unit Front Office: layanan_id kosong, response rate lama diabaikan');
const rrSemuaSebelum = (await pg('SELECT COALESCE(sum(mengisi), 0)::int AS n FROM public.skm_response_rate'))[0].n;
cek('kunjungan selesai di FO (undangan unit fo): kiriman sah -> submitted', (await kirimAnon(kFo.token)) === 'submitted');
const [spakFo] = await pg('SELECT unit, layanan_id, sumber FROM public.spak_respons WHERE kunjungan_id = $1', [kFo.kunjungan]);
const [skmFo] = await pg('SELECT unit, layanan_id, sumber, versi FROM public.skm_respons WHERE kunjungan_id = $1', [kFo.kunjungan]);
cek('baris FO: unit fo, layanan_id NULL, sumber wizard (SPAK dan SKM), SKM versi 2', spakFo.unit === 'fo' && spakFo.layanan_id === null && spakFo.sumber === 'wizard' && skmFo.unit === 'fo' && skmFo.layanan_id === null && skmFo.sumber === 'wizard' && skmFo.versi === 2, JSON.stringify({ spakFo, skmFo }));
cek('response rate lama mengabaikan layanan NULL (tidak ada penambahan, tidak galat)', (await pg('SELECT COALESCE(sum(mengisi), 0)::int AS n FROM public.skm_response_rate'))[0].n === rrSemuaSebelum);

// --- (g2) Akses tabel dari klien ----------------------------------------------------------------------------------------------
console.log('(g) anon/authenticated tidak membaca atau menulis tabel jawaban dan undangan');
const tolak = (r) => r.ok === false && r.kode === '42501';
const nolBaris = (r) => (r.ok ? r.rows.length === 0 : r.kode === '42501');
// Sidik keadaan: bila percobaan tulis klien "tidak berdampak", sidik ini harus sama persis sesudahnya.
const sidik = async () => JSON.stringify((await pg(`SELECT
    (SELECT count(*)::int FROM public.spak_respons) AS spak,
    (SELECT count(*)::int FROM public.skm_respons) AS skm,
    (SELECT sum(p1_tanpa_diskriminasi)::int FROM public.spak_respons) AS jumlah_p1,
    (SELECT sum(u1_persyaratan)::int FROM public.skm_respons) AS jumlah_u1,
    (SELECT count(*)::int FROM public.survei_undangan) AS undangan,
    (SELECT count(*)::int FROM public.survei_undangan WHERE diisi_pada IS NOT NULL) AS terisi`))[0]);
const sidikAwal = await sidik();
const total = await hitungBaris();
cek('prasyarat bukti: tabel berisi jawaban dan undangan (bukan kosong)', total.spak > 3 && total.skm > 3);
cek('anon SELECT survei_undangan ditolak (42501)', tolak(await sebagai(db, 'anon', null, 'SELECT * FROM public.survei_undangan')));
cek('anon SELECT spak_respons ditolak (42501)', tolak(await sebagai(db, 'anon', null, 'SELECT * FROM public.spak_respons')));
cek('anon SELECT skm_respons: 0 baris (policy hanya admin/FO) walau tabel berisi', nolBaris(await sebagai(db, 'anon', null, 'SELECT * FROM public.skm_respons')));
cek('authenticated non-staf SELECT survei_undangan ditolak (42501)', tolak(await sebagai(db, 'authenticated', U_PENGUNJUNG, 'SELECT * FROM public.survei_undangan')));
cek('authenticated non-staf SELECT spak_respons: 0 baris', nolBaris(await sebagai(db, 'authenticated', U_PENGUNJUNG, 'SELECT * FROM public.spak_respons')));
cek('authenticated non-staf SELECT skm_respons: 0 baris', nolBaris(await sebagai(db, 'authenticated', U_PENGUNJUNG, 'SELECT * FROM public.skm_respons')));
cek('petugas layanan SELECT spak_respons: 0 baris (tidak membaca SPAK)', nolBaris(await sebagai(db, 'authenticated', U_PETUGAS_L1, 'SELECT * FROM public.spak_respons')));
cek('admin tetap membaca spak_respons dan skm_respons (jalur baca staf tidak rusak)', (await sebagai(db, 'authenticated', U_ADMIN, 'SELECT count(*)::int AS n FROM public.spak_respons')).rows[0].n === total.spak && (await sebagai(db, 'authenticated', U_ADMIN, 'SELECT count(*)::int AS n FROM public.skm_respons')).rows[0].n === total.skm);
const tulis = [
  ['INSERT survei_undangan', `INSERT INTO public.survei_undangan (kunjungan_id, token, unit, kedaluwarsa_pada) VALUES ('${id('ffff')}', '${TOKEN_ACAK}', 'fo', now())`, true],
  ['UPDATE survei_undangan (kosongkan diisi_pada)', 'UPDATE public.survei_undangan SET diisi_pada = NULL', true],
  ['DELETE survei_undangan', 'DELETE FROM public.survei_undangan', true],
  ['INSERT spak_respons', `INSERT INTO public.spak_respons (unit, sumber, p1_tanpa_diskriminasi, p2_tanpa_kecurangan, p3_tanpa_imbalan, p4_tanpa_pungli, p5_tanpa_percaloan) VALUES ('fo', 'wizard', 6, 6, 6, 6, 6)`, true],
  ['UPDATE spak_respons', 'UPDATE public.spak_respons SET p1_tanpa_diskriminasi = 1', true],
  ['DELETE spak_respons', 'DELETE FROM public.spak_respons', true],
  ['INSERT skm_respons', `INSERT INTO public.skm_respons (u1_persyaratan, sumber, versi, kunjungan_id) VALUES (4, 'wizard', 2, '${kFo.kunjungan}')`, true],
  // RLS tanpa policy UPDATE/DELETE membuat baris tak terlihat: pernyataan lolos tanpa galat tetapi tidak mengubah apa pun (dibuktikan sidik).
  ['UPDATE skm_respons', 'UPDATE public.skm_respons SET u1_persyaratan = 1', false],
  ['DELETE skm_respons', 'DELETE FROM public.skm_respons', false],
];
for (const [nama, sql, harusGalat] of tulis) {
  for (const [peran, uid] of [['anon', null], ['authenticated', U_PENGUNJUNG]]) {
    const r = await sebagai(db, peran, uid, sql);
    const diharapkan = harusGalat ? tolak(r) : tolak(r) || r.ok === true;
    cek(`${peran === 'anon' ? 'anon' : 'authenticated non-staf'} ${nama} ${harusGalat ? 'ditolak (42501)' : 'ditolak atau tanpa dampak'}`, diharapkan, JSON.stringify(r));
  }
}
cek('setelah semua percobaan tulis klien: jumlah baris, nilai, dan status undangan tidak berubah sedikit pun', (await sidik()) === sidikAwal, `${sidikAwal} -> ${await sidik()}`);
cek('authenticated (pengunjung login) memanggil kirim_survei dengan token tak dikenal -> not_found (EXECUTE authenticated sah)', (await kirim('authenticated', U_PENGUNJUNG, TOKEN_ACAK, SPAK_TEKS, SKM_TEKS)) === 'not_found');

// --- (h) Integrasi dengan ringkasan (Task 3) pada layanan khusus L3 ---------------------------------------------------------------
console.log('(h) integrasi: ringkasan IKM, SPAK, response rate dan hitung_ikm membaca jawaban wizard');
const kInt = await selesaikan({ layanan: L3 });
cek('L3: kiriman sah -> submitted', (await kirimAnon(kInt.token)) === 'submitted');
const rentang = ['2000-01-01', '2999-12-31'];
const ikmHarapan = (JUMLAH_SKM / 11) * 25;
const rIkm = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT ikm::text AS ikm, responden FROM public.ringkasan_ikm($1::date, $2::date) WHERE layanan_id = $3', [...rentang, L3]);
cek('ringkasan_ikm (admin): IKM L3 = jumlah 11 unsur / 11 x 25 dan responden 1', rIkm.ok && rIkm.rows.length === 1 && Math.abs(Number(rIkm.rows[0].ikm) - ikmHarapan) < 1e-6 && rIkm.rows[0].responden === 1, JSON.stringify(rIkm));
const hIkm = await sebagai(db, 'anon', null, 'SELECT ikm::text AS ikm, responden FROM public.hitung_ikm($1::uuid, $2::date, $3::date)', [L3, ...rentang]);
cek('hitung_ikm (publik/anon) membaca baris wizard 11 unsur: nilai sama', hIkm.ok && Math.abs(Number(hIkm.rows[0].ikm) - ikmHarapan) < 1e-6 && hIkm.rows[0].responden === 1, JSON.stringify(hIkm));
const rSpak = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT responden, p1::float AS p1, p2::float AS p2, p3::float AS p3, p4::float AS p4, p5::float AS p5 FROM public.ringkasan_spak($1::date, $2::date) WHERE layanan_id = $3', [...rentang, L3]);
cek('ringkasan_spak (admin): rata-rata p1..p5 = 6,5,4,3,2 dan responden 1', rSpak.ok && rSpak.rows.length === 1 && sama([rSpak.rows[0].p1, rSpak.rows[0].p2, rSpak.rows[0].p3, rSpak.rows[0].p4, rSpak.rows[0].p5], [6, 5, 4, 3, 2]) && rSpak.rows[0].responden === 1, JSON.stringify(rSpak));
const rRr = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT diundang, mengisi FROM public.ringkasan_response_rate($1::date, $2::date) WHERE layanan_id = $3', [...rentang, L3]);
cek('ringkasan_response_rate (admin): L3 diundang 1 dan mengisi 1 (diisi_pada dari kirim_survei)', rRr.ok && rRr.rows.length === 1 && rRr.rows[0].diundang === 1 && rRr.rows[0].mengisi === 1, JSON.stringify(rRr));
cek('response rate lama (tabel skm_response_rate) L3 mengisi = 1', (await mengisiRr(L3)) === 1);
const rFo = await sebagai(db, 'authenticated', U_FO, "SELECT diundang, mengisi FROM public.ringkasan_response_rate($1::date, $2::date) WHERE unit = 'fo'", rentang);
cek('ringkasan_response_rate baris Front Office memuat undangan FO yang sudah diisi', rFo.ok && rFo.rows.length === 1 && rFo.rows[0].mengisi >= 1, JSON.stringify(rFo));
cek('petugas tidak membaca SPAK lewat ringkasan_spak (kosong)', (await sebagai(db, 'authenticated', U_PETUGAS_L1, 'SELECT * FROM public.ringkasan_spak($1::date, $2::date)', rentang)).rows.length === 0);

// --- (i) Rollback ------------------------------------------------------------------------------------------------------------------
console.log('(i) rollback: penjaga, urutan, data tidak hilang, idempoten, dapat diterapkan ulang');
// Sarana uji dibuang dulu agar tidak mengganggu penjaga rollback.
await pg(`
  DROP TRIGGER trg_uji_jejak_spak ON public.spak_respons;
  DROP TRIGGER trg_uji_jejak_skm ON public.skm_respons;
  DROP TRIGGER trg_uji_gagal_skm ON public.skm_respons;
  DROP TRIGGER trg_uji_gagal_undangan ON public.survei_undangan;
  DROP FUNCTION public.uji_fn_jejak_spak();
  DROP FUNCTION public.uji_fn_jejak_skm();
  DROP FUNCTION public.uji_fn_gagal_skm();
  DROP FUNCTION public.uji_fn_gagal_undangan();
  DROP SEQUENCE public.uji_urut_spak;
  DROP SEQUENCE public.uji_urut_skm;
`);
const ada = async (sig) => (await pg(`SELECT pg_catalog.to_regprocedure('${sig}') IS NOT NULL AS ada`))[0].ada;
const adaTabel = async (nama) => (await pg(`SELECT pg_catalog.to_regclass('${nama}') IS NOT NULL AS ada`))[0].ada;
async function ditolak(berkas, pola) {
  try {
    await terapkanBerkas(db, berkas);
    return { ditolak: false, pesan: 'TIDAK ditolak' };
  } catch (galat) {
    return { ditolak: pola.test(String(galat.message)), pesan: String(galat.message) };
  }
}
const barisSebelumRb = await hitungBaris();

// Urutan seri: rollback 0002 dan 0001 menolak selama fungsi 0003 masih ada (badan fungsi menyebut objek yang akan dibuang).
const t2 = await ditolak(ROLLBACK_JAWABAN, /PRASYARAT ROLLBACK[\s\S]*kirim_survei/);
cek('rollback 0002 DITOLAK (PRASYARAT ROLLBACK) selama kirim_survei masih ada, dan menyebut kirim_survei', t2.ditolak, t2.pesan.slice(0, 300));
cek('... tidak ada yang berubah: spak_respons dan datanya masih ada', (await adaTabel('public.spak_respons')) && sama(await hitungBaris(), barisSebelumRb));
const t1 = await ditolak(ROLLBACK_UNDANGAN, /PRASYARAT ROLLBACK(?=[\s\S]*get_survei_context)(?=[\s\S]*kirim_survei)/);
cek('rollback 0001 DITOLAK (PRASYARAT ROLLBACK) selama get_survei_context/kirim_survei masih ada, dan menyebut keduanya', t1.ditolak, t1.pesan.slice(0, 300));
cek('... tidak ada yang berubah: survei_undangan masih ada', await adaTabel('public.survei_undangan'));

// Penjaga rollback 0003 sendiri: pemakai lain (fungsi buatan) menolak seluruh rollback.
await pg(`CREATE FUNCTION public.uji_pemakai_rpc() RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN public.kirim_survei('x', '{}'::jsonb, '{}'::jsonb); END $$`);
const tk = await ditolak(ROLLBACK, /PRASYARAT ROLLBACK[\s\S]*uji_pemakai_rpc/);
cek('rollback 0003 DITOLAK bila fungsi lain memakai kirim_survei (pesan menyebut fungsi itu)', tk.ditolak, tk.pesan.slice(0, 300));
cek('... tidak ada yang dihapus: kedua RPC masih ada dan masih berfungsi untuk anon', (await ada(SIG.kirim)) && (await ada(SIG.konteks)) && (await kirimAnon(TOKEN_ACAK)) === 'not_found');
await pg('DROP FUNCTION public.uji_pemakai_rpc()');
await pg(`CREATE FUNCTION public.uji_pemakai_konteks() RETURNS jsonb LANGUAGE sql AS $$ SELECT public.get_survei_context('x') $$`);
const tk2 = await ditolak(ROLLBACK, /PRASYARAT ROLLBACK[\s\S]*uji_pemakai_konteks/);
cek('rollback 0003 juga DITOLAK bila fungsi lain memakai get_survei_context', tk2.ditolak, tk2.pesan.slice(0, 300));
await pg('DROP FUNCTION public.uji_pemakai_konteks()');

await terapkanBerkas(db, ROLLBACK);
cek('rollback 0003 berhasil: kirim_survei dan get_survei_context hilang', !(await ada(SIG.kirim)) && !(await ada(SIG.konteks)));
const sesudahRb = await sebagai(db, 'anon', null, 'SELECT public.kirim_survei($1, $2::jsonb, $3::jsonb) AS h', [TOKEN_ACAK, SPAK_TEKS, SKM_TEKS]);
cek('anon memanggil kirim_survei sesudah rollback: ditolak karena fungsi tidak ada (42883)', sesudahRb.ok === false && sesudahRb.kode === '42883', JSON.stringify(sesudahRb));
cek('data tidak hilang: baris jawaban sama, undangan tetap, objek 0001 dan 0002 utuh', sama(await hitungBaris(), barisSebelumRb) && (await adaTabel('public.survei_undangan')) && (await adaTabel('public.spak_respons')) && (await ada('public.ambil_qr_survei(uuid)')));
await terapkanBerkas(db, ROLLBACK);
cek('rollback idempoten: dijalankan ulang tanpa galat dan keadaan tetap sama', !(await ada(SIG.kirim)) && !(await ada(SIG.konteks)) && sama(await hitungBaris(), barisSebelumRb));
await terapkanBerkas(db, MIGRASI);
cek('migrasi dapat diterapkan lagi sesudah rollback: kedua RPC kembali dan berfungsi (undangan lama tetap sudah_diisi)', (await ada(SIG.kirim)) && (await ada(SIG.konteks)) && (await kirimAnon(TOKEN_ACAK)) === 'not_found' && (await konteksAnon(kL1.token)).status === 'sudah_diisi');
await terapkanBerkas(db, MIGRASI);
const [hakUlang] = await pg(`SELECT has_function_privilege('anon', '${SIG.kirim}', 'EXECUTE') AS anon, has_function_privilege('uji_tanpa_hak', '${SIG.kirim}', 'EXECUTE') AS tanpa_hak`);
cek('penerapan ulang migrasi idempoten: tanpa galat, hak tetap (anon ya, role tanpa hak tidak)', hakUlang.anon === true && hakUlang.tanpa_hak === false);

// Seluruh seri dapat dibalik berurutan: 0003 -> 0002 -> 0001.
await terapkanBerkas(db, ROLLBACK);
await terapkanBerkas(db, ROLLBACK_JAWABAN);
cek('rollback 0002 berhasil sesudah rollback 0003 (spak_respons hilang)', !(await adaTabel('public.spak_respons')));
await terapkanBerkas(db, ROLLBACK_UNDANGAN);
cek('rollback 0001 berhasil sesudah rollback 0002 (survei_undangan hilang)', !(await adaTabel('public.survei_undangan')));

await db.close();
