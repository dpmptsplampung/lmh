// Tahap B (B-DB1) alur Front Office -> eskalasi (migrasi 202610140003/4/5): tes PERILAKU (SET LOCAL ROLE +
// request.jwt.claims, SATU transaksi yang SELALU di-ROLLBACK). Tidak pernah COMMIT. Data uji sintetis (ZZ-TES-*).
// BELUM PERNAH DIJALANKAN oleh penulisnya: jalankan hanya setelah diperiksa dan atas konfirmasi CEO (menyentuh DB
// produksi lewat DIRECT_URL di .env.local, walau semuanya di-rollback). Lakukan di luar jam layanan: migrasi yang
// diterapkan di dalam transaksi mengunci tabel layanan/kunjungan/tiket_antrean (ALTER TABLE) sampai ROLLBACK.
//
// Pakai (DB yang belum memuat 202610140003..05; A1/A3 harus sudah ada, atau ikut --pre):
//   node scripts/test-fo-eskalasi.mjs \
//     [--pre supabase/migrations/202610140001_sesi_staf.sql --pre supabase/migrations/202610140002_tiket_kepemilikan.sql] \
//     --apply supabase/migrations/202610140003_fo_model_data.sql \
//     --apply supabase/migrations/202610140004_fo_rpc.sql \
//     --apply supabase/migrations/202610140005_fo_selaras_antrean.sql [--akhir-hari]
//   --pre   = diterapkan dulu di dalam transaksi (tanpa uji rollback).
//   --apply = migrasi yang diuji + uji rollback docs/rollback-*-<versi>.sql (urutan terbalik, snapshot katalog).
//   --akhir-hari = juga menjalankan tandai_tidak_terlayani_akhir_hari() dan tandai_reservasi_no_show() (mengunci SEMUA
//                  tiket menunggu hari ini dan reservasi terjadwal lewat tanggal selama transaksi).
//   tanpa --apply: menguji state DB saat ini (migrasi harus sudah diterapkan; seksi rollback dilewati).
//
// TIDAK tercakup: konkurensi SEJATI (dua koneksi serentak). Satu transaksi yang di-rollback tidak terlihat koneksi lain;
// yang diuji hanya urutan berurutan (pemanggil kedua melihat hasil pertama: SUDAH_DIAMBIL / INVALID_STATUS).
// Harness diturunkan dari scripts/test-tiket-kepemilikan.mjs.
import pg from 'pg';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mengandungKontrolTransaksi } from './lib/sql-txn.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
if (!env.DIRECT_URL) { console.error('DIRECT_URL tidak ada di .env.local'); process.exit(2); }

const argv = process.argv.slice(2);
const applyFiles = [];
const preFiles = [];
let ujiAkhirHari = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--apply') applyFiles.push(argv[++i]);
  else if (argv[i] === '--pre') preFiles.push(argv[++i]);
  else if (argv[i] === '--akhir-hari') ujiAkhirHari = true;
}

const berkasDocs = readdirSync(join(root, 'docs'));
const rollbackFiles = applyFiles
  .map((f) => {
    const m = basename(f).match(/^(\d{12})_/);
    const cocok = m ? berkasDocs.find((d) => d.startsWith('rollback-') && d.endsWith(`-${m[1]}.sql`)) : null;
    return cocok ? `docs/${cocok}` : null;
  })
  .filter((f) => f && existsSync(join(root, f)))
  .reverse();
for (const f of [...preFiles, ...applyFiles, ...rollbackFiles]) {
  if (mengandungKontrolTransaksi(readFileSync(join(root, f), 'utf8'))) {
    console.error(`DITOLAK: ${f} memuat BEGIN/COMMIT/END/ROLLBACK/SAVEPOINT/RELEASE tingkat atas.`);
    process.exit(2);
  }
}

const mkClient = () => new pg.Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
const c = mkClient();
let lulus = 0;
const gagal = [];
function cek(nama, kondisi, detail = '') {
  if (kondisi) lulus++; else gagal.push(`${nama}${detail ? ' :: ' + detail : ''}`);
  console.log(`${kondisi ? 'LOLOS' : 'GAGAL'}  ${nama}${!kondisi && detail ? ' :: ' + detail : ''}`);
}
const info = (t) => console.log(`INFO   ${t}`);

// ---------- eksekusi sebagai pelaku ----------
let spN = 0;
const POSTGRES = { dbRole: null, claims: null };
const ANON = { dbRole: 'anon', claims: { role: 'anon' } };
const asUser = (uid, extra = {}) => ({ dbRole: 'authenticated', claims: { sub: uid, role: 'authenticated', ...extra } });

async function setActor(a) {
  await c.query('RESET ROLE');
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [a.claims ? JSON.stringify(a.claims) : '']);
  if (a.dbRole) await c.query(`SET LOCAL ROLE ${a.dbRole}`);
}
async function run(a, sql, params = []) {
  const name = `r${++spN}`;
  await c.query(`SAVEPOINT ${name}`);
  try {
    await setActor(a);
    const r = await c.query(sql, params);
    await c.query('RESET ROLE');
    await c.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, rows: r.rows, n: r.rowCount };
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await c.query('RESET ROLE');
    return { ok: false, code: e.code, msg: e.message, detail: e.detail };
  }
}
async function sp(fn) {
  const name = `s${++spN}`;
  await c.query(`SAVEPOINT ${name}`);
  try { return await fn(); } finally {
    await c.query('RESET ROLE');
    await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }
}
const pgq = (sql, params) => run(POSTGRES, sql, params);
const satu = async (sql, params) => (await pgq(sql, params)).rows?.[0];

const ditolak = (r, re) => !r.ok && r.code === '42501' && (!re || re.test(r.msg));
const galat = (r, code, re) => !r.ok && r.code === code && (!re || re.test(r.msg));
const kode = (r, re) => !r.ok && re.test(r.msg);
const nol = (r) => r.ok && r.n === 0;
const sebut = (r) => (r.ok ? `ok n=${r.n} ${JSON.stringify(r.rows?.[0] ?? null)}` : `${r.code} ${r.msg}`);
const hasil = (r) => r.rows?.[0]?.r;

// ---------- RPC ----------
const rpc = (a, nama, args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return run(a, `SELECT public.${nama}(${ph}) AS r`, args);
};
const mulaiKunjungan = (a, o = {}) => rpc(a, 'fo_mulai_kunjungan', [
  o.nama ?? 'ZZ Walkin', o.instansi ?? 'ZZ Instansi', o.hp ?? null, o.kategori ?? null, o.email ?? null,
  o.keperluan ?? 'uji', o.saran ?? null, o.pengunjung ?? null, o.crid ?? null]);
const foSelesai = (a, pid, topik, catatan) => rpc(a, 'fo_selesai', [pid, topik, catatan]);
const foEskalasi = (a, pid, layanan, topik, catatan) => rpc(a, 'fo_eskalasi', [pid, layanan, topik, catatan]);
const foAmbil = (a, pid) => rpc(a, 'fo_ambil_dari_kotak_masuk', [pid]);
const mulai = (a, t) => rpc(a, 'layanan_mulai', [t]);
const selesai = (a, t, topik = null, catatan = null) =>
  run(a, `SELECT public.layanan_selesai($1, NULL, NULL, $2, $3) AS r`, [t, topik, catatan]);
const kembalikan = (a, t, catatan, topik = null) => rpc(a, 'layanan_kembalikan', [t, catatan, topik]);
const alihkan = (a, t, layanan, alasan) => rpc(a, 'admin_alihkan', [t, layanan, alasan]);
const ambilAlih = (a, t, alasan) => rpc(a, 'admin_ambil_alih', [t, alasan]);

// ---------- fixture ----------
const F = {};
async function buatFixture() {
  const ids = {};
  for (const k of ['visitor', 'visitor2', 'admin', 'fo', 'fo2', 'petA', 'petA2', 'petB', 'petC']) ids[k] = randomUUID();
  F.uid = ids;
  for (const [k, uid] of Object.entries(ids)) {
    const r = await pgq(
      `INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES ($1,'authenticated','authenticated',$2,false)`,
      [uid, `zz-tes-${k}@example.invalid`]);
    if (!r.ok) throw new Error(`fixture auth.users ${k}: ${r.msg}`);
  }
  for (const [kunci, nama, jadwal] of [['A', 'ZZ-TES-A', true], ['B', 'ZZ-TES-B', true], ['C', 'ZZ-TES-C', false]]) {
    const r = await pgq(`INSERT INTO public.layanan (nama, is_ptsp) VALUES ($1, false) RETURNING id`, [nama]);
    if (!r.ok) throw new Error(`fixture layanan ${nama}: ${r.msg}`);
    F[kunci] = r.rows[0].id;
    if (jadwal) for (let h = 1; h <= 7; h++) await pgq(`INSERT INTO public.jadwal_standby (layanan_id, hari, aktif) VALUES ($1,$2,true)`, [F[kunci], h]);
  }
  const pet = async (k, role, layanan) => {
    const r = await pgq(`INSERT INTO public.petugas (auth_user_id, nama, layanan_id, role, aktif) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids[k], `ZZ ${k}`, layanan, role]);
    if (!r.ok) throw new Error(`fixture petugas ${k}: ${r.msg}`);
    F[k] = r.rows[0].id;
  };
  await pet('admin', 'admin', null);
  await pet('fo', 'front_office', null);
  await pet('fo2', 'front_office', null);
  await pet('petA', 'petugas', F.A);
  await pet('petA2', 'petugas', F.A);
  await pet('petB', 'petugas', F.B);
  await pet('petC', 'petugas', F.C);
  for (const k of ['visitor', 'visitor2']) {
    const r = await pgq(`INSERT INTO public.pengunjung (auth_user_id, nama, no_hp, asal_instansi, kategori, email)
      VALUES ($1,$2,'081234567890','ZZ Instansi','Umum',$3) RETURNING id`, [ids[k], `ZZ ${k}`, `zz-${k}@example.invalid`]);
    if (!r.ok) throw new Error(`fixture pengunjung: ${r.msg}`);
    F[`p_${k}`] = r.rows[0].id;
  }
  F.act = Object.fromEntries(Object.entries(ids).map(([k, u]) => [k, asUser(u)]));
  F.hariIni = (await satu(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS d`)).d;
  await pgq(`SELECT set_config('lmh.izinkan_jam_tutup','on',true)`);
  await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);
}

// Fixture alur lama (dibuat SEBELUM migrasi): reservasi visit 'terjadwal' hari ini + tiket walk-in lama.
async function siapkanLama() {
  const r = await pgq(`INSERT INTO public.visit (asal, pengunjung_id, nama, tujuan, tanggal_rencana, keperluan, status, layanan_id)
    VALUES ('reservasi',$1,'ZZ Resv Lama','loket',$2::date,'uji lama','terjadwal',$3) RETURNING id, qr_token`,
    [F.p_visitor, F.hariIni, F.A]);
  if (!r.ok) throw new Error(`siapkanLama reservasi: ${r.msg}`);
  F.resvLama = r.rows[0];
  const w = await pgq(`INSERT INTO public.visit (asal, nama, keperluan, layanan_id, tujuan, status, waktu_masuk, client_request_id)
    VALUES ('walk_in','ZZ Walkin Lama','x',$1,'loket','menunggu',now(),$2) RETURNING id`, [F.A, randomUUID()]);
  if (!w.ok) throw new Error(`siapkanLama walk-in: ${w.msg}`);
  F.tiketLama = (await satu(`SELECT id FROM public.tiket_antrean WHERE legacy_visit_id=$1`, [w.rows[0].id]))?.id;
}

async function siapkanTopik() {
  F.topikFo = (await satu(`SELECT id FROM public.topik_penanganan WHERE layanan_id IS NULL AND aktif ORDER BY urut LIMIT 1`))?.id;
  for (const k of ['A', 'B']) {
    const r = await pgq(`INSERT INTO public.topik_penanganan (layanan_id, nama, urut) VALUES ($1,'ZZ topik',1) RETURNING id`, [F[k]]);
    F[`topik${k}`] = r.rows?.[0]?.id;
  }
}

// FO walk-in -> eskalasi ke layanan; kembalikan {kunjungan, pfo, tiket, plyn}.
async function eskalasiBaru(layanan = F.A, a = F.act.fo) {
  const m = hasil(await mulaiKunjungan(a));
  const e = await foEskalasi(a, m.penanganan_id, layanan, F.topikFo, 'perlu petugas');
  if (!e.ok) throw new Error(`eskalasiBaru: ${sebut(e)}`);
  return { kunjungan: m.kunjungan_id, pfo: m.penanganan_id, tiket: hasil(e).tiket_id, plyn: hasil(e).penanganan_layanan_id, r: hasil(e) };
}
const tahap = (id) => satu(`SELECT * FROM public.penanganan WHERE id=$1`, [id]);
const kunj = (id) => satu(`SELECT * FROM public.kunjungan WHERE id=$1`, [id]);
const tiket = (id) => satu(`SELECT * FROM public.tiket_antrean WHERE id=$1`, [id]);

// ---------- snapshot untuk uji rollback (sama dengan test-tiket-kepemilikan) ----------
async function snapshot() {
  const m = new Map();
  const f = await pgq(`SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS k,
      md5(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS def,
      coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p.proacl::text[]) x), 'null') AS acl
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'`);
  for (const r of f.rows) m.set(`fn:${r.k}`, `${r.def} ${r.acl}`);
  const po = await pgq(`SELECT tablename||'.'||policyname AS k, cmd||' '||roles::text||' '||md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) AS v FROM pg_policies WHERE schemaname='public'`);
  for (const r of po.rows) m.set(`policy:${r.k}`, r.v);
  const tg = await pgq(`SELECT c.relname||'.'||t.tgname AS k, md5(pg_get_triggerdef(t.oid)) AS v FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`);
  for (const r of tg.rows) m.set(`trigger:${r.k}`, r.v);
  const col = await pgq(`SELECT table_name||'.'||column_name AS k, data_type||' '||is_nullable AS v FROM information_schema.columns WHERE table_schema='public'`);
  for (const r of col.rows) m.set(`col:${r.k}`, r.v);
  const con = await pgq(`SELECT conrelid::regclass::text||'.'||conname AS k, md5(pg_get_constraintdef(oid)) AS v FROM pg_constraint WHERE connamespace='public'::regnamespace`);
  for (const r of con.rows) m.set(`con:${r.k}`, r.v);
  return m;
}
function selisih(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k)).sort();
}
async function seksi(judul, fn) {
  console.log(`\n== ${judul} ==`);
  try { await fn(); } catch (e) { cek(`${judul}: seksi berhenti karena galat tak terduga`, false, e.message); }
}
async function hitungBaris(cl) {
  const r = await cl.query(`SELECT
    (SELECT count(*) FROM public.layanan)::int AS layanan, (SELECT count(*) FROM public.kunjungan)::int AS kunjungan,
    (SELECT count(*) FROM public.visit)::int AS visit, (SELECT count(*) FROM public.tiket_antrean)::int AS tiket_antrean,
    (SELECT count(*) FROM public.audit_log)::int AS audit_log, (SELECT count(*) FROM public.notifikasi)::int AS notifikasi,
    (SELECT count(*) FROM public.petugas)::int AS petugas, (SELECT count(*) FROM auth.users)::int AS auth_users,
    (SELECT string_agg(coalesce(prefiks_antrean,'-'), ',' ORDER BY id) FROM public.layanan) AS prefiks`);
  return r.rows[0];
}

// ---------- fase PASCA migrasi ----------
async function fasePasca() {
  await seksi('1. Prefiks 2 huruf dan format tiket', async () => {
    const semua = (await pgq(`SELECT nama, prefiks_antrean FROM public.layanan`)).rows;
    cek('semua layanan berprefiks ^[A-Z]{2}$', semua.every((l) => /^[A-Z]{2}$/.test(l.prefiks_antrean ?? '')), JSON.stringify(semua.filter((l) => !/^[A-Z]{2}$/.test(l.prefiks_antrean ?? ''))));
    cek('prefiks unik', new Set(semua.map((l) => l.prefiks_antrean)).size === semua.length);
    const peta = { OS: /^\s*helpdesk\s+oss/i, NO: /^\s*non[\s-]*oss/i, BM: /^\s*balmon/i, BL: /^\s*bank\s+lampung/i, BP: /^\s*bpjs/i,
      IG: /^\s*investment\s+gallery/i, JI: /jasa\s+industri/i, MU: /^\s*matchmaking/i, SH: /^\s*sertifikasi\s+halal/i, SM: /^\s*sertifikasi\s+mutu/i };
    for (const [k, re] of Object.entries(peta)) {
      const l = semua.filter((x) => re.test(x.nama));
      if (l.length === 1) cek(`layanan "${l[0].nama}" = ${k}`, l[0].prefiks_antrean === k, l[0].prefiks_antrean);
      else info(`pola ${k}: ${l.length} layanan cocok (dilewati)`);
    }
    await sp(async () => {
      const n = await pgq(`INSERT INTO public.layanan (nama) VALUES ('ZZ-TES Prefiks Baru') RETURNING prefiks_antrean`);
      cek('layanan baru tanpa prefiks -> auto 2 huruf', n.ok && /^[A-Z]{2}$/.test(n.rows[0].prefiks_antrean), sebut(n));
      const kosong = await pgq(`UPDATE public.layanan SET prefiks_antrean='' WHERE id=$1 RETURNING prefiks_antrean`, [F.A]);
      cek("prefiks '' -> auto", kosong.ok && /^[A-Z]{2}$/.test(kosong.rows[0].prefiks_antrean), sebut(kosong));
      cek('prefiks huruf kecil dinormalisasi', (await pgq(`UPDATE public.layanan SET prefiks_antrean=' zq ' WHERE id=$1 RETURNING prefiks_antrean`, [F.A])).rows?.[0]?.prefiks_antrean === 'ZQ');
      cek('prefiks 1 huruf ditolak CHECK (23514)', galat(await pgq(`UPDATE public.layanan SET prefiks_antrean='Z' WHERE id=$1`, [F.A]), '23514'));
      const lain = (await satu(`SELECT prefiks_antrean p FROM public.layanan WHERE id=$1`, [F.B])).p;
      cek('prefiks bentrok ditolak (23505)', galat(await pgq(`UPDATE public.layanan SET prefiks_antrean=$2 WHERE id=$1`, [F.A, lain]), '23505'));
    });
  });

  await seksi('2. fo_mulai_kunjungan', async () => {
    await sp(async () => {
      const r = await mulaiKunjungan(F.act.fo, { hp: '0812-3456-7890', kategori: 'UMKM', email: 'A@B.CO' });
      const h = hasil(r);
      cek('FO: ok, kunjungan + tahap 1', r.ok && h.ok && h.sudah_ada === false && !!h.penanganan_id, sebut(r));
      const k = await kunj(h.kunjungan_id);
      cek('kunjungan walk_in dilayani hari ini, HP dirapikan, email huruf kecil, dibuat_oleh FO',
        k.asal === 'walk_in' && k.status === 'dilayani' && k.kontak_hp === '081234567890' && k.email === 'a@b.co' && k.dibuat_oleh === F.fo && !!k.qr_token, JSON.stringify(k));
      const p = await tahap(h.penanganan_id);
      cek('tahap 1 fo walk_in berjalan, penangan FO', p.tahap_ke === 1 && p.peran_tahap === 'fo' && p.status === 'berjalan' && p.penangan_id === F.fo);
      cek('tanpa tiket', (await satu(`SELECT count(*)::int n FROM public.tiket_antrean WHERE kunjungan_id=$1`, [h.kunjungan_id])).n === 0);
      cek('Admin juga boleh', (await mulaiKunjungan(F.act.admin)).ok);
      cek('petugas: FORBIDDEN', ditolak(await mulaiKunjungan(F.act.petA), /FORBIDDEN/));
      cek('pengunjung: FORBIDDEN', ditolak(await mulaiKunjungan(F.act.visitor), /FORBIDDEN/));
      cek('anon: tanpa EXECUTE (42501)', ditolak(await mulaiKunjungan(ANON)));
      cek('nama pendek: DATA_TIDAK_VALID', galat(await mulaiKunjungan(F.act.fo, { nama: 'ab' }), '22023', /DATA_TIDAK_VALID/));
      cek('HP salah: DATA_TIDAK_VALID', galat(await mulaiKunjungan(F.act.fo, { hp: '12345' }), '22023', /DATA_TIDAK_VALID/));
      cek('kategori salah: DATA_TIDAK_VALID', galat(await mulaiKunjungan(F.act.fo, { kategori: 'X' }), '22023', /DATA_TIDAK_VALID/));
      cek('pengunjung tak ada: NOT_FOUND', galat(await mulaiKunjungan(F.act.fo, { pengunjung: randomUUID() }), 'P0002', /NOT_FOUND/));
      const crid = randomUUID();
      const a1 = hasil(await mulaiKunjungan(F.act.fo, { crid }));
      const a2 = hasil(await mulaiKunjungan(F.act.fo, { crid }));
      cek('idempoten client_request_id: kunjungan sama, sudah_ada', a2?.sudah_ada === true && a2.kunjungan_id === a1.kunjungan_id && a2.penanganan_id === a1.penanganan_id);
      cek('client_request_id dipakai FO lain: IDEMPOTENSI_BENTROK', galat(await mulaiKunjungan(F.act.fo2, { crid }), 'P0001', /IDEMPOTENSI_BENTROK/));
      await pgq(`UPDATE public.site_settings SET value='00:01' WHERE key='jam_tutup_layanan'`);
      cek('setelah jam tutup: LAYANAN_TUTUP', galat(await mulaiKunjungan(F.act.fo), 'P0001', /LAYANAN_TUTUP/));
    });
  });

  await seksi('3. fo_selesai', async () => {
    await sp(async () => {
      const h = hasil(await mulaiKunjungan(F.act.fo));
      cek('FO lain: BUKAN_PEMILIK', ditolak(await foSelesai(F.act.fo2, h.penanganan_id, F.topikFo, 'ok'), /BUKAN_PEMILIK/));
      cek('tanpa topik: TOPIK_WAJIB', galat(await foSelesai(F.act.fo, h.penanganan_id, null, 'ok'), '22023', /TOPIK_WAJIB/));
      cek('topik layanan (bukan FO): TOPIK_TIDAK_VALID', galat(await foSelesai(F.act.fo, h.penanganan_id, F.topikA, 'ok'), '22023', /TOPIK_TIDAK_VALID/));
      cek('catatan kosong: CATATAN_WAJIB', galat(await foSelesai(F.act.fo, h.penanganan_id, F.topikFo, '   '), '22023', /CATATAN_WAJIB/));
      cek('catatan 201: CATATAN_TERLALU_PANJANG', galat(await foSelesai(F.act.fo, h.penanganan_id, F.topikFo, 'x'.repeat(201)), '22023', /CATATAN_TERLALU_PANJANG/));
      const r = await foSelesai(F.act.fo, h.penanganan_id, F.topikFo, '  informasi diberikan  ');
      cek('pemilik: ok, kunjungan selesai', r.ok && hasil(r).kunjungan_status === 'selesai', sebut(r));
      const p = await tahap(h.penanganan_id);
      const k = await kunj(h.kunjungan_id);
      cek('tahap selesai/hasil selesai, catatan di-trim, topik tersalin, waktu server', p.status === 'selesai' && p.hasil === 'selesai'
        && p.catatan === 'informasi diberikan' && !!p.topik && p.selesai_at >= p.mulai_at, JSON.stringify(p));
      cek('kunjungan.selesai_at terisi trigger', k.status === 'selesai' && k.selesai_at !== null);
      cek('selesai kedua: INVALID_STATUS', galat(await foSelesai(F.act.fo, h.penanganan_id, F.topikFo, 'lagi'), 'P0001', /INVALID_STATUS/));
    });
  });

  await seksi('4. fo_eskalasi + notifikasi', async () => {
    await sp(async () => {
      const nAwal = (await satu(`SELECT count(*)::int n FROM public.notifikasi WHERE payload->>'type'='eskalasi_fo'`)).n;
      const x = await eskalasiBaru(F.A);
      const t = await tiket(x.tiket);
      const pref = (await satu(`SELECT prefiks_antrean p FROM public.layanan WHERE id=$1`, [F.A])).p;
      cek('tiket menunggu, nomor_display <KODE>-<nnn>, tanggal hari ini, penanganan_asal_id = tahap FO',
        t.status === 'menunggu' && new RegExp(`^${pref}-\\d{3}$`).test(t.nomor_display) && t.penanganan_asal_id === x.pfo
        && t.legacy_visit_id === null, JSON.stringify(t));
      cek('tahap FO selesai/dieskalasi', (await tahap(x.pfo)).hasil === 'dieskalasi');
      const pl = await tahap(x.plyn);
      cek('tahap 2 layanan menunggu, tiket terkait, saluran walk_in', pl.tahap_ke === 2 && pl.peran_tahap === 'layanan' && pl.status === 'menunggu'
        && pl.tiket_id === x.tiket && pl.saluran === 'walk_in' && pl.layanan_id === F.A);
      cek('kunjungan menunggu', (await kunj(x.kunjungan)).status === 'menunggu');
      const nAkhir = (await satu(`SELECT count(*)::int n FROM public.notifikasi WHERE payload->>'type'='eskalasi_fo'`)).n;
      cek('notifikasi diantrekan untuk 2 petugas aktif layanan A', nAkhir - nAwal === 2 && x.r.notifikasi_diantrekan === 2, `${nAwal}->${nAkhir}`);
      const nb = await satu(`SELECT body, payload FROM public.notifikasi WHERE payload->>'tiket_id'=$1 LIMIT 1`, [x.tiket]);
      cek('notifikasi tanpa nama pengunjung', !/ZZ Walkin/.test(nb.body), nb.body);
      info(`petugas_hadir (tanpa absensi fixture) = ${x.r.petugas_hadir}`);
      const y = hasil(await mulaiKunjungan(F.act.fo));
      cek('layanan tanpa jadwal hari ini: LAYANAN_TIDAK_BUKA', galat(await foEskalasi(F.act.fo, y.penanganan_id, F.C, F.topikFo, 'x'), 'P0001', /LAYANAN_TIDAK_BUKA/));
      cek('layanan tak ada: LAYANAN_TIDAK_VALID', galat(await foEskalasi(F.act.fo, y.penanganan_id, randomUUID(), F.topikFo, 'x'), '22023', /LAYANAN_TIDAK_VALID/));
      cek('penolakan tidak menutup tahap FO', (await tahap(y.penanganan_id)).status === 'berjalan');
      cek('eskalasi tahap yang sudah ditutup: INVALID_STATUS', galat(await foEskalasi(F.act.fo, x.pfo, F.A, F.topikFo, 'x'), 'P0001', /INVALID_STATUS/));
      const nomor2 = (await eskalasiBaru(F.A)).r.nomor_display;
      cek('nomor berurutan per layanan', Number(nomor2.split('-')[1]) === Number(t.nomor_display.split('-')[1]) + 1, `${t.nomor_display} -> ${nomor2}`);
    });
  });

  await seksi('5. layanan_mulai / layanan_selesai tiket hasil eskalasi', async () => {
    await sp(async () => {
      const x = await eskalasiBaru(F.A);
      cek('petugas layanan lain: FORBIDDEN', ditolak(await mulai(F.act.petB, x.tiket), /FORBIDDEN/));
      cek('FO: FORBIDDEN', ditolak(await mulai(F.act.fo, x.tiket), /FORBIDDEN/));
      const m = await mulai(F.act.petA, x.tiket);
      cek('petugas A mulai: ok', m.ok && hasil(m).sudah_milik_anda === false, sebut(m));
      const pl = await tahap(x.plyn);
      cek('tahap layanan berjalan oleh petugas A, mulai_at = waktu_mulai_layan tiket', pl.status === 'berjalan' && pl.penangan_id === F.petA
        && pl.mulai_at.getTime() === (await tiket(x.tiket)).waktu_mulai_layan.getTime());
      cek('kunjungan dilayani', (await kunj(x.kunjungan)).status === 'dilayani');
      cek('petugas A2: SUDAH_DIAMBIL', galat(await mulai(F.act.petA2, x.tiket), 'P0001', /SUDAH_DIAMBIL/));
      cek('tanpa topik: TOPIK_WAJIB (tidak ada yang berubah)', galat(await selesai(F.act.petA, x.tiket, null, 'x'), '22023', /TOPIK_WAJIB/)
        && (await tiket(x.tiket)).status === 'dilayani');
      cek('topik FO: TOPIK_TIDAK_VALID', galat(await selesai(F.act.petA, x.tiket, F.topikFo, 'x'), '22023', /TOPIK_TIDAK_VALID/));
      cek('tanpa catatan: CATATAN_WAJIB', galat(await selesai(F.act.petA, x.tiket, F.topikA, null), '22023', /CATATAN_WAJIB/));
      cek('bukan pemilik: BUKAN_PEMILIK', ditolak(await selesai(F.act.petA2, x.tiket, F.topikA, 'x'), /BUKAN_PEMILIK/));
      const s = await selesai(F.act.petA, x.tiket, F.topikA, 'NIB terbit');
      cek('pemilik selesai: ok, kunjungan selesai', s.ok && hasil(s).kunjungan_status === 'selesai' && hasil(s).penanganan_id === x.plyn, sebut(s));
      const p2 = await tahap(x.plyn);
      cek('tahap layanan selesai, topik ZZ topik, catatan', p2.status === 'selesai' && p2.hasil === 'selesai' && p2.topik === 'ZZ topik' && p2.catatan === 'NIB terbit');
      cek('finalize_pelayanan tanpa topik ditolak untuk tiket eskalasi (TOPIK_WAJIB)', await (async () => {
        const y = await eskalasiBaru(F.A);
        await mulai(F.act.petA, y.tiket);
        return kode(await run(F.act.petA, `SELECT public.finalize_pelayanan($1,'oss','{"nama_pemohon":"x"}'::jsonb)`, [y.tiket]), /TOPIK_WAJIB/);
      })());
    });
    await sp(async () => {
      if (!F.tiketLama) { info('tiket lama tidak tersedia; dilewati'); return; }
      const m = await mulai(F.act.petA, F.tiketLama);
      const s = await selesai(F.act.petA, F.tiketLama);
      const v = await satu(`SELECT v.status FROM public.visit v JOIN public.tiket_antrean t ON t.legacy_visit_id=v.id WHERE t.id=$1`, [F.tiketLama]);
      cek('tiket lama (visit): mulai & selesai tanpa topik/catatan seperti A3, visit ikut selesai', m.ok && s.ok && v.status === 'selesai', `${sebut(m)} / ${sebut(s)}`);
      cek('tiket lama tidak punya penanganan', (await satu(`SELECT count(*)::int n FROM public.penanganan WHERE tiket_id=$1`, [F.tiketLama])).n === 0);
    });
  });

  await seksi('6. layanan_kembalikan + kotak masuk FO', async () => {
    await sp(async () => {
      const x = await eskalasiBaru(F.A);
      cek('belum dimulai: INVALID_STATUS', galat(await kembalikan(F.act.petA, x.tiket, 'bukan ranah'), 'P0001', /INVALID_STATUS/));
      await mulai(F.act.petA, x.tiket);
      cek('bukan pemilik: BUKAN_PEMILIK', ditolak(await kembalikan(F.act.petA2, x.tiket, 'bukan ranah'), /BUKAN_PEMILIK/));
      cek('FO: FORBIDDEN', ditolak(await kembalikan(F.act.fo, x.tiket, 'bukan ranah'), /FORBIDDEN/));
      cek('tanpa catatan: CATATAN_WAJIB', galat(await kembalikan(F.act.petA, x.tiket, ''), '22023', /CATATAN_WAJIB/));
      const r = await kembalikan(F.act.petA, x.tiket, 'bukan ranah layanan ini');
      cek('pemilik mengembalikan: ok', r.ok, sebut(r));
      const pfo = hasil(r).penanganan_fo_id;
      cek('tiket dikembalikan (waktu_selesai server)', (await tiket(x.tiket)).status === 'dikembalikan' && (await tiket(x.tiket)).waktu_selesai !== null);
      cek('tahap layanan selesai hasil dikembalikan', (await tahap(x.plyn)).hasil === 'dikembalikan');
      const pf = await tahap(pfo);
      cek('tahap 3 FO menunggu (kotak masuk), kunjungan menunggu', pf.tahap_ke === 3 && pf.peran_tahap === 'fo' && pf.status === 'menunggu'
        && (await kunj(x.kunjungan)).status === 'menunggu');
      const lihat = async (a) => (await run(a, `SELECT id FROM public.penanganan WHERE id=$1`, [pfo])).rows?.length ?? 0;
      cek('RLS: FO lain melihat kotak masuk; petugas B tidak; pengunjung tidak', (await lihat(F.act.fo2)) === 1 && (await lihat(F.act.petB)) === 0 && (await lihat(F.act.visitor)) === 0);
      cek('RLS: petugas A melihat tahap FO kunjungan yang punya tahap di layanannya', (await lihat(F.act.petA)) === 1);
      cek('petugas tidak bisa mengambil kotak masuk: FORBIDDEN', ditolak(await foAmbil(F.act.petA, pfo), /FORBIDDEN/));
      const a1 = await foAmbil(F.act.fo2, pfo);
      cek('FO2 mengambil: ok', a1.ok && hasil(a1).sudah_milik_anda === false, sebut(a1));
      cek('FO1 kalah: SUDAH_DIAMBIL', galat(await foAmbil(F.act.fo, pfo), 'P0001', /SUDAH_DIAMBIL/));
      cek('FO2 klik ganda: sudah_milik_anda', hasil(await foAmbil(F.act.fo2, pfo))?.sudah_milik_anda === true);
      cek('kunjungan dilayani lagi', (await kunj(x.kunjungan)).status === 'dilayani');
      cek('ambil tahap layanan: BUKAN_TAHAP_FO', galat(await foAmbil(F.act.fo, x.plyn), 'P0001', /BUKAN_TAHAP_FO/));
      const r2 = await foSelesai(F.act.fo2, pfo, F.topikFo, 'dirujuk ke instansi lain');
      cek('FO2 menyelesaikan: kunjungan selesai', r2.ok && hasil(r2).kunjungan_status === 'selesai', sebut(r2));
      cek('tiket lama: TIKET_LAMA', !F.tiketLama || kode(await kembalikan(F.act.petA, F.tiketLama, 'x'), /TIKET_LAMA|INVALID_STATUS/));
    });
  });

  await seksi('7. admin_alihkan dan admin_ambil_alih', async () => {
    await sp(async () => {
      const x = await eskalasiBaru(F.A);
      cek('petugas: FORBIDDEN', ditolak(await alihkan(F.act.petA, x.tiket, F.B, 'salah layanan'), /FORBIDDEN/));
      cek('FO: FORBIDDEN', ditolak(await alihkan(F.act.fo, x.tiket, F.B, 'salah layanan'), /FORBIDDEN/));
      cek('alasan pendek: ALASAN_WAJIB', galat(await alihkan(F.act.admin, x.tiket, F.B, 'abc'), '22023', /ALASAN_WAJIB/));
      cek('layanan sama: LAYANAN_SAMA', galat(await alihkan(F.act.admin, x.tiket, F.A, 'salah layanan'), '22023', /LAYANAN_SAMA/));
      const r = await alihkan(F.act.admin, x.tiket, F.B, 'salah layanan');
      cek('Admin mengalihkan: ok', r.ok, sebut(r));
      const h = hasil(r);
      const lama = await tiket(x.tiket);
      cek('tiket lama dialihkan -> dialihkan_ke tiket baru', lama.status === 'dialihkan' && lama.dialihkan_ke === h.tiket_baru_id);
      const baru = await tiket(h.tiket_baru_id);
      cek('tiket baru layanan B menunggu, penanganan_asal_id sama', baru.layanan_id === F.B && baru.status === 'menunggu' && baru.penanganan_asal_id === x.pfo);
      const pl = await tahap(x.plyn);
      cek('tahap lama batal (dialihkan)', pl.status === 'batal' && pl.batal_karena === 'dialihkan');
      cek('tahap baru layanan B menunggu', (await tahap(h.penanganan_id)).status === 'menunggu');
      cek('audit_log admin_alihkan 1 entri', (await satu(`SELECT count(*)::int n FROM public.audit_log WHERE aksi='admin_alihkan' AND entitas_id=$1`, [x.tiket])).n === 1);
      cek('mengalihkan tiket yang sudah dialihkan: INVALID_STATUS', galat(await alihkan(F.act.admin, x.tiket, F.B, 'lagi lagi'), 'P0001', /INVALID_STATUS/));
      await mulai(F.act.petB, h.tiket_baru_id);
      const aa = await ambilAlih(F.act.admin, h.tiket_baru_id, 'petugas B pulang');
      cek('ambil alih tiket eskalasi: ok', aa.ok, sebut(aa));
      const tahapB = (await pgq(`SELECT status, batal_karena, penangan_id FROM public.penanganan WHERE tiket_id=$1 ORDER BY tahap_ke`, [h.tiket_baru_id])).rows;
      cek('tahap petugas B batal (diambil_alih) + tahap Admin berjalan', tahapB.length === 2 && tahapB[0].batal_karena === 'diambil_alih'
        && tahapB[0].penangan_id === F.petB && tahapB[1].status === 'berjalan' && tahapB[1].penangan_id === F.admin, JSON.stringify(tahapB));
      cek('Admin menyelesaikan dengan topik layanan B', (await selesai(F.act.admin, h.tiket_baru_id, F.topikB, 'selesai oleh Admin')).ok);
      if (F.tiketLama) cek('tiket lama: TIKET_LAMA', kode(await alihkan(F.act.admin, F.tiketLama, F.B, 'salah layanan'), /TIKET_LAMA/));
    });
  });

  await seksi('8. Reservasi pengunjung + check-in FO', async () => {
    await sp(async () => {
      // tanggal hari kerja terdekat (0..7 hari) WIB
      const tgl = (await satu(`SELECT to_char(d,'YYYY-MM-DD') d FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date,
        (now() AT TIME ZONE 'Asia/Jakarta')::date + 7, interval '1 day') AS g(d) WHERE extract(isodow FROM d) < 6 ORDER BY d LIMIT 1`)).d;
      const buat = (a, o = {}) => rpc(a, 'reservasi_buat', [o.tujuan ?? 'loket', o.tanggal ?? tgl, o.layanan ?? F.A, o.temu ?? null, 'uji', null]);
      const r = await buat(F.act.visitor);
      cek('pengunjung membuat reservasi: ok, qr 32 hex', r.ok && /^[0-9a-f]{32}$/.test(hasil(r).qr_token), sebut(r));
      const k = await kunj(hasil(r).kunjungan_id);
      cek('kunjungan reservasi terjadwal, profil tersalin, tanpa visit', k.status === 'terjadwal' && k.layanan_saran_id === F.A && k.kontak_hp === '081234567890'
        && k.legacy_visit_id === null && k.tujuan === 'loket');
      cek('ganda: RESERVASI_GANDA', galat(await buat(F.act.visitor), 'P0001', /RESERVASI_GANDA/));
      cek('tanggal lewat: TANGGAL_TIDAK_VALID', galat(await buat(F.act.visitor2, { tanggal: '2000-01-03' }), '22023', /TANGGAL_TIDAK_VALID/));
      cek('layanan tanpa jadwal: LAYANAN_TIDAK_BUKA', galat(await buat(F.act.visitor2, { layanan: F.C }), 'P0001', /LAYANAN_TIDAK_BUKA/));
      cek('bertemu_seseorang tanpa nama: DATA_TIDAK_VALID', galat(await buat(F.act.visitor2, { tujuan: 'bertemu_seseorang', layanan: null }), '22023', /DATA_TIDAK_VALID/));
      cek('bertemu_seseorang: ok', (await buat(F.act.visitor2, { tujuan: 'bertemu_seseorang', layanan: null, temu: 'Bapak Kepala' })).ok);
      await pgq(`UPDATE public.layanan SET kuota_harian=1 WHERE id=$1`, [F.A]);
      cek('kuota 1 terisi: KUOTA_PENUH', galat(await buat(F.act.visitor2), 'P0001', /KUOTA_PENUH/));
      cek('staf tanpa profil pengunjung: FORBIDDEN', ditolak(await buat(F.act.fo), /FORBIDDEN/));
      cek('pengunjung lain membatalkan: NOT_FOUND', galat(await rpc(F.act.visitor2, 'reservasi_batalkan', [k.id]), 'P0002', /NOT_FOUND/));
      cek('pemilik membatalkan: batal', hasil(await rpc(F.act.visitor, 'reservasi_batalkan', [k.id]))?.status === 'batal' && (await kunj(k.id)).status === 'batal');
      cek('RLS: pengunjung membaca reservasinya', (await run(F.act.visitor, `SELECT id FROM public.kunjungan WHERE id=$1`, [k.id])).rows?.length === 1);
    });
    await sp(async () => {
      const ins = async (tanggal) => (await satu(`INSERT INTO public.kunjungan (pengunjung_id, nama, asal, qr_token, tanggal, status, tujuan, layanan_saran_id)
        VALUES ($1,'ZZ Resv','reservasi',$2,$3::date,'terjadwal','loket',$4) RETURNING id, qr_token`,
        [F.p_visitor, randomUUID().replace(/-/g, ''), tanggal, F.A]));
      const hariIni = await ins(F.hariIni);
      const kemarin = await ins((await satu(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date - 1,'YYYY-MM-DD') d`)).d);
      const besok = await ins((await satu(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date + 1,'YYYY-MM-DD') d`)).d);
      const chk = (a, qr) => rpc(a, 'fo_checkin_reservasi', [qr]);
      cek('petugas: FORBIDDEN', ditolak(await chk(F.act.petA, hariIni.qr_token), /FORBIDDEN/));
      cek('QR tak dikenal: NOT_FOUND', galat(await chk(F.act.fo, 'tidakada'), 'P0002', /NOT_FOUND/));
      cek('kemarin: QR_KEDALUWARSA', galat(await chk(F.act.fo, kemarin.qr_token), 'P0001', /QR_KEDALUWARSA/));
      cek('besok: BUKAN_HARI_INI', galat(await chk(F.act.fo, besok.qr_token), 'P0001', /BUKAN_HARI_INI/));
      const r = await chk(F.act.fo, hariIni.qr_token);
      cek('hari ini: ok, layanan saran dikembalikan', r.ok && hasil(r).layanan_saran_id === F.A, sebut(r));
      cek('kunjungan dilayani + tahap fo qr berjalan, tanpa tiket', (await kunj(hariIni.id)).status === 'dilayani'
        && (await tahap(hasil(r).penanganan_id)).saluran === 'qr'
        && (await satu(`SELECT count(*)::int n FROM public.tiket_antrean WHERE kunjungan_id=$1`, [hariIni.id])).n === 0);
      cek('check-in kedua: INVALID_STATUS', galat(await chk(F.act.fo, hariIni.qr_token), 'P0001', /INVALID_STATUS/));
      cek('tolak tanpa alasan: ALASAN_WAJIB', galat(await rpc(F.act.fo, 'fo_tolak_reservasi', [besok.qr_token, 'x']), '22023', /ALASAN_WAJIB/));
      cek('tolak: batal + audit', hasil(await rpc(F.act.fo, 'fo_tolak_reservasi', [besok.qr_token, 'data tidak sesuai']))?.status === 'batal'
        && (await satu(`SELECT count(*)::int n FROM public.audit_log WHERE aksi='fo_tolak_reservasi' AND entitas_id=$1`, [besok.id])).n === 1);
    });
    await sp(async () => {
      const k = await satu(`SELECT id FROM public.kunjungan WHERE legacy_visit_id=$1`, [F.resvLama.id]);
      if (!k) { cek('reservasi lama punya baris kunjungan (dual-write)', false); return; }
      const rr = async () => (await satu(`SELECT coalesce(sum(dilayani),0)::int n FROM public.skm_response_rate WHERE layanan_id=$1`, [F.A])).n;
      const rrAwal = await rr();
      const r = await rpc(F.act.fo, 'fo_checkin_reservasi', [F.resvLama.qr_token]);
      const v1 = await satu(`SELECT status, waktu_scan FROM public.visit WHERE id=$1`, [F.resvLama.id]);
      cek('reservasi lama: check-in FO menyinkronkan visit -> dilayani tanpa tiket', r.ok && v1.status === 'dilayani' && v1.waktu_scan !== null
        && (await satu(`SELECT count(*)::int n FROM public.tiket_antrean WHERE legacy_visit_id=$1`, [F.resvLama.id])).n === 0, sebut(r));
      const s = await foSelesai(F.act.fo, hasil(r).penanganan_id, F.topikFo, 'informasi');
      const v2 = await satu(`SELECT status, waktu_selesai FROM public.visit WHERE id=$1`, [F.resvLama.id]);
      cek('fo_selesai: visit selesai (SKM lama), response-rate +1', s.ok && v2.status === 'selesai' && (await rr()) === rrAwal + 1, `${sebut(s)} ${JSON.stringify(v2)}`);
    });
  });

  await seksi('9. Jalur tulis langsung tertutup (RLS)', async () => {
    await sp(async () => {
      const x = await eskalasiBaru(F.A);
      cek('FO INSERT penanganan langsung: 42501', ditolak(await run(F.act.fo,
        `INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran) VALUES ($1, 9, 'fo', 'walk_in')`, [x.kunjungan])));
      cek('Admin UPDATE penanganan langsung: 42501 (tanpa hak UPDATE)', ditolak(await run(F.act.admin, `UPDATE public.penanganan SET catatan='x' WHERE id=$1`, [x.pfo])));
      cek('FO UPDATE kunjungan langsung: 0 baris', nol(await run(F.act.fo, `UPDATE public.kunjungan SET status='selesai' WHERE id=$1`, [x.kunjungan])));
      cek('FO INSERT kunjungan langsung: 42501', ditolak(await run(F.act.fo, `INSERT INTO public.kunjungan (nama, asal, tanggal) VALUES ('x','walk_in',current_date)`)));
      cek('pengunjung INSERT tiket langsung: 42501', ditolak(await run(F.act.visitor,
        `INSERT INTO public.tiket_antrean (kunjungan_id, layanan_id, tanggal, nomor, nomor_display) VALUES ($1,$2,current_date,999,'ZZ-999')`, [x.kunjungan, F.A])));
      cek('FO menulis topik: 42501', ditolak(await run(F.act.fo, `INSERT INTO public.topik_penanganan (layanan_id, nama) VALUES (NULL,'ZZ FO tulis')`)));
      cek('Admin menulis topik: ok', (await run(F.act.admin, `INSERT INTO public.topik_penanganan (layanan_id, nama) VALUES (NULL,'ZZ Admin tulis')`)).ok);
      cek('petugas membaca topik: ok', ((await run(F.act.petA, `SELECT id FROM public.topik_penanganan WHERE layanan_id=$1`, [F.A])).rows?.length ?? 0) >= 1);
      cek('pengunjung membaca topik: 0 baris', ((await run(F.act.visitor, `SELECT id FROM public.topik_penanganan`)).rows?.length ?? -1) === 0);
      cek('pengunjung membaca penanganan: 0 baris', ((await run(F.act.visitor, `SELECT id FROM public.penanganan`)).rows?.length ?? -1) === 0);
      cek('anon memanggil fo_sinkron_visit: 42501', ditolak(await run(ANON, `SELECT public.fo_sinkron_visit($1)`, [x.kunjungan])));
      cek('authenticated memanggil staf_wajib_sesi: 42501', ditolak(await run(F.act.fo, `SELECT * FROM public.staf_wajib_sesi(ARRAY['front_office'])`)));
    });
  });

  await seksi('10. Sesi tunggal', async () => {
    await sp(async () => {
      await pgq(`INSERT INTO public.sesi_staf (user_id, session_id) VALUES ($1,$2)`, [F.uid.fo, randomUUID()]);
      cek('sesi FO digantikan: SESI_TIDAK_SAH', ditolak(await mulaiKunjungan(asUser(F.uid.fo, { session_id: randomUUID() })), /SESI_TIDAK_SAH/));
    });
  });

  if (ujiAkhirHari) {
    await seksi('11. Job akhir hari + no-show (mengunci tiket menunggu/reservasi terjadwal!)', async () => {
      await sp(async () => {
        const x = await eskalasiBaru(F.A);
        const y = await eskalasiBaru(F.A);
        await mulai(F.act.petA, y.tiket);
        const z = await eskalasiBaru(F.A);
        await mulai(F.act.petA, z.tiket);
        const pfo = hasil(await kembalikan(F.act.petA, z.tiket, 'kembali')).penanganan_fo_id;
        const r = await pgq(`SELECT public.tandai_tidak_terlayani_akhir_hari()`);
        cek('job berjalan', r.ok, sebut(r));
        cek('tiket eskalasi menunggu -> tidak_terlayani, tahap batal, kunjungan tidak_terlayani',
          (await tiket(x.tiket)).status === 'tidak_terlayani' && (await tahap(x.plyn)).batal_karena === 'tidak_terlayani'
          && (await kunj(x.kunjungan)).status === 'tidak_terlayani');
        cek('tiket dilayani tidak tersentuh', (await tiket(y.tiket)).status === 'dilayani' && (await tahap(y.plyn)).status === 'berjalan');
        cek('kotak masuk FO tak diambil -> batal', (await tahap(pfo)).status === 'batal' && (await kunj(z.kunjungan)).status === 'tidak_terlayani');
        const kmr = await satu(`INSERT INTO public.kunjungan (pengunjung_id, nama, asal, qr_token, tanggal, status, tujuan)
          VALUES ($1,'ZZ Hangus','reservasi',$2,(now() AT TIME ZONE 'Asia/Jakarta')::date - 1,'terjadwal','loket') RETURNING id`, [F.p_visitor, randomUUID().replace(/-/g, '')]);
        const ns = await pgq(`SELECT public.tandai_reservasi_no_show() AS n`);
        cek('no-show: reservasi baru tanggal lewat -> no_show', ns.ok && (await kunj(kmr.id)).status === 'no_show', sebut(ns));
      });
    });
  } else {
    info('seksi job akhir hari/no-show dilewati (tambahkan --akhir-hari)');
  }
}

// ---------- main ----------
let kodeKeluar = 0;
const c2 = mkClient();
let sebelumBaris = null;
try {
  await c2.connect();
  sebelumBaris = await hitungBaris(c2);
  console.log('Baris SEBELUM:', JSON.stringify({ ...sebelumBaris, prefiks: undefined }));

  await c.connect();
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='3s'");
  await c.query("SET LOCAL statement_timeout='60s'");
  await buatFixture();

  for (const f of preFiles) {
    console.log(`\n-- prasyarat (dalam transaksi, tidak di-commit): ${f}`);
    await c.query(readFileSync(join(root, f), 'utf8'));
  }
  await siapkanLama();
  let snapAwal = null;
  if (applyFiles.length) {
    snapAwal = await snapshot();
    for (const f of applyFiles) {
      console.log(`\n-- menerapkan (dalam transaksi, tidak di-commit): ${f}`);
      await c.query(readFileSync(join(root, f), 'utf8'));
    }
    await seksi('0. Idempoten: menerapkan ulang ketiga migrasi tanpa galat', async () => {
      for (const f of applyFiles) cek(`ulang ${f}`, (await pgq(readFileSync(join(root, f), 'utf8'))).ok);
    });
  } else {
    info('tanpa --apply: menguji state DB saat ini; uji rollback dilewati');
  }
  await siapkanTopik();
  await fasePasca();

  if (applyFiles.length) {
    await seksi('12. Rollback mengembalikan katalog sebelum migrasi', async () => {
      if (rollbackFiles.length !== applyFiles.length) {
        cek('semua berkas --apply punya rollback docs/rollback-*-<versi>.sql', false, `${rollbackFiles.length}/${applyFiles.length}`);
        return;
      }
      await pgq(`DELETE FROM public.topik_penanganan WHERE nama='ZZ topik'`);
      const snapSetelah = await snapshot();
      cek('snapshot setelah apply BERBEDA dari awal (uji tidak vakum)', selisih(snapAwal, snapSetelah).length > 0);
      for (const f of rollbackFiles) {
        const r = await pgq(readFileSync(join(root, f), 'utf8'));
        cek(`rollback ${f} berhasil dieksekusi`, r.ok, `${r.code ?? ''} ${r.msg ?? ''}`);
      }
      const beda = selisih(snapAwal, await snapshot());
      cek('rollback: tidak ada selisih fungsi/policy/trigger/kolom/constraint', beda.length === 0, beda.join(' | '));
    });
  }
} catch (e) {
  console.error('ERROR tak terduga:', e.message);
  kodeKeluar = 2;
} finally {
  try { await c.query('RESET ROLE'); } catch { /* abaikan */ }
  try { await c.query('ROLLBACK'); console.log('\n(ROLLBACK dijalankan; tidak ada perubahan permanen)'); } catch { /* abaikan */ }
  try { await c.end(); } catch { /* abaikan */ }
}
try {
  const sesudahBaris = await hitungBaris(c2);
  console.log('Baris SESUDAH :', JSON.stringify({ ...sesudahBaris, prefiks: undefined }));
  cek('jumlah baris tabel kunci + prefiks layanan SEBELUM == SESUDAH ROLLBACK (tidak ada perubahan permanen)',
    JSON.stringify(sebelumBaris) === JSON.stringify(sesudahBaris));
} catch (e) { console.error('hitung baris sesudah gagal:', e.message); kodeKeluar = 2; }
try { await c2.end(); } catch { /* abaikan */ }
console.log(`\nRINGKASAN: ${lulus} lolos, ${gagal.length} gagal`);
if (gagal.length) { for (const g of gagal) console.log(' - ' + g); kodeKeluar = kodeKeluar || 1; }
process.exit(kodeKeluar);
