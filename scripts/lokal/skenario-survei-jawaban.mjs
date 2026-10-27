// Skenario PGlite untuk migrasi 202611020002_survei_jawaban.sql (survei terpadu Fase A, Task 3).
// Membuktikan PERILAKU di atas stub skema (bukan pengganti dry-run/test:rls pemilik di DB nyata):
//   (a) baris lama 9 unsur tetap dihitung hitung_ikm persis seperti rumus lama; baris 11 unsur dan campuran dirata-ratakan per
//       baris; kolom u10/u11 kosong tidak merusak apa pun (Review Focus 5);
//   (b) constraint kolom baru (u10/u11 1-4, sumber/unit/versi, wizard wajib kunjungan_id dan versi 2);
//   (c) ringkasan_ikm memisahkan baris layanan, Front Office, dan "tidak terklasifikasi" (NULL tidak bercampur dengan FO);
//   (d) spak_respons: constraint 1-6, tidak terbaca anon/petugas, terbaca admin/FO, tanpa tulis dari klien;
//   (e) ringkasan_spak dan ringkasan_response_rate kosong untuk petugas; response rate per unit termasuk FO (dari survei_undangan);
//   (f) v_skm_petugas: kolom lama + u10/u11 di AKHIR, tanpa identitas; (g) penerapan ulang (idempoten); (h) rollback.
// Objek ASLI yang tidak ada di stub (hitung_ikm dari 202607140004, v_skm_petugas dari 202610090001) dimuat dulu dari berkas
// migrasi aslinya (diekstrak apa adanya, bukan disalin ke sini), lalu migrasi 202611020001 (survei_undangan, Task 2), lalu migrasi
// yang diuji. skm_response_rate dan triggernya sengaja TIDAK dimuat (migrasi ini tidak menyentuhnya; skm_rr_tambah mengabaikan
// layanan NULL).
// Jalankan: node scripts/lokal/skenario-survei-jawaban.mjs  (butuh `npm i --no-save @electric-sql/pglite`).
// Kode keluar 0 bila semua cek lolos, 1 bila ada yang gagal atau migrasi tidak bisa diterapkan.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bukaDb, sebagai, terapkanBerkas, cek } from './pglite-harness.mjs';

const dariRepo = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const MIGRASI_UNDANGAN = dariRepo('supabase/migrations/202611020001_survei_undangan.sql');
const MIGRASI = dariRepo('supabase/migrations/202611020002_survei_jawaban.sql');
const ROLLBACK = dariRepo('docs/rollback-survei-jawaban-202611020002.sql');
const ASAL_HITUNG_IKM = dariRepo('supabase/migrations/202607140004_security_and_automation.sql');
const ASAL_V_SKM_PETUGAS = dariRepo('supabase/migrations/202610090001_rbac_tahap1.sql');

const id = (hex) => `00000000-0000-4000-8000-${hex.padStart(12, '0')}`;
const U_ADMIN = id('a1');
const U_FO = id('a2');
const U_PETUGAS_L1 = id('a3');
const U_PETUGAS_L2 = id('a4');
const U_PENGUNJUNG = id('a6'); // terautentikasi tetapi bukan staf
const L1 = id('b1'); // 'Layanan Satu'
const L2 = id('b2'); // 'Layanan Dua' (urut nama: Dua sebelum Satu)
const L3 = id('b3'); // hanya untuk uji batas hari WIB
const L_HAPUS = id('b4'); // untuk uji layanan terhapus
const K = Object.fromEntries(
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'z', 'orph', 'uji', 'del1', 'del2'].map((n, i) => [n, id(`c${i.toString(16).padStart(2, '0')}`)]),
);

const DALAM = '2026-10-20T05:00:00Z'; // 12:00 WIB, jauh dari batas hari
const LUAR = '2026-09-15T05:00:00Z';
const BATAS_WIB = '2026-10-31T18:00:00Z'; // = 2026-11-01 01:00 WIB
const P = ['2026-10-01', '2026-10-31'];

const rata = (...n) => n.reduce((a, b) => a + b, 0) / n.length;
const hampir = (a, b, eps = 1e-6) => a !== null && a !== undefined && Math.abs(Number(a) - Number(b)) < eps;
const U9 = (n) => Array(9).fill(n);

const db = await bukaDb();
// PGlite mengambil zona waktu mesin tempat skenario dijalankan (mis. WIB), sedangkan sesi Supabase berzona UTC. Uji batas hari WIB
// harus tidak bergantung pada mesin: kunci zona sesi ke UTC (kalau tidak, konversi WIB yang hilang tidak terdeteksi di mesin ber-WIB).
await db.exec("SET TIME ZONE 'UTC'");
cek('prasyarat: zona waktu sesi = UTC (seperti Supabase), bukan zona mesin', (await sebagai(db, 'postgres', null, 'SHOW TimeZone')).rows[0].TimeZone === 'UTC');

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

// --- Muat objek ASLI yang tidak ada di stub, lalu migrasi 0001 (prasyarat 0002) ---------------------
console.log('memuat hitung_ikm dan v_skm_petugas ASLI, lalu migrasi 202611020001');
await pg(blok(ASAL_HITUNG_IKM, 'CREATE FUNCTION public.hitung_ikm(', 'GRANT EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) TO anon, authenticated;'));
await pg(blok(ASAL_V_SKM_PETUGAS, 'CREATE OR REPLACE VIEW public.v_skm_petugas AS', 'GRANT SELECT ON public.v_skm_petugas TO authenticated;'));
await terapkanBerkas(db, MIGRASI_UNDANGAN);

// --- Sidik jari objek yang DIUBAH migrasi (untuk membuktikan rollback memulihkan persis) ----------------
const normAcl = (acl) => (acl === null ? null : String(acl).replace(/^\{|\}$/g, '').split(',').sort().join(','));
async function sidikJari() {
  const fn = (await pg(`SELECT pg_catalog.pg_get_functiondef(p.oid) AS def, p.proacl::text AS acl, p.prosecdef AS definer, p.provolatile AS vol, p.proconfig::text AS cfg
                          FROM pg_catalog.pg_proc AS p WHERE p.oid = 'public.hitung_ikm(uuid,date,date)'::regprocedure`))[0];
  const vw = (await pg(`SELECT pg_catalog.pg_get_viewdef(c.oid, true) AS def, c.relacl::text AS acl, c.reloptions::text AS opsi
                          FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.v_skm_petugas'::regclass`))[0];
  const kolomView = (await pg(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'v_skm_petugas' ORDER BY ordinal_position`)).map((r) => r.column_name);
  const kolom = await pg(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'skm_respons' ORDER BY ordinal_position`);
  const constraint = await pg(`SELECT conname, pg_catalog.pg_get_constraintdef(oid) AS def FROM pg_catalog.pg_constraint WHERE conrelid = 'public.skm_respons'::regclass ORDER BY conname`);
  const komentar = await pg(`SELECT a.attname, pg_catalog.col_description(a.attrelid, a.attnum) AS komentar FROM pg_catalog.pg_attribute AS a
                              WHERE a.attrelid = 'public.skm_respons'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attname`);
  const policy = await pg(`SELECT policyname, cmd, roles::text AS roles, qual FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'skm_respons' ORDER BY policyname`);
  return JSON.stringify({ fn: { ...fn, acl: normAcl(fn.acl) }, vw: { ...vw, acl: normAcl(vw.acl) }, kolomView, kolom, constraint, komentar, policy });
}
const SIDIK_SEBELUM = await sidikJari();

// --- Seed pra-migrasi (HANYA kolom baseline; meniru baris lama produksi) --------------------------------
console.log('seed baris lama (9 unsur) sebelum migrasi');
await pg(`INSERT INTO public.layanan (id, nama) VALUES ('${L1}', 'Layanan Satu'), ('${L2}', 'Layanan Dua'), ('${L3}', 'Layanan Tiga'), ('${L_HAPUS}', 'Layanan Dihapus')`);
await pg(`INSERT INTO public.petugas (auth_user_id, role, aktif, layanan_id) VALUES
  ('${U_ADMIN}', 'admin', true, NULL),
  ('${U_FO}', 'front_office', true, NULL),
  ('${U_PETUGAS_L1}', 'petugas', true, '${L1}'),
  ('${U_PETUGAS_L2}', 'petugas', true, '${L2}')`);

/** Baris lama: hanya kolom baseline. nilai = 9 angka (null = kosong). */
async function sisipLama({ layanan, nilai, saran = null, dibuat = DALAM }) {
  await pg(
    `INSERT INTO public.skm_respons (layanan_id, u1_persyaratan, u2_prosedur, u3_waktu, u4_biaya, u5_produk, u6_kompetensi, u7_perilaku, u8_sarana, u9_pengaduan, saran, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)`,
    [layanan, ...nilai, saran, dibuat],
  );
}
await sisipLama({ layanan: L1, nilai: U9(4), saran: 'saran lama' }); // A1: rata 4
await sisipLama({ layanan: L1, nilai: [3, 3, 3, 3, 3, 3, 3, 3, 4] }); // A2: 28/9 (tidak habis dibagi: menjaga pembagian numerik)
await sisipLama({ layanan: L1, nilai: [2, 2, null, 2, 2, 2, 2, 2, 2] }); // A3: u3 kosong -> keluar dari rata-rata, tetap dihitung responden
await sisipLama({ layanan: L1, nilai: U9(1), dibuat: LUAR }); // di luar periode
await sisipLama({ layanan: L2, nilai: U9(2) }); // B1
await sisipLama({ layanan: null, nilai: U9(1) }); // N1: layanan kosong (data lama; tidak bisa dibedakan dari FO)
await sisipLama({ layanan: null, nilai: U9(4) }); // N2

const hitung = async (role, uid, layanan, mulai = P[0], akhir = P[1]) => {
  const r = await sebagai(db, role, uid, 'SELECT ikm::text AS ikm, responden FROM public.hitung_ikm($1::uuid, $2::date, $3::date)', [layanan, mulai, akhir]);
  return r.ok ? r.rows[0] : r;
};
const LAMA_L1 = await hitung('postgres', null, L1);
const LAMA_L2 = await hitung('postgres', null, L2);
cek('prasyarat: hitung_ikm ASLI menghitung L1 = rata(4, 28/9) x 25, responden 3 (A3 dihitung walau u3 kosong)', hampir(LAMA_L1?.ikm, rata(4, 28 / 9) * 25) && LAMA_L1?.responden === 3, JSON.stringify(LAMA_L1));
cek('prasyarat: hitung_ikm ASLI menghitung L2 = 50, responden 1', hampir(LAMA_L2?.ikm, 50) && LAMA_L2?.responden === 1, JSON.stringify(LAMA_L2));

// --- Terapkan migrasi (GAGAL bila berkas belum ada: fase RED) -----------------------------------------
console.log('menerapkan migrasi 202611020002');
await terapkanBerkas(db, MIGRASI);
const SIDIK_SESUDAH = await sidikJari();
cek('prasyarat bukti rollback: migrasi benar-benar mengubah sidik jari objek (bukan no-op)', SIDIK_SESUDAH !== SIDIK_SEBELUM);

// --- (a1) Data lama: kompatibilitas ---------------------------------------------------------------------
console.log('(a) data lama tetap valid dan dihitung sama');
const baruL1 = await hitung('postgres', null, L1);
const baruL2 = await hitung('postgres', null, L2);
cek('hitung_ikm L1 sesudah migrasi = nilai rumus lama (teks numerik identik) dan responden sama', baruL1.ikm === LAMA_L1.ikm && baruL1.responden === LAMA_L1.responden, `lama=${JSON.stringify(LAMA_L1)} baru=${JSON.stringify(baruL1)}`);
cek('hitung_ikm L2 sesudah migrasi = nilai rumus lama', baruL2.ikm === LAMA_L2.ikm && baruL2.responden === LAMA_L2.responden, `lama=${JSON.stringify(LAMA_L2)} baru=${JSON.stringify(baruL2)}`);
cek('pembagian numerik terjaga (28/9 tidak jatuh ke pembagian bilangan bulat)', hampir(baruL1.ikm, rata(4, 28 / 9) * 25) && !hampir(baruL1.ikm, rata(4, 3) * 25), JSON.stringify(baruL1));
const anonIkm = await hitung('anon', null, L1);
cek('hitung_ikm tetap bisa dipanggil anon (EXECUTE anon, authenticated tidak berubah)', anonIkm.ikm === LAMA_L1.ikm, JSON.stringify(anonIkm));
const authIkm = await hitung('authenticated', U_PENGUNJUNG, L1);
cek('hitung_ikm tetap bisa dipanggil authenticated non-staf', authIkm.ikm === LAMA_L1.ikm, JSON.stringify(authIkm));

const lama = await pg(`SELECT layanan_id, unit, versi, sumber, u10_transparansi, u11_integritas, jenis_kelamin, pendidikan FROM public.skm_respons`);
cek('baris lama ber-layanan_id ditandai unit layanan (5 baris)', lama.filter((r) => r.layanan_id !== null).length === 5 && lama.filter((r) => r.layanan_id !== null).every((r) => r.unit === 'layanan'), JSON.stringify(lama));
cek('baris lama tanpa layanan_id tetap tidak_diketahui (tidak bisa dibedakan dari FO)', lama.filter((r) => r.layanan_id === null).length === 2 && lama.filter((r) => r.layanan_id === null).every((r) => r.unit === 'tidak_diketahui'));
cek('semua baris lama: versi 1, sumber form_lama, u10/u11/jenis_kelamin/pendidikan kosong', lama.every((r) => r.versi === 1 && r.sumber === 'form_lama' && r.u10_transparansi === null && r.u11_integritas === null && r.jenis_kelamin === null && r.pendidikan === null));
const komentar = await pg(`SELECT a.attname, pg_catalog.col_description(a.attrelid, a.attnum) AS k FROM pg_catalog.pg_attribute AS a WHERE a.attrelid = 'public.skm_respons'::regclass AND a.attname IN ('visit_id', 'saran')`);
cek('visit_id dan saran berkomentar "tidak dipakai alur baru"', komentar.length === 2 && komentar.every((r) => /tidak dipakai alur baru/.test(r.k ?? '')), JSON.stringify(komentar));

// --- (b) Constraint kolom baru ----------------------------------------------------------------------------
console.log('(b) constraint kolom baru skm_respons');
// Kunjungan pembantu untuk uji constraint (tanpa undangan: status bukan selesai).
await pg(`INSERT INTO public.kunjungan (id, nama, asal, tanggal, status) VALUES ('${K.uji}', 'Tamu Uji', 'walk_in', current_date, 'menunggu')`);
async function coba(kolomTambahan, nilaiTambahan) {
  const kol = ['u1_persyaratan', 'u2_prosedur', 'u3_waktu', 'u4_biaya', 'u5_produk', 'u6_kompetensi', 'u7_perilaku', 'u8_sarana', 'u9_pengaduan', ...kolomTambahan];
  const nil = [...U9(3), ...nilaiTambahan];
  return sebagai(db, 'postgres', null, `INSERT INTO public.skm_respons (${kol.join(', ')}) VALUES (${nil.map((_, i) => `$${i + 1}`).join(', ')})`, nil);
}
const tolak = async (nama, kolom, nilai) => {
  const r = await coba(kolom, nilai);
  cek(nama, r.ok === false && r.kode === '23514', JSON.stringify(r));
};
await tolak('u10_transparansi = 0 ditolak (CHECK)', ['u10_transparansi'], [0]);
await tolak('u10_transparansi = 5 ditolak (CHECK)', ['u10_transparansi'], [5]);
await tolak('u11_integritas = 0 ditolak (CHECK)', ['u11_integritas'], [0]);
await tolak('u11_integritas = 5 ditolak (CHECK)', ['u11_integritas'], [5]);
await tolak('sumber di luar form_lama/wizard/impor ditolak', ['sumber'], ['manual']);
await tolak('unit di luar layanan/fo/tidak_diketahui ditolak', ['unit'], ['lainnya']);
await tolak('sumber wizard TANPA kunjungan_id ditolak (versi 2 sekalipun)', ['sumber', 'versi'], ['wizard', 2]);
await tolak('sumber wizard dengan kunjungan_id tetapi versi 1 ditolak', ['sumber', 'kunjungan_id'], ['wizard', K.uji]);
await tolak('sumber wizard dengan kunjungan_id tetapi versi 3 ditolak', ['sumber', 'kunjungan_id', 'versi'], ['wizard', K.uji, 3]);
const impor = await coba(['sumber', 'unit', 'u10_transparansi', 'u11_integritas', 'jenis_kelamin', 'pendidikan'], ['impor', 'tidak_diketahui', 1, 4, 'Laki-laki', 'S1']);
cek('sumber impor TANPA kunjungan_id diterima (batas 1 dan 4 untuk u10/u11; jenis_kelamin dan pendidikan teks bebas)', impor.ok === true, JSON.stringify(impor));
await pg(`DELETE FROM public.skm_respons WHERE sumber = 'impor'`);
const defaults = await pg(`SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'skm_respons' AND column_name IN ('versi', 'sumber', 'unit', 'u10_transparansi', 'u11_integritas', 'jenis_kelamin', 'pendidikan') ORDER BY column_name`);
const peta1 = Object.fromEntries(defaults.map((d) => [d.column_name, d]));
cek('default dan nullability: versi 1 NOT NULL, sumber form_lama NOT NULL, unit tidak_diketahui NOT NULL; u10/u11/jenis_kelamin/pendidikan boleh kosong',
  /^1/.test(peta1.versi.column_default) && peta1.versi.is_nullable === 'NO' && /form_lama/.test(peta1.sumber.column_default) && peta1.sumber.is_nullable === 'NO' && /tidak_diketahui/.test(peta1.unit.column_default) && peta1.unit.is_nullable === 'NO'
    && ['u10_transparansi', 'u11_integritas', 'jenis_kelamin', 'pendidikan'].every((k) => peta1[k].is_nullable === 'YES'), JSON.stringify(defaults));

// --- Kunjungan selesai + undangan untuk uji ringkasan -----------------------------------------------------
console.log('seed kunjungan selesai (undangan dibuat trigger Task 2) dan jawaban baru');
async function selesai(kid, layanan, dibuat, diisi) {
  await pg(`INSERT INTO public.kunjungan (id, nama, asal, tanggal, status) VALUES ($1, $2, 'walk_in', current_date, 'dilayani')`, [kid, `Tamu ${kid.slice(-3)}`]);
  if (layanan) await pg(`INSERT INTO public.tiket_antrean (kunjungan_id, layanan_id, status, waktu_selesai) VALUES ($1, $2, 'selesai', now())`, [kid, layanan]);
  await pg(`UPDATE public.kunjungan SET status = 'selesai' WHERE id = $1`, [kid]);
  await pg(`UPDATE public.survei_undangan SET dibuat_pada = $2::timestamptz, diisi_pada = $3::timestamptz WHERE kunjungan_id = $1`, [kid, dibuat, diisi]);
}
const sejam = (iso) => new Date(new Date(iso).getTime() + 3600 * 1000).toISOString();
await selesai(K[1], L1, DALAM, sejam(DALAM));
await selesai(K[2], L1, DALAM, sejam(DALAM));
await selesai(K[3], L2, DALAM, sejam(DALAM));
await selesai(K[4], null, DALAM, sejam(DALAM)); // FO
await selesai(K[5], null, DALAM, sejam(DALAM)); // FO
await selesai(K[6], L1, DALAM, null); // belum diisi
await selesai(K[7], null, DALAM, null); // FO belum diisi
await selesai(K[8], L2, DALAM, null);
await selesai(K[9], L1, LUAR, null); // di luar periode
await selesai(K.z, L3, BATAS_WIB, null); // tepat di sekitar batas hari WIB
await selesai(K.orph, L_HAPUS, DALAM, null); // layanannya nanti dihapus
const unitUndangan = Object.fromEntries((await pg('SELECT kunjungan_id, unit FROM public.survei_undangan')).map((r) => [r.kunjungan_id, r.unit]));
cek('prasyarat: undangan unit fo untuk K4/K5/K7, layanan untuk K1/K2/K3', unitUndangan[K[4]] === 'fo' && unitUndangan[K[5]] === 'fo' && unitUndangan[K[7]] === 'fo' && unitUndangan[K[1]] === 'layanan' && unitUndangan[K[3]] === 'layanan', JSON.stringify(unitUndangan));

/** Baris jawaban baru (alur wizard atau impor). u = 9 angka; u10/u11 boleh null. */
async function sisipBaru({ layanan = null, kunjungan = null, u, u10 = null, u11 = null, unit, sumber = 'wizard', versi = 2, dibuat = DALAM, saran = null }) {
  await pg(
    `INSERT INTO public.skm_respons (layanan_id, kunjungan_id, u1_persyaratan, u2_prosedur, u3_waktu, u4_biaya, u5_produk, u6_kompetensi, u7_perilaku, u8_sarana, u9_pengaduan,
                                     u10_transparansi, u11_integritas, versi, sumber, unit, saran, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::timestamptz)`,
    [layanan, kunjungan, ...u, u10, u11, versi, sumber, unit, saran, dibuat],
  );
}
await sisipBaru({ layanan: L1, kunjungan: K[1], u: U9(4), u10: 3, u11: 3, unit: 'layanan' }); // W1: 42/11
await sisipBaru({ layanan: L1, kunjungan: K[2], u: U9(3), u10: 4, u11: null, unit: 'layanan' }); // W2: 31/10 (u11 kosong -> penyebut 10)
await sisipBaru({ layanan: L2, kunjungan: K[3], u: U9(2), u10: 2, u11: 2, unit: 'layanan' }); // W3: 2
await sisipBaru({ layanan: null, kunjungan: K[4], u: U9(4), u10: 4, u11: 4, unit: 'fo' }); // W4: 4 (FO)
await sisipBaru({ layanan: null, kunjungan: K[5], u: U9(3), u10: 2, u11: 2, unit: 'fo' }); // W5: 31/11 (FO)
await sisipBaru({ layanan: L3, kunjungan: K.z, u: U9(3), u10: 3, u11: 3, unit: 'layanan', dibuat: BATAS_WIB }); // Z: 3 (batas WIB)
// Baris gaya form lama yang masih bisa ditulis sesudah migrasi (mis. submit_skm_response lama): hanya kolom lama, jadi unit
// jatuh ke default 'tidak_diketahui' walau layanan_id terisi. ringkasan_ikm harus tetap menghitungnya sebagai baris layanan.
await sisipLama({ layanan: L2, nilai: U9(3) }); // B2: 3
// Impor: layanan kosong, unit tidak diketahui, u10/u11 kosong.
await sisipBaru({ layanan: null, u: U9(3), unit: 'tidak_diketahui', sumber: 'impor', versi: 1 }); // I1: 3

const IKM_L1 = rata(4, 28 / 9, 42 / 11, 31 / 10) * 25;
const IKM_L2 = rata(2, 2, 3) * 25;
const IKM_FO = rata(4, 31 / 11) * 25;
const IKM_TD = rata(1, 4, 3) * 25;

// --- (a2) hitung_ikm dengan baris 11 unsur dan campuran ---------------------------------------------------------
console.log('(a) hitung_ikm: baris 11 unsur dan campuran dirata-ratakan per baris');
const hL1 = await hitung('postgres', null, L1);
cek('L1 campuran (9 unsur, 11 unsur, 10 unsur): rata per baris x 25; baris dengan u3 kosong keluar dari rata-rata; responden 5', hampir(hL1.ikm, IKM_L1) && hL1.responden === 5, `harapan ${IKM_L1}, dapat ${JSON.stringify(hL1)}`);
const hL1sempit = await hitung('postgres', null, L1, '2026-10-20', '2026-10-20');
cek('periode memakai created_at (hanya tanggal 20 Oktober): hasil sama (baris luar periode tidak ikut)', hampir(hL1sempit.ikm, IKM_L1) && hL1sempit.responden === 5, JSON.stringify(hL1sempit));
const hanyaW1 = await sebagai(db, 'postgres', null,
  `SELECT pg_catalog.avg((u1_persyaratan + u2_prosedur + u3_waktu + u4_biaya + u5_produk + u6_kompetensi + u7_perilaku + u8_sarana + u9_pengaduan + u10_transparansi + u11_integritas) / 11.0) * 25 AS x
     FROM public.skm_respons WHERE kunjungan_id = $1`, [K[1]]);
cek('pembanding independen untuk baris 11 unsur murni: (4x9 + 3 + 3) / 11 x 25 (dasar IKM_L1)', hanyaW1.ok && hampir(hanyaW1.rows[0].x, 42 / 11 * 25), JSON.stringify(hanyaW1));
const hL2 = await hitung('postgres', null, L2);
cek('L2: baris 9 unsur lama, 11 unsur, dan baris gaya lama pasca migrasi dirata-ratakan', hampir(hL2.ikm, IKM_L2) && hL2.responden === 3, `harapan ${IKM_L2}, dapat ${JSON.stringify(hL2)}`);
const hNull = await sebagai(db, 'postgres', null, 'SELECT count(*)::int AS n FROM public.hitung_ikm(NULL::uuid, $1::date, $2::date)', P);
cek('hitung_ikm(NULL) tidak error dan tidak mengembalikan baris (jawaban FO/tidak terklasifikasi tidak merusaknya)', hNull.ok && hNull.rows[0].n === 0, JSON.stringify(hNull));

// --- (c) ringkasan_ikm --------------------------------------------------------------------------------------------
console.log('(c) ringkasan_ikm: layanan, Front Office, dan tidak terklasifikasi terpisah');
async function ringkas(fn, role, uid, mulai = P[0], akhir = P[1]) {
  const r = await sebagai(db, role, uid, `SELECT * FROM public.${fn}($1::date, $2::date)`, [mulai, akhir]);
  return r.ok ? r.rows : r;
}
const kunci = (r) => `${r.unit}:${r.layanan_id ?? ''}`;
const peta = (rows) => Object.fromEntries(rows.map((r) => [kunci(r), r]));
const rIkm = await ringkas('ringkasan_ikm', 'authenticated', U_ADMIN);
cek('admin: kolom persis (layanan_id, unit, nama, ikm, responden)', Array.isArray(rIkm) && rIkm.length > 0 && Object.keys(rIkm[0]).join(',') === 'layanan_id,unit,nama,ikm,responden', JSON.stringify(rIkm));
cek('admin: urutan = layanan (menurut nama: Dua, Satu), lalu Front Office, lalu tidak terklasifikasi; tepat 4 baris', Array.isArray(rIkm) && rIkm.map((r) => r.unit).join(',') === 'layanan,layanan,fo,tidak_diketahui' && rIkm[0].nama === 'Layanan Dua' && rIkm[1].nama === 'Layanan Satu', JSON.stringify(rIkm));
const mIkm = Array.isArray(rIkm) ? peta(rIkm) : {};
cek('baris L1: unit layanan, nama layanan, ikm campuran, responden 5', hampir(mIkm[`layanan:${L1}`]?.ikm, IKM_L1) && mIkm[`layanan:${L1}`]?.responden === 5 && mIkm[`layanan:${L1}`]?.nama === 'Layanan Satu', JSON.stringify(mIkm[`layanan:${L1}`]));
cek('baris L2 menghitung baris gaya lama pasca migrasi (unit default tidak_diketahui, layanan terisi) sebagai baris layanan, responden 3', hampir(mIkm[`layanan:${L2}`]?.ikm, IKM_L2) && mIkm[`layanan:${L2}`]?.responden === 3, JSON.stringify(mIkm[`layanan:${L2}`]));
cek('baris Front Office: layanan_id NULL, nama "Front Office", hanya jawaban unit fo (u10/u11 terisi), responden 2', mIkm['fo:']?.layanan_id === null && mIkm['fo:']?.nama === 'Front Office' && hampir(mIkm['fo:']?.ikm, IKM_FO) && mIkm['fo:']?.responden === 2, JSON.stringify(mIkm['fo:']));
cek('baris tidak terklasifikasi: NULL-layanan lama (u10/u11 kosong) + impor, TERPISAH dari FO, nama baku, responden 3', mIkm['tidak_diketahui:']?.layanan_id === null && mIkm['tidak_diketahui:']?.nama === 'Tidak terklasifikasi (data lama/impor)' && hampir(mIkm['tidak_diketahui:']?.ikm, IKM_TD) && mIkm['tidak_diketahui:']?.responden === 3, JSON.stringify(mIkm['tidak_diketahui:']));
cek('NULL lama TIDAK tercampur ke FO (ikm FO bukan campuran FO+NULL) dan sebaliknya', !hampir(mIkm['fo:']?.ikm, rata(4, 31 / 11, 1, 4, 3) * 25) && !hampir(mIkm['tidak_diketahui:']?.ikm, rata(1, 4, 3, 4, 31 / 11) * 25));
cek('ikm per layanan = hitung_ikm untuk layanan yang sama (konsistensi dua jalur)', hampir(mIkm[`layanan:${L1}`]?.ikm, hL1.ikm) && hampir(mIkm[`layanan:${L2}`]?.ikm, hL2.ikm));
cek('responden total = jumlah baris dalam periode (5 + 3 + 2 + 3)', Array.isArray(rIkm) && rIkm.reduce((a, r) => a + r.responden, 0) === 13, JSON.stringify(rIkm));
const rIkmFo = await ringkas('ringkasan_ikm', 'authenticated', U_FO);
cek('front_office: hasil sama dengan admin', JSON.stringify(rIkmFo) === JSON.stringify(rIkm), JSON.stringify(rIkmFo));
const rIkmPetugas = await ringkas('ringkasan_ikm', 'authenticated', U_PETUGAS_L1);
cek('petugas: boleh (agregat tanpa identitas; sama seperti hitung_ikm publik), hasil sama dengan admin', JSON.stringify(rIkmPetugas) === JSON.stringify(rIkm), JSON.stringify(rIkmPetugas));
const rIkmTamu = await ringkas('ringkasan_ikm', 'authenticated', U_PENGUNJUNG);
cek('authenticated non-staf: hasil kosong (bukan galat)', Array.isArray(rIkmTamu) && rIkmTamu.length === 0, JSON.stringify(rIkmTamu));
const rIkmAnon = await ringkas('ringkasan_ikm', 'anon', null);
cek('anon: EXECUTE ditolak (42501)', rIkmAnon.ok === false && rIkmAnon.kode === '42501', JSON.stringify(rIkmAnon));
const rIkmKosong = await ringkas('ringkasan_ikm', 'authenticated', U_ADMIN, '2025-01-01', '2025-01-31');
cek('periode tanpa jawaban: kosong', Array.isArray(rIkmKosong) && rIkmKosong.length === 0, JSON.stringify(rIkmKosong));
const rSatuHari = await ringkas('ringkasan_ikm', 'authenticated', U_ADMIN, '2026-10-20', '2026-10-20');
cek('periode satu hari (20 Oktober, WIB): baris periode yang sama, baris 15 September tidak ikut', Array.isArray(rSatuHari) && rSatuHari.reduce((a, r) => a + r.responden, 0) === 13, JSON.stringify(rSatuHari));
// Batas hari WIB: 2026-10-31 18:00 UTC = 2026-11-01 01:00 WIB -> tanggal 1 November.
const rNov = await ringkas('ringkasan_ikm', 'authenticated', U_ADMIN, '2026-11-01', '2026-11-01');
cek('batas hari WIB: 31 Okt 18:00 UTC (= 1 Nov 01:00 WIB) masuk periode 1 November', Array.isArray(rNov) && rNov.length === 1 && rNov[0].layanan_id === L3 && rNov[0].responden === 1 && hampir(rNov[0].ikm, 75), JSON.stringify(rNov));
const rOkt31 = await ringkas('ringkasan_ikm', 'authenticated', U_ADMIN, '2026-10-31', '2026-10-31');
cek('batas hari WIB: baris yang sama TIDAK masuk periode 31 Oktober', Array.isArray(rOkt31) && rOkt31.length === 0, JSON.stringify(rOkt31));
const rL3saja = await ringkas('ringkasan_ikm', 'authenticated', U_ADMIN, '2026-11-01', '2026-11-30');
cek('kelompok tanpa jawaban tidak dimunculkan (tidak ada baris FO/tidak terklasifikasi kosong)', Array.isArray(rL3saja) && rL3saja.length === 1 && rL3saja[0].unit === 'layanan', JSON.stringify(rL3saja));

// --- (d) spak_respons -------------------------------------------------------------------------------------------------
console.log('(d) spak_respons: constraint, akses, dan tanpa tulis dari klien');
const tabelSpak = (await pg(`SELECT c.relrowsecurity AS rls,
    (SELECT count(*)::int FROM pg_catalog.pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'spak_respons') AS n_policy,
    (SELECT string_agg(p.policyname || ':' || p.cmd || ':' || p.roles::text, '|') FROM pg_catalog.pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'spak_respons') AS policy
  FROM pg_catalog.pg_class c WHERE c.oid = 'public.spak_respons'::regclass`))[0];
cek('RLS aktif dan tepat satu policy: SELECT untuk authenticated (tanpa policy tulis)', tabelSpak.rls === true && tabelSpak.n_policy === 1 && /spak_select_staff:SELECT:\{authenticated\}/.test(tabelSpak.policy), JSON.stringify(tabelSpak));
async function spak({ kunjungan = null, layanan = null, unit, sumber = 'wizard', p = [3, 3, 3, 3, 3], dibuat = DALAM }) {
  return sebagai(db, 'postgres', null,
    `INSERT INTO public.spak_respons (kunjungan_id, layanan_id, unit, sumber, p1_tanpa_diskriminasi, p2_tanpa_kecurangan, p3_tanpa_imbalan, p4_tanpa_pungli, p5_tanpa_percaloan, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)`,
    [kunjungan, layanan, unit, sumber, ...p, dibuat]);
}
const tolakSpak = async (nama, argumen, kode = '23514') => {
  const r = await spak(argumen);
  cek(nama, r.ok === false && r.kode === kode, JSON.stringify(r));
};
for (const [n, nilai] of [['p1', [0, 3, 3, 3, 3]], ['p2', [3, 7, 3, 3, 3]], ['p3', [3, 3, 0, 3, 3]], ['p4', [3, 3, 3, 7, 3]], ['p5', [3, 3, 3, 3, 7]]]) {
  await tolakSpak(`${n} di luar 1-6 ditolak (CHECK)`, { unit: 'fo', p: nilai });
}
await tolakSpak('p1 kosong ditolak (NOT NULL, 23502)', { unit: 'fo', p: [null, 3, 3, 3, 3] }, '23502');
await tolakSpak('unit di luar layanan/fo/tidak_diketahui ditolak', { unit: 'lainnya' });
await tolakSpak('sumber form_lama ditolak untuk spak_respons (hanya wizard/impor)', { unit: 'fo', sumber: 'form_lama' });
const batasOk = await spak({ unit: 'fo', p: [1, 6, 1, 6, 1], sumber: 'impor' });
cek('nilai batas 1 dan 6 diterima (6 = Sangat Setuju); impor boleh tanpa kunjungan_id', batasOk.ok === true, JSON.stringify(batasOk));
await pg(`DELETE FROM public.spak_respons`);

await spak({ kunjungan: K[1], layanan: L1, unit: 'layanan', p: [6, 6, 5, 5, 4] });
await spak({ kunjungan: K[2], layanan: L1, unit: 'layanan', p: [4, 4, 4, 4, 4] });
await spak({ kunjungan: K[3], layanan: L2, unit: 'layanan', p: [2, 3, 2, 3, 2] });
await spak({ kunjungan: K[4], unit: 'fo', p: [6, 6, 6, 6, 6] });
await spak({ unit: 'tidak_diketahui', sumber: 'impor', p: [1, 1, 1, 1, 1] });
await spak({ unit: 'tidak_diketahui', sumber: 'impor', p: [3, 3, 3, 3, 3] });
await spak({ kunjungan: K.z, layanan: L3, unit: 'layanan', p: [5, 5, 5, 5, 5], dibuat: BATAS_WIB });
const dupKunjungan = await spak({ kunjungan: K[1], layanan: L1, unit: 'layanan' });
cek('satu SPAK per kunjungan (kunjungan_id unik, 23505)', dupKunjungan.ok === false && dupKunjungan.kode === '23505', JSON.stringify(dupKunjungan));
cek('beberapa baris impor dengan kunjungan_id NULL diizinkan (dua baris impor tadi tersimpan)', (await pg(`SELECT count(*)::int AS n FROM public.spak_respons WHERE kunjungan_id IS NULL`))[0].n === 2);

const bacaSpak = async (role, uid) => sebagai(db, role, uid, 'SELECT id FROM public.spak_respons');
const sAnon = await bacaSpak('anon', null);
cek('anon: SELECT spak_respons ditolak (42501; hak dicabut)', sAnon.ok === false && sAnon.kode === '42501', JSON.stringify(sAnon));
const sP1 = await bacaSpak('authenticated', U_PETUGAS_L1);
cek('petugas layanan: 0 baris dari spak_respons walau ada jawaban SPAK di layanannya (policy admin/front_office saja)', sP1.ok === true && sP1.rows.length === 0, JSON.stringify(sP1));
const sTamu = await bacaSpak('authenticated', U_PENGUNJUNG);
cek('authenticated non-staf: 0 baris', sTamu.ok === true && sTamu.rows.length === 0, JSON.stringify(sTamu));
const sFo = await bacaSpak('authenticated', U_FO);
cek('front_office: membaca semua 7 baris', sFo.ok === true && sFo.rows.length === 7, JSON.stringify(sFo));
const sAdmin = await bacaSpak('authenticated', U_ADMIN);
cek('admin: membaca semua 7 baris', sAdmin.ok === true && sAdmin.rows.length === 7, JSON.stringify(sAdmin));
const SQL_INS_SPAK = `INSERT INTO public.spak_respons (unit, sumber, p1_tanpa_diskriminasi, p2_tanpa_kecurangan, p3_tanpa_imbalan, p4_tanpa_pungli, p5_tanpa_percaloan) VALUES ('fo', 'impor', 3, 3, 3, 3, 3)`;
const insAdmin = await sebagai(db, 'authenticated', U_ADMIN, SQL_INS_SPAK);
cek('admin: INSERT langsung ditolak (42501; tanpa hak tulis dari klien)', insAdmin.ok === false && insAdmin.kode === '42501', JSON.stringify(insAdmin));
const updAdmin = await sebagai(db, 'authenticated', U_ADMIN, 'UPDATE public.spak_respons SET p1_tanpa_diskriminasi = 1');
cek('admin: UPDATE langsung ditolak (42501)', updAdmin.ok === false && updAdmin.kode === '42501', JSON.stringify(updAdmin));
const delAdmin = await sebagai(db, 'authenticated', U_ADMIN, 'DELETE FROM public.spak_respons');
cek('admin: DELETE langsung ditolak (42501)', delAdmin.ok === false && delAdmin.kode === '42501', JSON.stringify(delAdmin));
const insAnon = await sebagai(db, 'anon', null, SQL_INS_SPAK);
cek('anon: INSERT langsung ditolak (42501)', insAnon.ok === false && insAnon.kode === '42501', JSON.stringify(insAnon));
const insSkmAdmin = await sebagai(db, 'authenticated', U_ADMIN, `INSERT INTO public.skm_respons (u1_persyaratan) VALUES (3)`);
cek('skm_respons: admin tetap tidak bisa INSERT langsung (RLS tanpa policy tulis; tidak berubah)', insSkmAdmin.ok === false && insSkmAdmin.kode === '42501', JSON.stringify(insSkmAdmin));

// --- (e) ringkasan_spak ---------------------------------------------------------------------------------------------
console.log('(e) ringkasan_spak');
const rSpak = await ringkas('ringkasan_spak', 'authenticated', U_ADMIN);
cek('admin: kolom persis (layanan_id, unit, nama, responden, p1..p5)', Array.isArray(rSpak) && rSpak.length > 0 && Object.keys(rSpak[0]).join(',') === 'layanan_id,unit,nama,responden,p1,p2,p3,p4,p5', JSON.stringify(rSpak));
const mSpak = Array.isArray(rSpak) ? peta(rSpak) : {};
cek('urutan layanan, fo, tidak terklasifikasi; 4 baris dalam periode Oktober (baris batas WIB tidak ikut)', Array.isArray(rSpak) && rSpak.map((r) => r.unit).join(',') === 'layanan,layanan,fo,tidak_diketahui', JSON.stringify(rSpak));
const p = (r) => [r?.p1, r?.p2, r?.p3, r?.p4, r?.p5].map(Number);
cek('L1: responden 2, rata p1..p5 = 5, 5, 4.5, 4.5, 4', mSpak[`layanan:${L1}`]?.responden === 2 && p(mSpak[`layanan:${L1}`]).every((x, i) => hampir(x, [5, 5, 4.5, 4.5, 4][i])), JSON.stringify(mSpak[`layanan:${L1}`]));
cek('L2: responden 1, rata 2, 3, 2, 3, 2', mSpak[`layanan:${L2}`]?.responden === 1 && p(mSpak[`layanan:${L2}`]).every((x, i) => hampir(x, [2, 3, 2, 3, 2][i])), JSON.stringify(mSpak[`layanan:${L2}`]));
cek('Front Office: nama "Front Office", layanan_id NULL, responden 1, semua 6', mSpak['fo:']?.nama === 'Front Office' && mSpak['fo:']?.layanan_id === null && mSpak['fo:']?.responden === 1 && p(mSpak['fo:']).every((x) => hampir(x, 6)), JSON.stringify(mSpak['fo:']));
cek('tidak terklasifikasi (dua impor): responden 2, rata 2', mSpak['tidak_diketahui:']?.nama === 'Tidak terklasifikasi (data lama/impor)' && mSpak['tidak_diketahui:']?.responden === 2 && p(mSpak['tidak_diketahui:']).every((x) => hampir(x, 2)), JSON.stringify(mSpak['tidak_diketahui:']));
const rSpakFo = await ringkas('ringkasan_spak', 'authenticated', U_FO);
cek('front_office: hasil sama dengan admin', JSON.stringify(rSpakFo) === JSON.stringify(rSpak));
const rSpakP = await ringkas('ringkasan_spak', 'authenticated', U_PETUGAS_L1);
cek('petugas: KOSONG (tidak membaca SPAK; Review Focus 5)', Array.isArray(rSpakP) && rSpakP.length === 0, JSON.stringify(rSpakP));
const rSpakTamu = await ringkas('ringkasan_spak', 'authenticated', U_PENGUNJUNG);
cek('authenticated non-staf: kosong', Array.isArray(rSpakTamu) && rSpakTamu.length === 0, JSON.stringify(rSpakTamu));
const rSpakAnon = await ringkas('ringkasan_spak', 'anon', null);
cek('anon: EXECUTE ditolak (42501)', rSpakAnon.ok === false && rSpakAnon.kode === '42501', JSON.stringify(rSpakAnon));
const rSpakNov = await ringkas('ringkasan_spak', 'authenticated', U_ADMIN, '2026-11-01', '2026-11-01');
const rSpakOkt31 = await ringkas('ringkasan_spak', 'authenticated', U_ADMIN, '2026-10-31', '2026-10-31');
cek('batas hari WIB: baris 31 Okt 18:00 UTC masuk 1 November, tidak masuk 31 Oktober', Array.isArray(rSpakNov) && rSpakNov.length === 1 && rSpakNov[0].layanan_id === L3 && Array.isArray(rSpakOkt31) && rSpakOkt31.length === 0, JSON.stringify([rSpakNov, rSpakOkt31]));

// --- (e) ringkasan_response_rate ---------------------------------------------------------------------------------------
console.log('(e) ringkasan_response_rate (dari survei_undangan)');
// Layanan terhapus: undangan tetap ada, layanan_id jadi NULL (unit layanan) -> tidak boleh hilang dari penjumlahan.
await pg(`DELETE FROM public.tiket_antrean WHERE layanan_id = '${L_HAPUS}'`);
await pg(`DELETE FROM public.layanan WHERE id = '${L_HAPUS}'`);
const rRr = await ringkas('ringkasan_response_rate', 'authenticated', U_ADMIN);
cek('admin: kolom persis (layanan_id, unit, nama, diundang, mengisi)', Array.isArray(rRr) && rRr.length > 0 && Object.keys(rRr[0]).join(',') === 'layanan_id,unit,nama,diundang,mengisi', JSON.stringify(rRr));
const mRr = Array.isArray(rRr) ? peta(rRr) : {};
cek('L1: diundang 3 (K1, K2, K6; K9 di luar periode), mengisi 2', mRr[`layanan:${L1}`]?.diundang === 3 && mRr[`layanan:${L1}`]?.mengisi === 2 && mRr[`layanan:${L1}`]?.nama === 'Layanan Satu', JSON.stringify(mRr[`layanan:${L1}`]));
cek('L2: diundang 2 (K3, K8), mengisi 1', mRr[`layanan:${L2}`]?.diundang === 2 && mRr[`layanan:${L2}`]?.mengisi === 1, JSON.stringify(mRr[`layanan:${L2}`]));
cek('FO: SATU baris unit fo, diundang 3 (K4, K5, K7), mengisi 2, nama "Front Office"', Array.isArray(rRr) && rRr.filter((r) => r.unit === 'fo').length === 1 && mRr['fo:']?.diundang === 3 && mRr['fo:']?.mengisi === 2 && mRr['fo:']?.nama === 'Front Office' && mRr['fo:']?.layanan_id === null, JSON.stringify(mRr['fo:']));
cek('layanan terhapus: undangan tidak hilang, masuk baris tidak terklasifikasi (diundang 1, mengisi 0)', mRr['tidak_diketahui:']?.diundang === 1 && mRr['tidak_diketahui:']?.mengisi === 0 && mRr['tidak_diketahui:']?.nama === 'Tidak terklasifikasi (data lama/impor)', JSON.stringify(mRr['tidak_diketahui:']));
cek('jumlah diundang = 9 undangan dalam periode dan mengisi = 5 (tidak ada yang hilang atau ganda)', Array.isArray(rRr) && rRr.reduce((a, r) => a + r.diundang, 0) === 9 && rRr.reduce((a, r) => a + r.mengisi, 0) === 5, JSON.stringify(rRr));
cek('urutan: layanan, fo, tidak terklasifikasi', Array.isArray(rRr) && rRr.map((r) => r.unit).join(',') === 'layanan,layanan,fo,tidak_diketahui', JSON.stringify(rRr));
const rRrFo = await ringkas('ringkasan_response_rate', 'authenticated', U_FO);
cek('front_office: hasil sama dengan admin', JSON.stringify(rRrFo) === JSON.stringify(rRr));
const rRrP = await ringkas('ringkasan_response_rate', 'authenticated', U_PETUGAS_L1);
cek('petugas: KOSONG', Array.isArray(rRrP) && rRrP.length === 0, JSON.stringify(rRrP));
const rRrTamu = await ringkas('ringkasan_response_rate', 'authenticated', U_PENGUNJUNG);
cek('authenticated non-staf: kosong', Array.isArray(rRrTamu) && rRrTamu.length === 0, JSON.stringify(rRrTamu));
const rRrAnon = await ringkas('ringkasan_response_rate', 'anon', null);
cek('anon: EXECUTE ditolak (42501)', rRrAnon.ok === false && rRrAnon.kode === '42501', JSON.stringify(rRrAnon));
const rRrNov = await ringkas('ringkasan_response_rate', 'authenticated', U_ADMIN, '2026-11-01', '2026-11-01');
const rRrOkt31 = await ringkas('ringkasan_response_rate', 'authenticated', U_ADMIN, '2026-10-31', '2026-10-31');
cek('batas hari WIB: undangan dibuat 31 Okt 18:00 UTC dihitung pada 1 November (diundang 1), bukan 31 Oktober', Array.isArray(rRrNov) && rRrNov.length === 1 && rRrNov[0].layanan_id === L3 && rRrNov[0].diundang === 1 && rRrNov[0].mengisi === 0 && Array.isArray(rRrOkt31) && rRrOkt31.length === 0, JSON.stringify([rRrNov, rRrOkt31]));
const rRrLuar = await ringkas('ringkasan_response_rate', 'authenticated', U_ADMIN, '2026-09-01', '2026-09-30');
cek('periode September: hanya undangan K9 (L1) yang dibuat 15 September', Array.isArray(rRrLuar) && rRrLuar.length === 1 && rRrLuar[0].layanan_id === L1 && rRrLuar[0].diundang === 1, JSON.stringify(rRrLuar));

// --- (f) v_skm_petugas --------------------------------------------------------------------------------------------------
console.log('(f) v_skm_petugas: kolom lama + u10/u11 di akhir, tanpa identitas');
const kolomView = (await pg(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'v_skm_petugas' ORDER BY ordinal_position`)).map((r) => r.column_name);
cek('kolom view = kolom lama berurutan, lalu u10_transparansi dan u11_integritas', kolomView.join(',') === 'layanan_id,u1_persyaratan,u2_prosedur,u3_waktu,u4_biaya,u5_produk,u6_kompetensi,u7_perilaku,u8_sarana,u9_pengaduan,saran,created_at,u10_transparansi,u11_integritas', kolomView.join(','));
cek('view TIDAK memuat id, visit_id, kunjungan_id, unit, sumber, versi, jenis_kelamin, pendidikan', !kolomView.some((k) => ['id', 'visit_id', 'kunjungan_id', 'unit', 'sumber', 'versi', 'jenis_kelamin', 'pendidikan'].includes(k)), kolomView.join(','));
const vP1 = await sebagai(db, 'authenticated', U_PETUGAS_L1, 'SELECT layanan_id, u10_transparansi, u11_integritas, saran FROM public.v_skm_petugas');
const nL1 = Number((await pg(`SELECT count(*)::int AS n FROM public.skm_respons WHERE layanan_id = '${L1}'`))[0].n);
cek(`petugas L1: hanya baris layanannya (${nL1} baris, semua layanan L1)`, vP1.ok && vP1.rows.length === nL1 && vP1.rows.every((r) => r.layanan_id === L1), JSON.stringify(vP1));
cek('petugas L1 melihat u10/u11 baris 11 unsur (3,3) dan campuran (4, NULL), serta saran lama', vP1.ok && vP1.rows.some((r) => r.u10_transparansi === 3 && r.u11_integritas === 3) && vP1.rows.some((r) => r.u10_transparansi === 4 && r.u11_integritas === null) && vP1.rows.some((r) => r.saran === 'saran lama'), JSON.stringify(vP1));
const vP2 = await sebagai(db, 'authenticated', U_PETUGAS_L2, 'SELECT layanan_id FROM public.v_skm_petugas');
cek('petugas L2 tidak melihat baris L1 (batas layanan tetap)', vP2.ok && vP2.rows.length > 0 && vP2.rows.every((r) => r.layanan_id === L2), JSON.stringify(vP2));
const vFo = await sebagai(db, 'authenticated', U_FO, 'SELECT layanan_id FROM public.v_skm_petugas');
const vAdmin = await sebagai(db, 'authenticated', U_ADMIN, 'SELECT layanan_id FROM public.v_skm_petugas');
cek('front_office dan admin: view kosong (tetap membaca lewat tabel, seperti sebelumnya)', vFo.ok && vFo.rows.length === 0 && vAdmin.ok && vAdmin.rows.length === 0);
const vAnon = await sebagai(db, 'anon', null, 'SELECT layanan_id FROM public.v_skm_petugas');
cek('anon: SELECT view ditolak (42501)', vAnon.ok === false && vAnon.kode === '42501', JSON.stringify(vAnon));
const vTamu = await sebagai(db, 'authenticated', U_PENGUNJUNG, 'SELECT layanan_id FROM public.v_skm_petugas');
cek('authenticated non-staf: 0 baris', vTamu.ok && vTamu.rows.length === 0, JSON.stringify(vTamu));
const skmFo = await sebagai(db, 'authenticated', U_FO, 'SELECT id FROM public.skm_respons');
const skmPetugas = await sebagai(db, 'authenticated', U_PETUGAS_L1, 'SELECT id FROM public.skm_respons');
const skmAnon = await sebagai(db, 'anon', null, 'SELECT id FROM public.skm_respons');
const nSkm = Number((await pg('SELECT count(*)::int AS n FROM public.skm_respons'))[0].n);
cek('skm_respons: FO membaca semua baris; petugas dan anon 0 baris (policy tidak berubah)', skmFo.ok && skmFo.rows.length === nSkm && skmPetugas.ok && skmPetugas.rows.length === 0 && skmAnon.ok && skmAnon.rows.length === 0, `${nSkm} ${JSON.stringify([skmFo.rows?.length, skmPetugas.rows?.length, skmAnon.rows?.length])}`);

// --- FK ON DELETE SET NULL dan constraint wizard ---------------------------------------------------------------------------
console.log('FK kunjungan (ON DELETE SET NULL) berinteraksi dengan constraint wizard');
await pg(`INSERT INTO public.kunjungan (id, nama, asal, tanggal, status) VALUES ('${K.del1}', 'Tamu Hapus 1', 'walk_in', current_date, 'menunggu'), ('${K.del2}', 'Tamu Hapus 2', 'walk_in', current_date, 'menunggu')`);
await pg(`INSERT INTO public.skm_respons (kunjungan_id, u1_persyaratan) VALUES ('${K.del1}', 3)`); // gaya lama (sumber form_lama)
await sisipBaru({ kunjungan: K.del2, u: U9(3), u10: 3, u11: 3, unit: 'fo' }); // wizard
await spak({ kunjungan: K.del2, unit: 'fo' }); // spak wizard (tanpa constraint wizard di spak_respons)
const hapus1 = await sebagai(db, 'postgres', null, `DELETE FROM public.kunjungan WHERE id = '${K.del1}'`);
const sisa1 = await pg(`SELECT kunjungan_id FROM public.skm_respons WHERE u1_persyaratan = 3 AND u2_prosedur IS NULL`);
cek('hapus kunjungan dengan jawaban form_lama: berhasil, kunjungan_id jadi NULL (perilaku lama tetap)', hapus1.ok && sisa1.length === 1 && sisa1[0].kunjungan_id === null, JSON.stringify([hapus1, sisa1]));
const hapus2 = await sebagai(db, 'postgres', null, `DELETE FROM public.kunjungan WHERE id = '${K.del2}'`);
cek('hapus kunjungan dengan jawaban wizard: DITOLAK (23514; SET NULL melanggar constraint wizard; arsip jawaban terlindungi)', hapus2.ok === false && hapus2.kode === '23514', JSON.stringify(hapus2));
cek('kunjungan wizard tetap ada dan jawabannya utuh sesudah penolakan', (await pg(`SELECT count(*)::int AS n FROM public.kunjungan WHERE id = '${K.del2}'`))[0].n === 1 && (await pg(`SELECT count(*)::int AS n FROM public.skm_respons WHERE kunjungan_id = '${K.del2}'`))[0].n === 1);
await pg(`DELETE FROM public.skm_respons WHERE kunjungan_id = '${K.del2}'`);
await pg(`DELETE FROM public.kunjungan WHERE id = '${K.del2}'`);
const spakYatim = await pg(`SELECT count(*)::int AS n FROM public.spak_respons WHERE unit = 'fo' AND kunjungan_id IS NULL AND sumber = 'wizard'`);
cek('spak_respons: hapus kunjungan menjadikan kunjungan_id NULL (ON DELETE SET NULL, tanpa constraint wizard)', spakYatim[0].n === 1, JSON.stringify(spakYatim));
await pg(`DELETE FROM public.spak_respons WHERE kunjungan_id IS NULL AND sumber = 'wizard'`);

// --- (g) Idempoten --------------------------------------------------------------------------------------------------------------
console.log('(g) penerapan ulang migrasi (idempoten)');
// Impor yang SENGAJA unit tidak_diketahui walau layanan_id terisi: penerapan ulang tidak boleh memaksanya jadi layanan.
await sisipBaru({ layanan: L1, u: U9(2), unit: 'tidak_diketahui', sumber: 'impor', versi: 1 });
const fotoSkm = async () => JSON.stringify(await pg('SELECT * FROM public.skm_respons ORDER BY id'));
const fotoSpak = async () => JSON.stringify(await pg('SELECT * FROM public.spak_respons ORDER BY id'));
// Satu-satunya baris yang BOLEH berubah: baris gaya form lama yang ditulis sesudah migrasi (B2: sumber form_lama, layanan terisi,
// unit masih default tidak_diketahui). UPDATE migrasi menandainya unit layanan, sama seperti baris lama lain.
const kandidat = await pg(`SELECT id FROM public.skm_respons WHERE sumber = 'form_lama' AND layanan_id IS NOT NULL AND unit = 'tidak_diketahui'`);
cek('prasyarat: tepat satu baris form_lama ber-layanan_id yang unit-nya masih default (B2, ditulis sesudah migrasi)', kandidat.length === 1, JSON.stringify(kandidat));
const f1 = await fotoSkm();
const f1Diharapkan = JSON.stringify(JSON.parse(f1).map((r) => (r.id === kandidat[0]?.id ? { ...r, unit: 'layanan' } : r)));
const f2 = await fotoSpak();
let galatUlang = '';
try {
  await terapkanBerkas(db, MIGRASI);
} catch (e) {
  galatUlang = String(e.message);
}
cek('migrasi bisa diterapkan dua kali tanpa galat', galatUlang === '', galatUlang);
cek('penerapan ulang hanya menandai B2 sebagai unit layanan; baris lain TIDAK berubah (termasuk impor tidak_diketahui ber-layanan_id, wizard, FO) dan spak_respons utuh', (await fotoSkm()) === f1Diharapkan && (await fotoSpak()) === f2);
// Kembalikan B2 ke unit default agar keadaan sesudah bagian ini sama dengan sebelum penerapan ulang.
await pg(`UPDATE public.skm_respons SET unit = 'tidak_diketahui' WHERE id = '${kandidat[0].id}'`);

cek('tetap tepat satu policy di spak_respons dan sidik jari objek sama dengan sebelum penerapan ulang', (await pg(`SELECT count(*)::int AS n FROM pg_catalog.pg_policies WHERE schemaname = 'public' AND tablename = 'spak_respons'`))[0].n === 1 && (await sidikJari()) === SIDIK_SESUDAH);
const hSetelahUlang = await hitung('postgres', null, L1);
cek('hitung_ikm berfungsi sesudah penerapan ulang (L1 kini 6 responden: baris impor tambahan ikut)', hSetelahUlang.responden === 6, JSON.stringify(hSetelahUlang));
await pg(`DELETE FROM public.skm_respons WHERE sumber = 'impor' AND layanan_id IS NOT NULL`);

// --- (h) Rollback ------------------------------------------------------------------------------------------------------------------
console.log('(h) rollback (docs/rollback-survei-jawaban-202611020002.sql)');
async function jalankanRollback() {
  try {
    await terapkanBerkas(db, ROLLBACK);
    return '';
  } catch (e) {
    return String(e.message);
  }
}
const adaBaru = async () => (await pg(
  `SELECT pg_catalog.to_regclass('public.spak_respons') IS NOT NULL AS spak,
          pg_catalog.to_regprocedure('public.ringkasan_ikm(date,date)') IS NOT NULL AS ikm,
          pg_catalog.to_regprocedure('public.ringkasan_spak(date,date)') IS NOT NULL AS spak_fn,
          pg_catalog.to_regprocedure('public.ringkasan_response_rate(date,date)') IS NOT NULL AS rr,
          EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'skm_respons' AND column_name = 'u10_transparansi') AS kolom_baru`,
))[0];
const semuaBaru = (k) => k.spak && k.ikm && k.spak_fn && k.rr && k.kolom_baru;

// Penjaga: fungsi lain yang memakai objek baru (mis. kirim_survei di Task 4) membuat rollback ditolak, tanpa menghapus apa pun.
const fotoSebelumTolak = await fotoSkm();
const fotoSpakSebelumTolak = await fotoSpak();
await pg(`CREATE FUNCTION public.pemakai_spak_uji() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.spak_respons $$`);
const tolakSpak1 = await jalankanRollback();
cek('penjaga: rollback DITOLAK (PRASYARAT ROLLBACK) bila fungsi lain menyebut spak_respons, nama fungsi disebut', /PRASYARAT ROLLBACK/.test(tolakSpak1) && /pemakai_spak_uji/.test(tolakSpak1), tolakSpak1.slice(0, 300));
cek('penjaga: tidak ada yang terhapus/diubah (sidik jari sama dengan sesudah migrasi, objek baru ada, data utuh)', (await sidikJari()) === SIDIK_SESUDAH && semuaBaru(await adaBaru()) && (await fotoSkm()) === fotoSebelumTolak && (await fotoSpak()) === fotoSpakSebelumTolak);
await pg('DROP FUNCTION public.pemakai_spak_uji()');
await pg(`CREATE FUNCTION public.pemakai_kolom_uji() RETURNS bigint LANGUAGE sql AS $$ SELECT count(u10_transparansi) FROM public.skm_respons $$`);
const tolakKolom = await jalankanRollback();
cek('penjaga: juga menolak bila fungsi lain menyebut kolom u10_transparansi', /PRASYARAT ROLLBACK/.test(tolakKolom) && /pemakai_kolom_uji/.test(tolakKolom), tolakKolom.slice(0, 300));
await pg('DROP FUNCTION public.pemakai_kolom_uji()');
await pg(`CREATE FUNCTION public.pemakai_ringkasan_uji() RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM public.ringkasan_response_rate(current_date, current_date) $$`);
const tolakRingkasan = await jalankanRollback();
cek('penjaga: juga menolak bila fungsi lain memanggil ringkasan_response_rate', /PRASYARAT ROLLBACK/.test(tolakRingkasan) && /pemakai_ringkasan_uji/.test(tolakRingkasan), tolakRingkasan.slice(0, 300));
cek('penjaga: tetap tidak ada yang berubah sesudah tiga penolakan', (await sidikJari()) === SIDIK_SESUDAH && semuaBaru(await adaBaru()) && (await fotoSkm()) === fotoSebelumTolak);
await pg('DROP FUNCTION public.pemakai_ringkasan_uji()');

const jumlahBarisSebelum = Number((await pg('SELECT count(*)::int AS n FROM public.skm_respons'))[0].n);
const galatRollback = await jalankanRollback();
cek('rollback BERHASIL setelah pemakai lain dihapus (fungsi milik sendiri, termasuk hitung_ikm yang dipulihkan, tidak dihitung penjaga)', galatRollback === '', galatRollback.slice(0, 300));
const sisaBaru = await adaBaru();
cek('rollback menghapus spak_respons, tiga fungsi ringkasan, dan kolom baru', sisaBaru.spak === false && sisaBaru.ikm === false && sisaBaru.spak_fn === false && sisaBaru.rr === false && sisaBaru.kolom_baru === false, JSON.stringify(sisaBaru));
const sisaKolom = (await pg(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'skm_respons' AND column_name IN ('u10_transparansi', 'u11_integritas', 'versi', 'sumber', 'unit', 'jenis_kelamin', 'pendidikan')`)).length;
cek('ketujuh kolom baru hilang dan tidak ada constraint wizard tersisa', sisaKolom === 0 && (await pg(`SELECT count(*)::int AS n FROM pg_catalog.pg_constraint WHERE conrelid = 'public.skm_respons'::regclass AND conname LIKE '%wizard%'`))[0].n === 0);
const SIDIK_PULIH = await sidikJari();
cek('hitung_ikm, v_skm_petugas (definisi, kolom, hak), kolom/constraint/komentar skm_respons, dan policy PERSIS sama dengan sebelum migrasi', SIDIK_PULIH === SIDIK_SEBELUM, SIDIK_PULIH === SIDIK_SEBELUM ? '' : 'sidik jari berbeda');
cek('baris data tidak hilang oleh rollback (hanya kolom baru yang dibuang)', Number((await pg('SELECT count(*)::int AS n FROM public.skm_respons'))[0].n) === jumlahBarisSebelum);
const hPulih = await hitung('postgres', null, L1);
const pembanding = await pg(`SELECT pg_catalog.avg((u1_persyaratan + u2_prosedur + u3_waktu + u4_biaya + u5_produk + u6_kompetensi + u7_perilaku + u8_sarana + u9_pengaduan) / 9.0) * 25 AS x
                               FROM public.skm_respons WHERE layanan_id = '${L1}' AND created_at::date BETWEEN '${P[0]}' AND '${P[1]}'`);
cek('hitung_ikm pasca rollback = rumus lama 9 unsur (pembanding inline)', hampir(hPulih.ikm, pembanding[0].x), JSON.stringify([hPulih, pembanding]));
const vPulih = await sebagai(db, 'authenticated', U_PETUGAS_L1, 'SELECT * FROM public.v_skm_petugas LIMIT 1');
cek('v_skm_petugas pasca rollback: tanpa u10/u11, petugas masih membacanya', vPulih.ok && vPulih.rows.length === 1 && !('u10_transparansi' in vPulih.rows[0]) && 'saran' in vPulih.rows[0], JSON.stringify(vPulih));
const anonPulih = await hitung('anon', null, L1);
cek('hitung_ikm pasca rollback tetap dapat dipanggil anon (hak lama)', anonPulih.ikm === hPulih.ikm, JSON.stringify(anonPulih));
let galatRollbackUlang = '';
try {
  await terapkanBerkas(db, ROLLBACK);
} catch (e) {
  galatRollbackUlang = String(e.message);
}
cek('rollback idempoten (dua kali tanpa galat; sidik jari tetap sama dengan sebelum migrasi)', galatRollbackUlang === '' && (await sidikJari()) === SIDIK_SEBELUM, galatRollbackUlang);

await terapkanBerkas(db, MIGRASI);
const kosongSpak = (await pg('SELECT count(*)::int AS n FROM public.spak_respons'))[0].n;
const barisBaruLagi = await pg(`SELECT count(*) FILTER (WHERE sumber = 'form_lama' AND versi = 1)::int AS lama, count(*)::int AS semua FROM public.skm_respons`);
cek('migrasi dapat diterapkan lagi sesudah rollback; spak_respons kosong; baris yang ada kembali sebagai form_lama versi 1', kosongSpak === 0 && barisBaruLagi[0].lama === barisBaruLagi[0].semua, JSON.stringify(barisBaruLagi));

await db.close();
