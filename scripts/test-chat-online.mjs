// Tahap C (C1-DB) live chat = layanan online tercatat (migrasi 202610140009_chat_online): tes PERILAKU (SET LOCAL ROLE +
// request.jwt.claims, SATU transaksi yang SELALU di-ROLLBACK). Tidak pernah COMMIT. Data uji sintetis (ZZ-TES-*).
// Menyentuh DB produksi lewat DIRECT_URL di .env.local walau semuanya di-rollback: jalankan di LUAR jam layanan
// (skrip menolak Senin-Jumat 07:00-16:59 WIB kecuali --paksa). Migrasi yang diterapkan di dalam transaksi mengunci
// tabel (ALTER TABLE chat_sesi/kunjungan/penanganan, layanan, tiket_antrean) sampai ROLLBACK.
//
// Pakai (DB produksi saat ini: 202610140001 sudah ada, 0002..0005 belum):
//   node scripts/test-chat-online.mjs \
//     --pre supabase/migrations/202610140002_tiket_kepemilikan.sql \
//     --pre supabase/migrations/202610140003_fo_model_data.sql \
//     --pre supabase/migrations/202610140004_fo_rpc.sql \
//     --pre supabase/migrations/202610140005_fo_selaras_antrean.sql \
//     --apply supabase/migrations/202610140009_chat_online.sql
//   --pre   = diterapkan dulu di dalam transaksi (tanpa uji rollback).
//   --apply = migrasi yang diuji + uji idempoten + uji rollback docs/rollback-*-<versi>.sql (snapshot katalog).
//   tanpa --apply: menguji state DB saat ini (seksi backfill/rollback dilewati).
//
// TIDAK tercakup: konkurensi SEJATI (dua koneksi serentak); yang diuji urutan berurutan (pemanggil kedua melihat hasil
// pertama: SUDAH_DIAMBIL). Route Next.js tidak diuji (hanya DB). Harness diturunkan dari scripts/test-fo-eskalasi.mjs.
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
let paksa = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--apply') applyFiles.push(argv[++i]);
  else if (argv[i] === '--pre') preFiles.push(argv[++i]);
  else if (argv[i] === '--paksa') paksa = true;
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
const SERVICE = { dbRole: 'service_role', claims: { role: 'service_role' } };
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
const sebut = (r) => (r.ok ? `ok n=${r.n} ${JSON.stringify(r.rows?.[0] ?? null)}` : `${r.code} ${r.msg}`);
const hasil = (r) => r.rows?.[0]?.r;

// ---------- RPC ----------
const rpc = (a, nama, args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return run(a, `SELECT public.${nama}(${ph}) AS r`, args);
};
const ambil = (a, sesi, alasan = null) => rpc(a, 'chat_ambil', [sesi, alasan]);
const teruskan = (a, sesi, layanan, topik, catatan) => rpc(a, 'chat_teruskan', [sesi, layanan, topik, catatan]);
const selesai = (a, sesi, topik, catatan) => rpc(a, 'chat_selesai', [sesi, topik, catatan]);

// ---------- fixture ----------
const F = {};
async function buatFixture() {
  const ids = {};
  for (const k of ['visitor', 'visitor2', 'visitor3', 'admin', 'fo', 'fo2', 'petA', 'petA2', 'petB']) ids[k] = randomUUID();
  F.uid = ids;
  for (const [k, uid] of Object.entries(ids)) {
    const r = await pgq(
      `INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES ($1,'authenticated','authenticated',$2,false)`,
      [uid, `zz-tes-${k}@example.invalid`]);
    if (!r.ok) throw new Error(`fixture auth.users ${k}: ${r.msg}`);
  }
  for (const [kunci, nama, chat] of [['A', 'ZZ-TES-A', true], ['B', 'ZZ-TES-B', true], ['C', 'ZZ-TES-C', false]]) {
    const r = await pgq(`INSERT INTO public.layanan (nama, is_ptsp, punya_chat) VALUES ($1, false, $2) RETURNING id`, [nama, chat]);
    if (!r.ok) throw new Error(`fixture layanan ${nama}: ${r.msg}`);
    F[kunci] = r.rows[0].id;
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
  for (const k of ['visitor', 'visitor2', 'visitor3']) {
    const r = await pgq(`INSERT INTO public.pengunjung (auth_user_id, nama, no_hp, asal_instansi, kategori, email)
      VALUES ($1,$2,'081234567890','ZZ Instansi','UMKM',$3) RETURNING id`, [ids[k], `ZZ ${k}`, `zz-${k}@example.invalid`]);
    if (!r.ok) throw new Error(`fixture pengunjung: ${r.msg}`);
    F[`p_${k}`] = r.rows[0].id;
  }
  F.act = Object.fromEntries(Object.entries(ids).map(([k, u]) => [k, asUser(u)]));
  F.hariIni = (await satu(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS d`)).d;
}

// Sesi chat dibuat sebagai pemilik tabel (tanpa batas laju anon). status bot|eskalasi.
// Perbaikan review (0009 diubah): kunjungan online hanya tercatat bila sesi eskalasi punya pesan pengunjung, jadi
// fixture menulis satu pesan pengunjung (seperti alur nyata: /api/chat/messages sebelum AI/eskalasi). pesan=false
// untuk menguji sesi kosong.
async function sesiBaru(layanan = F.A, status = 'eskalasi', pengunjung = F.p_visitor, kontak = 'ZZ Kontak', pesan = true) {
  const r = await pgq(`INSERT INTO public.chat_sesi (layanan_id, pengunjung_id, kontak_pengunjung, status)
    VALUES ($1,$2,$3,$4) RETURNING id`, [layanan, pengunjung, kontak, status]);
  if (!r.ok) throw new Error(`sesiBaru: ${sebut(r)}`);
  const sid = r.rows[0].id;
  if (pesan) {
    const m = await pgq(`INSERT INTO public.chat_pesan (sesi_id, pengirim, isi) VALUES ($1,'pengunjung','ZZ halo')`, [sid]);
    if (!m.ok) throw new Error(`sesiBaru pesan: ${sebut(m)}`);
  }
  return sid;
}
const sesi = (id) => satu(`SELECT * FROM public.chat_sesi WHERE id=$1`, [id]);
const kunj = (id) => satu(`SELECT * FROM public.kunjungan WHERE id=$1`, [id]);
const tahap = (id) => satu(`SELECT * FROM public.penanganan WHERE id=$1`, [id]);
const tahapSesi = async (sid) => (await pgq(`SELECT p.* FROM public.penanganan p JOIN public.kunjungan k ON k.id=p.kunjungan_id
  WHERE k.chat_sesi_id=$1 ORDER BY p.tahap_ke`, [sid])).rows ?? [];
const pesanTerakhir = (sid) => satu(`SELECT * FROM public.chat_pesan WHERE sesi_id=$1 ORDER BY created_at DESC, id DESC LIMIT 1`, [sid]);
const jumlahPesan = async (sid) => Number((await satu(`SELECT count(*)::int AS n FROM public.chat_pesan WHERE sesi_id=$1`, [sid])).n);

// Fixture lama (dibuat SEBELUM migrasi 0009): sesi berbagai status untuk uji backfill.
async function siapkanLama() {
  F.lama = {
    eskalasi: await sesiBaru(F.A, 'eskalasi', F.p_visitor2, 'ZZ Lama Eskalasi'),
    bot: await sesiBaru(F.A, 'bot', F.p_visitor2),
    aktifPet: await sesiBaru(F.A, 'bot', F.p_visitor2),
    aktifFo: await sesiBaru(F.B, 'bot', F.p_visitor2),
    aktifTanpa: await sesiBaru(F.B, 'bot', F.p_visitor2),
    selesai: await sesiBaru(F.A, 'bot', F.p_visitor2),
    // Batas backfill (review): tanpa pesan pengunjung, dan aktivitas terakhir > 24 jam -> TIDAK dibackfill.
    tanpaPesan: await sesiBaru(F.A, 'eskalasi', F.p_visitor2, 'ZZ Lama Kosong', false),
    tua: await sesiBaru(F.A, 'eskalasi', F.p_visitor2, 'ZZ Lama Tua'),
  };
  await pgq(`UPDATE public.chat_pesan SET created_at = now() - interval '2 days' WHERE sesi_id=$1`, [F.lama.tua]);
  await pgq(`UPDATE public.chat_sesi SET created_at = now() - interval '2 days' WHERE id=$1`, [F.lama.tua]);
  await run(SERVICE, `UPDATE public.chat_sesi SET status='aktif', ditangani_oleh=$2 WHERE id=$1`, [F.lama.aktifPet, F.petA]);
  await run(SERVICE, `UPDATE public.chat_sesi SET status='aktif', ditangani_oleh=$2 WHERE id=$1`, [F.lama.aktifFo, F.fo]);
  await run(SERVICE, `UPDATE public.chat_sesi SET status='aktif' WHERE id=$1`, [F.lama.aktifTanpa]);
  await run(SERVICE, `UPDATE public.chat_sesi SET status='selesai' WHERE id=$1`, [F.lama.selesai]);
}

async function siapkanTopik() {
  F.topikFo = (await satu(`SELECT id FROM public.topik_penanganan WHERE layanan_id IS NULL AND aktif ORDER BY urut LIMIT 1`))?.id;
  for (const k of ['A', 'B']) {
    const r = await pgq(`INSERT INTO public.topik_penanganan (layanan_id, nama, urut) VALUES ($1,'ZZ topik',1) RETURNING id`, [F[k]]);
    F[`topik${k}`] = r.rows?.[0]?.id;
  }
}

// ---------- snapshot untuk uji rollback ----------
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
  const ix = await pgq(`SELECT indexname AS k, md5(indexdef) AS v FROM pg_indexes WHERE schemaname='public'`);
  for (const r of ix.rows) m.set(`index:${r.k}`, r.v);
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
    (SELECT count(*) FROM public.chat_sesi)::int AS chat_sesi, (SELECT count(*) FROM public.chat_pesan)::int AS chat_pesan,
    (SELECT count(*) FROM public.kunjungan)::int AS kunjungan, (SELECT count(*) FROM public.layanan)::int AS layanan,
    (SELECT count(*) FROM public.audit_log)::int AS audit_log, (SELECT count(*) FROM public.notifikasi)::int AS notifikasi,
    (SELECT count(*) FROM public.petugas)::int AS petugas, (SELECT count(*) FROM auth.users)::int AS auth_users,
    (SELECT md5(coalesce(string_agg(id::text||status||coalesce(ditangani_oleh::text,'-'), ',' ORDER BY id), '')) FROM public.chat_sesi) AS sesi_md5`);
  return r.rows[0];
}

// ---------- fase PASCA migrasi ----------
async function fasePasca(adaApply) {
  if (adaApply) {
    await seksi('1. Backfill sesi lama', async () => {
      const e = await sesi(F.lama.eskalasi);
      const ke = e.kunjungan_id ? await kunj(e.kunjungan_id) : null;
      const te = await tahapSesi(F.lama.eskalasi);
      cek('eskalasi lama -> kunjungan online menunggu + tahap FO chat menunggu',
        ke?.asal === 'online' && ke.status === 'menunggu' && ke.chat_sesi_id === F.lama.eskalasi
        && te.length === 1 && te[0].peran_tahap === 'fo' && te[0].saluran === 'chat' && te[0].status === 'menunggu',
        JSON.stringify({ ke, te }));
      const ap = await tahapSesi(F.lama.aktifPet);
      cek('aktif lama (petugas A) -> tahap layanan A berjalan, penangan petA, kunjungan dilayani',
        ap.length === 1 && ap[0].peran_tahap === 'layanan' && ap[0].layanan_id === F.A && ap[0].penangan_id === F.petA
        && ap[0].status === 'berjalan' && (await kunj(ap[0].kunjungan_id)).status === 'dilayani', JSON.stringify(ap));
      const af = await tahapSesi(F.lama.aktifFo);
      cek('aktif lama (FO) -> tahap fo berjalan, penangan fo', af.length === 1 && af[0].peran_tahap === 'fo'
        && af[0].penangan_id === F.fo && af[0].status === 'berjalan', JSON.stringify(af));
      const at = await sesi(F.lama.aktifTanpa);
      cek('aktif lama tanpa penangan -> sesi eskalasi + tahap FO menunggu', at.status === 'eskalasi'
        && (await tahapSesi(F.lama.aktifTanpa))[0]?.status === 'menunggu', JSON.stringify(at));
      cek('sesi bot & selesai lama tidak disentuh',
        (await sesi(F.lama.bot)).kunjungan_id === null && (await sesi(F.lama.selesai)).kunjungan_id === null);
      cek('batas backfill: sesi eskalasi tanpa pesan pengunjung TIDAK dibackfill',
        (await sesi(F.lama.tanpaPesan)).kunjungan_id === null && (await sesi(F.lama.tanpaPesan)).status === 'eskalasi');
      cek('batas backfill: sesi eskalasi dengan aktivitas terakhir > 24 jam TIDAK dibackfill (ditutup job 0012)',
        (await sesi(F.lama.tua)).kunjungan_id === null);
      const n = await satu(`SELECT count(*)::int AS n FROM public.kunjungan WHERE asal='online'
        AND chat_sesi_id NOT IN (SELECT unnest($1::uuid[]))`, [Object.values(F.lama)]);
      info(`backfill sesi NYATA (bukan fixture) di DB ini: ${n.n} kunjungan online akan dibuat saat migrasi diterapkan`);
      const rinci = (await pgq(`SELECT s.status, count(*)::int AS n FROM public.chat_sesi s
        WHERE s.kunjungan_id IS NOT NULL AND s.id NOT IN (SELECT unnest($1::uuid[])) GROUP BY s.status`, [Object.values(F.lama)])).rows;
      info(`  rincian status sesi nyata yang dibackfill: ${JSON.stringify(rinci)}`);
    });
  }

  await seksi('2. Eskalasi membuat kunjungan online + kotak masuk FO', async () => {
    await sp(async () => {
      // Pengunjung (RLS) membuat sesi bot, lalu route AI (service_role) menaikkan ke eskalasi.
      const r = await run(F.act.visitor3, `INSERT INTO public.chat_sesi (layanan_id, pengunjung_id, kontak_pengunjung, status)
        VALUES ($1,$2,'ZZ Ketik','bot') RETURNING id`, [F.A, F.p_visitor3]);
      cek('pengunjung membuat sesi bot (RLS, alur lama tetap)', r.ok, sebut(r));
      const sid = r.rows?.[0]?.id;
      cek('sesi bot belum punya kunjungan', (await sesi(sid)).kunjungan_id === null);
      // Alur nyata: pesan pengunjung disimpan (/api/chat/messages) SEBELUM route AI menaikkan status.
      const pm = await run(F.act.visitor3, `INSERT INTO public.chat_pesan (sesi_id, pengirim, isi) VALUES ($1,'pengunjung','ZZ tanya')`, [sid]);
      cek('pengunjung menulis pesan di sesi bot (RLS): belum ada kunjungan', pm.ok && (await sesi(sid)).kunjungan_id === null, sebut(pm));
      const u = await run(SERVICE, `UPDATE public.chat_sesi SET status='eskalasi' WHERE id=$1 AND status='bot' RETURNING id`, [sid]);
      cek('service_role bot -> eskalasi (route AI) tetap diterima', u.ok && u.n === 1, sebut(u));
      const s = await sesi(sid);
      const k = s.kunjungan_id ? await kunj(s.kunjungan_id) : null;
      cek('kunjungan online menunggu dengan chat_sesi_id, data profil tersalin',
        k?.asal === 'online' && k.status === 'menunggu' && k.chat_sesi_id === sid && k.nama === 'ZZ visitor3'
        && k.kontak_hp === '081234567890' && k.email === 'zz-visitor3@example.invalid' && k.asal_instansi === 'ZZ Instansi'
        && k.kategori === 'UMKM' && k.layanan_saran_id === F.A && /^[0-9a-f]{32}$/.test(k.qr_token ?? '')
        && k.pengunjung_id === F.p_visitor3, JSON.stringify(k));
      cek('tanggal kunjungan = hari ini WIB', (await satu(`SELECT to_char(tanggal,'YYYY-MM-DD') AS d FROM public.kunjungan WHERE id=$1`, [k?.id])).d === F.hariIni);
      const t = await tahapSesi(sid);
      cek('tahap 1: fo / chat / menunggu / chat_sesi_id, tanpa penangan',
        t.length === 1 && t[0].tahap_ke === 1 && t[0].peran_tahap === 'fo' && t[0].saluran === 'chat'
        && t[0].status === 'menunggu' && t[0].chat_sesi_id === sid && t[0].penangan_id === null, JSON.stringify(t));
      const kotak = await run(F.act.fo, `SELECT id FROM public.penanganan WHERE peran_tahap='fo' AND status='menunggu' AND saluran='chat' AND id=$1`, [t[0]?.id]);
      cek('FO melihatnya di kotak masuk (RLS)', kotak.rows?.length === 1, sebut(kotak));
      const u2 = await run(SERVICE, `UPDATE public.chat_sesi SET status='eskalasi' WHERE id=$1 AND status='bot'`, [sid]);
      cek('eskalasi ulang (0 baris) tidak menggandakan kunjungan', u2.ok && u2.n === 0
        && Number((await satu(`SELECT count(*)::int AS n FROM public.kunjungan WHERE chat_sesi_id=$1`, [sid])).n) === 1);
    });
    await sp(async () => {
      const r = await run(F.act.visitor3, `INSERT INTO public.chat_sesi (layanan_id, pengunjung_id, kontak_pengunjung, status)
        VALUES ($1,$2,'ZZ Langsung','eskalasi') RETURNING id`, [F.A, F.p_visitor3]);
      cek('pengunjung membuat sesi langsung eskalasi (chatbot nonaktif) TANPA pesan -> belum ada kunjungan (batas spam)', r.ok
        && (await sesi(r.rows[0].id)).kunjungan_id === null, sebut(r));
      const sid = r.rows?.[0]?.id;
      const m1 = await run(F.act.visitor3, `INSERT INTO public.chat_pesan (sesi_id, pengirim, isi) VALUES ($1,'pengunjung','ZZ pesan 1')`, [sid]);
      const k1 = (await sesi(sid)).kunjungan_id;
      cek('pesan pengunjung pertama -> kunjungan online + tahap FO menunggu', m1.ok && k1 !== null
        && (await tahapSesi(sid)).length === 1 && (await tahapSesi(sid))[0].status === 'menunggu', sebut(m1));
      const m2 = await run(F.act.visitor3, `INSERT INTO public.chat_pesan (sesi_id, pengirim, isi) VALUES ($1,'pengunjung','ZZ pesan 2')`, [sid]);
      cek('pesan kedua tidak menggandakan kunjungan', m2.ok && (await sesi(sid)).kunjungan_id === k1
        && Number((await satu(`SELECT count(*)::int AS n FROM public.kunjungan WHERE chat_sesi_id=$1`, [sid])).n) === 1);
      const b = await sesiBaru(F.A, 'bot', F.p_visitor3, 'ZZ Bot Kosong', false);
      const ub = await run(SERVICE, `UPDATE public.chat_sesi SET status='eskalasi' WHERE id=$1 AND status='bot'`, [b]);
      cek('bot -> eskalasi tanpa pesan pengunjung: belum ada kunjungan', ub.ok && (await sesi(b)).kunjungan_id === null, sebut(ub));
      await pgq(`INSERT INTO public.chat_pesan (sesi_id, pengirim, isi) VALUES ($1,'bot','ZZ bot')`, [b]);
      cek('pesan bot tidak memicu kunjungan', (await sesi(b)).kunjungan_id === null);
    });
    await sp(async () => {
      const sid = await sesiBaru(F.A, 'eskalasi', null, 'ZZ Tanpa Profil');
      const k = await kunj((await sesi(sid)).kunjungan_id);
      cek('sesi tanpa pengunjung_id: nama dari kontak_pengunjung', k?.nama === 'ZZ Tanpa Profil' && k.pengunjung_id === null, JSON.stringify(k));
    });
  });

  await seksi('3. Penjaga: kolom staf chat_sesi hanya lewat RPC', async () => {
    const sid = await sesiBaru(F.A, 'eskalasi');
    cek('pengunjung INSERT status aktif: CHAT_HARUS_RPC', ditolak(await run(F.act.visitor3,
      `INSERT INTO public.chat_sesi (layanan_id, pengunjung_id, kontak_pengunjung, status) VALUES ($1,$2,'x','aktif')`, [F.A, F.p_visitor3]), /CHAT_HARUS_RPC/));
    cek('INSERT dengan ditangani_oleh: CHAT_HARUS_RPC', ditolak(await run(SERVICE,
      `INSERT INTO public.chat_sesi (layanan_id, kontak_pengunjung, status, ditangani_oleh) VALUES ($1,'x','bot',$2)`, [F.A, F.fo]), /CHAT_HARUS_RPC/));
    cek('route lama takeover (service_role eskalasi->aktif): CHAT_HARUS_RPC', ditolak(await run(SERVICE,
      `UPDATE public.chat_sesi SET status='aktif', ditangani_oleh=$2 WHERE id=$1`, [sid, F.fo]), /CHAT_HARUS_RPC/));
    cek('route lama selesaikan (service_role eskalasi->selesai): CHAT_HARUS_RPC', ditolak(await run(SERVICE,
      `UPDATE public.chat_sesi SET status='selesai', ditangani_oleh=NULL WHERE id=$1`, [sid]), /CHAT_HARUS_RPC/));
    cek('route lama kembali_ke_bot: CHAT_HARUS_RPC', ditolak(await run(SERVICE,
      `UPDATE public.chat_sesi SET status='bot' WHERE id=$1`, [sid]), /CHAT_HARUS_RPC/));
    cek('admin UPDATE langsung (RLS lolos) tetap CHAT_HARUS_RPC', ditolak(await run(F.act.admin,
      `UPDATE public.chat_sesi SET status='aktif', ditangani_oleh=$2 WHERE id=$1`, [sid, F.admin]), /CHAT_HARUS_RPC/));
    cek('pengunjung memindah layanan sesi tercatat: CHAT_HARUS_RPC', ditolak(await run(F.act.visitor,
      `UPDATE public.chat_sesi SET layanan_id=$2 WHERE id=$1`, [sid, F.B]), /CHAT_HARUS_RPC/));
    cek('mengubah kunjungan_id langsung: CHAT_HARUS_RPC', ditolak(await run(SERVICE,
      `UPDATE public.chat_sesi SET kunjungan_id=NULL WHERE id=$1`, [sid]), /CHAT_HARUS_RPC/));
    const k = await run(F.act.visitor, `UPDATE public.chat_sesi SET kontak_pengunjung='ZZ Ganti' WHERE id=$1`, [sid]);
    cek('pengunjung mengubah kontak_pengunjung (kolom tak dijaga) tetap boleh', k.ok && k.n === 1, sebut(k));
    await sp(async () => {
      const b = await sesiBaru(F.A, 'bot');
      const x = await run(SERVICE, `UPDATE public.chat_sesi SET status='selesai' WHERE id=$1`, [b]);
      cek('sesi bot tanpa kunjungan -> selesai tetap boleh', x.ok && x.n === 1, sebut(x));
    });
  });

  await seksi('4. chat_ambil oleh FO (atomik, kode galat, SALURAN_CHAT konsisten)', async () => {
    const sid = await sesiBaru(F.A, 'eskalasi');
    const pid = (await tahapSesi(sid))[0].id;
    const nPesan = await jumlahPesan(sid);
    cek('anon: 42501', ditolak(await ambil(ANON, sid)));
    cek('pengunjung: FORBIDDEN', ditolak(await ambil(F.act.visitor, sid), /FORBIDDEN/));
    cek('sesi tak ada: NOT_FOUND', galat(await ambil(F.act.fo, randomUUID()), 'P0002', /NOT_FOUND/));
    cek('petugas layanan lain (B): FORBIDDEN', ditolak(await ambil(F.act.petB, sid), /FORBIDDEN/));
    cek('fo_ambil_dari_kotak_masuk pada tahap chat: SALURAN_CHAT', galat(await rpc(F.act.fo, 'fo_ambil_dari_kotak_masuk', [pid]), 'P0001', /SALURAN_CHAT/));
    const a = await ambil(F.act.fo, sid);
    cek('FO mengambil', a.ok && hasil(a).sudah_milik_anda === false && hasil(a).peran_tahap === 'fo' && hasil(a).penanganan_id === pid, sebut(a));
    const t = await tahap(pid);
    const s = await sesi(sid);
    cek('tahap berjalan oleh FO (mulai_at server), kunjungan dilayani, sesi aktif ditangani FO',
      t.status === 'berjalan' && t.penangan_id === F.fo && t.mulai_at && (await kunj(t.kunjungan_id)).status === 'dilayani'
      && s.status === 'aktif' && s.ditangani_oleh === F.fo, JSON.stringify({ t, s }));
    const p = await pesanTerakhir(sid);
    cek('pesan sistem (bot) ditulis di transaksi yang sama', (await jumlahPesan(sid)) === nPesan + 1 && p.pengirim === 'bot', JSON.stringify(p));
    const lagi = await ambil(F.act.fo, sid);
    cek('klik ganda: sudah_milik_anda, tanpa pesan baru', lagi.ok && hasil(lagi).sudah_milik_anda === true && (await jumlahPesan(sid)) === nPesan + 1, sebut(lagi));
    cek('FO lain: SUDAH_DIAMBIL', galat(await ambil(F.act.fo2, sid), 'P0001', /SUDAH_DIAMBIL/));
    cek('petugas layanan sesi (A) setelah FO mengambil: SUDAH_DIAMBIL', galat(await ambil(F.act.petA, sid), 'P0001', /SUDAH_DIAMBIL/));
    cek('fo_selesai pada tahap chat: SALURAN_CHAT', galat(await rpc(F.act.fo, 'fo_selesai', [pid, F.topikFo, 'x']), 'P0001', /SALURAN_CHAT/));
    cek('fo_eskalasi pada tahap chat: SALURAN_CHAT', galat(await rpc(F.act.fo, 'fo_eskalasi', [pid, F.B, F.topikFo, 'x']), 'P0001', /SALURAN_CHAT/));
    F.sesiFo = sid;
  });

  await seksi('5. Petugas layanan mengambil langsung (belum diambil FO)', async () => {
    await sp(async () => {
      const sid = await sesiBaru(F.A, 'eskalasi');
      const a = await ambil(F.act.petA, sid);
      const t = (await tahapSesi(sid))[0];
      cek('petugas A mengambil: tahap menjadi layanan A (bukan tahap FO fiktif)', a.ok && hasil(a).peran_tahap === 'layanan'
        && t.peran_tahap === 'layanan' && t.layanan_id === F.A && t.penangan_id === F.petA && t.status === 'berjalan', sebut(a));
      cek('FO sesudahnya: SUDAH_DIAMBIL', galat(await ambil(F.act.fo, sid), 'P0001', /SUDAH_DIAMBIL/));
      cek('petugas A lain: SUDAH_DIAMBIL', galat(await ambil(F.act.petA2, sid), 'P0001', /SUDAH_DIAMBIL/));
      const kirim = await run(F.act.petA, `INSERT INTO public.chat_pesan (sesi_id, pengirim, isi) VALUES ($1,'petugas','ZZ balas') RETURNING id`, [sid]);
      cek('petugas penangan menulis pesan (RLS chat lama, tidak berubah)', kirim.ok, sebut(kirim));
      cek('teruskan oleh petugas: FORBIDDEN (peran)', ditolak(await teruskan(F.act.petA, sid, F.B, F.topikFo, 'x'), /FORBIDDEN/));
    });
    await sp(async () => {
      const sid = await sesiBaru(F.A, 'bot');
      const a = await ambil(F.act.petA, sid);
      const s = await sesi(sid);
      const k = s.kunjungan_id ? await kunj(s.kunjungan_id) : null;
      cek('petugas mengambil sesi BOT: kunjungan online dibuat, dilayani, tahap layanan berjalan',
        a.ok && k?.asal === 'online' && k.status === 'dilayani' && s.status === 'aktif'
        && (await tahapSesi(sid))[0]?.peran_tahap === 'layanan', sebut(a));
    });
  });

  await seksi('6. chat_teruskan FO -> layanan (tanpa tiket)', async () => {
    const sid = F.sesiFo;
    const pfo = (await tahapSesi(sid))[0].id;
    cek('topik kosong: TOPIK_WAJIB', galat(await teruskan(F.act.fo, sid, F.B, null, 'x'), '22023', /TOPIK_WAJIB/));
    cek('topik layanan: TOPIK_TIDAK_VALID', galat(await teruskan(F.act.fo, sid, F.B, F.topikA, 'x'), '22023', /TOPIK_TIDAK_VALID/));
    cek('catatan kosong: CATATAN_WAJIB', galat(await teruskan(F.act.fo, sid, F.B, F.topikFo, '  '), '22023', /CATATAN_WAJIB/));
    cek('catatan 201: CATATAN_TERLALU_PANJANG', galat(await teruskan(F.act.fo, sid, F.B, F.topikFo, 'x'.repeat(201)), '22023', /CATATAN_TERLALU_PANJANG/));
    cek('layanan tanpa chat (C): LAYANAN_TIDAK_VALID', galat(await teruskan(F.act.fo, sid, F.C, F.topikFo, 'x'), '22023', /LAYANAN_TIDAK_VALID/));
    cek('FO lain: BUKAN_PEMILIK', ditolak(await teruskan(F.act.fo2, sid, F.B, F.topikFo, 'x'), /BUKAN_PEMILIK/));
    const nNotif = Number((await satu(`SELECT count(*)::int AS n FROM public.notifikasi WHERE payload->>'type'='chat_diteruskan' AND payload->>'sesi_id'=$1`, [sid])).n);
    const tiketSebelum = Number((await satu(`SELECT count(*)::int AS n FROM public.tiket_antrean`)).n);
    const r = await teruskan(F.act.fo, sid, F.B, F.topikFo, 'perlu petugas B');
    cek('teruskan berhasil', r.ok && hasil(r).layanan_id === F.B && hasil(r).penanganan_fo_id === pfo
      && typeof hasil(r).petugas_hadir === 'boolean', sebut(r));
    const x = hasil(r) ?? {};
    const tf = await tahap(pfo);
    const tl = await tahap(x.penanganan_layanan_id);
    const s = await sesi(sid);
    cek('tahap FO selesai/dieskalasi + topik salinan + catatan', tf.status === 'selesai' && tf.hasil === 'dieskalasi'
      && tf.topik && tf.catatan === 'perlu petugas B' && tf.selesai_at, JSON.stringify(tf));
    cek('tahap layanan B menunggu, saluran chat, TANPA tiket', tl?.peran_tahap === 'layanan' && tl.layanan_id === F.B
      && tl.saluran === 'chat' && tl.status === 'menunggu' && tl.tiket_id === null && tl.chat_sesi_id === sid, JSON.stringify(tl));
    cek('tidak ada tiket diterbitkan', Number((await satu(`SELECT count(*)::int AS n FROM public.tiket_antrean`)).n) === tiketSebelum);
    cek('kunjungan menunggu; sesi eskalasi, penangan dilepas, layanan pindah ke B',
      (await kunj(x.kunjungan_id)).status === 'menunggu' && s.status === 'eskalasi' && s.ditangani_oleh === null && s.layanan_id === F.B, JSON.stringify(s));
    const nB = Number((await satu(`SELECT count(*)::int AS n FROM public.notifikasi WHERE payload->>'type'='chat_diteruskan' AND payload->>'sesi_id'=$1`, [sid])).n);
    cek('notifikasi ke petugas aktif B (1 orang), tanpa PII', nB === nNotif + 1 && x.notifikasi_diantrekan === 1
      && !(await satu(`SELECT body FROM public.notifikasi WHERE payload->>'sesi_id'=$1 ORDER BY created_at DESC LIMIT 1`, [sid])).body.includes('ZZ visitor'));
    cek('petugas B membaca sesi + catatan FO + kunjungan (RLS)',
      (await run(F.act.petB, `SELECT id FROM public.chat_sesi WHERE id=$1`, [sid])).rows?.length === 1
      && (await run(F.act.petB, `SELECT catatan FROM public.penanganan WHERE id=$1`, [pfo])).rows?.[0]?.catatan === 'perlu petugas B'
      && (await run(F.act.petB, `SELECT id FROM public.kunjungan WHERE id=$1`, [x.kunjungan_id])).rows?.length === 1);
    cek('petugas A tidak lagi membaca sesi/tahap/kunjungan',
      (await run(F.act.petA, `SELECT id FROM public.chat_sesi WHERE id=$1`, [sid])).rows?.length === 0
      && (await run(F.act.petA, `SELECT id FROM public.penanganan WHERE kunjungan_id=$1`, [x.kunjungan_id])).rows?.length === 0
      && (await run(F.act.petA, `SELECT id FROM public.kunjungan WHERE id=$1`, [x.kunjungan_id])).rows?.length === 0);
    cek('FO mengambil chat yang menunggu petugas layanan: FORBIDDEN', ditolak(await ambil(F.act.fo, sid), /FORBIDDEN/));
    cek('petugas A: FORBIDDEN (bukan layanannya)', ditolak(await ambil(F.act.petA, sid), /FORBIDDEN/));
    const b = await ambil(F.act.petB, sid);
    cek('petugas B mengambil tahap layanan', b.ok && hasil(b).penanganan_id === x.penanganan_layanan_id && hasil(b).peran_tahap === 'layanan', sebut(b));
    cek('teruskan lagi oleh FO: BUKAN_TAHAP_FO', galat(await teruskan(F.act.fo, sid, F.A, F.topikFo, 'x'), 'P0001', /BUKAN_TAHAP_FO/));
    F.sesiB = sid;
    F.kunjB = x.kunjungan_id;
  });

  await seksi('7. chat_selesai: topik + catatan wajib, kunjungan & sesi selesai, pesan penutup', async () => {
    const sid = F.sesiB;
    cek('FO (bukan penangan): BUKAN_PEMILIK', ditolak(await selesai(F.act.fo, sid, F.topikFo, 'x'), /BUKAN_PEMILIK/));
    cek('petugas B topik FO: TOPIK_TIDAK_VALID', galat(await selesai(F.act.petB, sid, F.topikFo, 'x'), '22023', /TOPIK_TIDAK_VALID/));
    cek('topik NULL: TOPIK_WAJIB', galat(await selesai(F.act.petB, sid, null, 'x'), '22023', /TOPIK_WAJIB/));
    cek('catatan kosong: CATATAN_WAJIB', galat(await selesai(F.act.petB, sid, F.topikB, ''), '22023', /CATATAN_WAJIB/));
    cek('catatan layanan 1001: CATATAN_TERLALU_PANJANG', galat(await selesai(F.act.petB, sid, F.topikB, 'y'.repeat(1001)), '22023', /CATATAN_TERLALU_PANJANG/));
    const r = await selesai(F.act.petB, sid, F.topikB, 'y'.repeat(1000));
    cek('petugas B selesai (catatan 1000 boleh)', r.ok && hasil(r).kunjungan_status === 'selesai', sebut(r));
    const t = await tahap(hasil(r)?.penanganan_id);
    const s = await sesi(sid);
    const k = await kunj(F.kunjB);
    cek('tahap selesai/hasil selesai, topik tersalin', t?.status === 'selesai' && t.hasil === 'selesai' && t.topik === 'ZZ topik', JSON.stringify(t));
    cek('kunjungan selesai + selesai_at server; sesi selesai', k.status === 'selesai' && k.selesai_at && s.status === 'selesai', JSON.stringify({ k, s }));
    const p = await satu(`SELECT * FROM public.chat_pesan WHERE id=$1`, [hasil(r)?.pesan_penutup_id]);
    cek('pesan penutup bertanda penutup_survei tanpa URL', p.pengirim === 'bot' && p.jenis_jawaban === 'penutup_survei'
      && p.id === hasil(r).pesan_penutup_id && !/https?:/i.test(p.isi), JSON.stringify(p));
    cek('selesai lagi: INVALID_STATUS', galat(await selesai(F.act.petB, sid, F.topikB, 'x'), 'P0001', /INVALID_STATUS/));
    cek('ambil sesi selesai: INVALID_STATUS', galat(await ambil(F.act.petB, sid), 'P0001', /INVALID_STATUS/));
    await sp(async () => {
      const s2 = await sesiBaru(F.A, 'eskalasi');
      cek('selesai sebelum diambil: INVALID_STATUS', galat(await selesai(F.act.fo, s2, F.topikFo, 'x'), 'P0001', /INVALID_STATUS/));
      await ambil(F.act.fo, s2);
      cek('FO catatan 201: CATATAN_TERLALU_PANJANG', galat(await selesai(F.act.fo, s2, F.topikFo, 'z'.repeat(201)), '22023', /CATATAN_TERLALU_PANJANG/));
      cek('FO topik layanan: TOPIK_TIDAK_VALID', galat(await selesai(F.act.fo, s2, F.topikA, 'z'), '22023', /TOPIK_TIDAK_VALID/));
      const f = await selesai(F.act.fo, s2, F.topikFo, 'z'.repeat(200));
      cek('FO selesai di FO (catatan 200)', f.ok && hasil(f).kunjungan_status === 'selesai', sebut(f));
      const kirim = await run(F.act.visitor, `INSERT INTO public.chat_pesan (sesi_id, pengirim, isi) VALUES ($1,'pengunjung','halo')`, [s2]);
      info(`pengunjung menulis ke sesi selesai via RLS: ${sebut(kirim)} (route /api/chat/messages menolak 409; RLS tidak diubah)`);
    });
  });

  await seksi('8. Admin: ambil alih (alasan + audit), ambil sesi bot, selesai (audit)', async () => {
    await sp(async () => {
      const sid = await sesiBaru(F.A, 'eskalasi');
      await ambil(F.act.fo, sid);
      const lama = (await tahapSesi(sid))[0];
      cek('admin tanpa alasan pada chat milik FO: ALASAN_WAJIB', galat(await ambil(F.act.admin, sid), '22023', /ALASAN_WAJIB/));
      const nAudit = Number((await satu(`SELECT count(*)::int AS n FROM public.audit_log WHERE entitas_id=$1`, [sid])).n);
      const a = await ambil(F.act.admin, sid, 'FO berhalangan');
      const semua = await tahapSesi(sid);
      cek('admin ambil alih: tahap lama batal(diambil_alih), tahap baru berjalan admin (peran fo)', a.ok && hasil(a).ambil_alih === true
        && hasil(a).pemilik_lama === F.fo && semua.length === 2 && semua[0].id === lama.id && semua[0].status === 'batal'
        && semua[0].batal_karena === 'diambil_alih' && semua[1].penangan_id === F.admin && semua[1].peran_tahap === 'fo'
        && semua[1].status === 'berjalan' && (await sesi(sid)).ditangani_oleh === F.admin, sebut(a));
      cek('audit_log chat_ambil_alih', Number((await satu(`SELECT count(*)::int AS n FROM public.audit_log WHERE entitas_id=$1 AND aksi='chat_ambil_alih'`, [sid])).n) === 1
        && Number((await satu(`SELECT count(*)::int AS n FROM public.audit_log WHERE entitas_id=$1`, [sid])).n) === nAudit + 1);
      cek('FO lama tidak bisa menutup lagi: BUKAN_PEMILIK', ditolak(await selesai(F.act.fo, sid, F.topikFo, 'x'), /BUKAN_PEMILIK/));
      const t = await teruskan(F.act.admin, sid, F.B, F.topikFo, 'admin teruskan');
      cek('admin meneruskan (tahap FO miliknya) + audit chat_teruskan', t.ok
        && Number((await satu(`SELECT count(*)::int AS n FROM public.audit_log WHERE entitas_id=$1 AND aksi='chat_teruskan'`, [sid])).n) === 1, sebut(t));
      const m = await ambil(F.act.admin, sid);
      cek('admin mengambil tahap layanan menunggu (tanpa alasan) + audit chat_ambil', m.ok && hasil(m).peran_tahap === 'layanan'
        && Number((await satu(`SELECT count(*)::int AS n FROM public.audit_log WHERE entitas_id=$1 AND aksi='chat_ambil'`, [sid])).n) === 1, sebut(m));
      const z = await selesai(F.act.admin, sid, F.topikB, 'admin selesai');
      cek('admin selesai dengan topik layanan B + audit chat_selesai', z.ok
        && Number((await satu(`SELECT count(*)::int AS n FROM public.audit_log WHERE entitas_id=$1 AND aksi='chat_selesai'`, [sid])).n) === 1, sebut(z));
    });
    await sp(async () => {
      const sid = await sesiBaru(F.B, 'bot');
      const a = await ambil(F.act.admin, sid);
      cek('admin mengambil sesi bot layanan mana pun: kunjungan dibuat, tahap fo berjalan', a.ok && hasil(a).peran_tahap === 'fo'
        && (await sesi(sid)).kunjungan_id !== null, sebut(a));
    });
  });

  await seksi('9. Keamanan & sesi staf', async () => {
    await sp(async () => {
      const sid = await sesiBaru(F.A, 'eskalasi');
      cek('pengunjung membaca penanganan chat: 0 baris', ((await run(F.act.visitor, `SELECT id FROM public.penanganan WHERE chat_sesi_id=$1`, [sid])).rows?.length ?? -1) === 0);
      for (const fn of ['chat_ubah_sesi(uuid,text,uuid,uuid)', 'chat_buat_kunjungan(uuid,text,date)', 'chat_pesan_sistem(uuid,text,text)']) {
        const ada = await satu(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS a, has_function_privilege('anon', $1, 'EXECUTE') AS b`, [`public.${fn}`]);
        cek(`fungsi internal ${fn} tidak bisa dipanggil klien`, ada.a === false && ada.b === false, JSON.stringify(ada));
      }
      for (const fn of ['chat_ambil(uuid,text)', 'chat_teruskan(uuid,uuid,uuid,text)', 'chat_selesai(uuid,uuid,text)']) {
        const ada = await satu(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS a, has_function_privilege('anon', $1, 'EXECUTE') AS b`, [`public.${fn}`]);
        cek(`RPC ${fn}: authenticated ya, anon tidak`, ada.a === true && ada.b === false, JSON.stringify(ada));
      }
      await pgq(`INSERT INTO public.sesi_staf (user_id, session_id) VALUES ($1,$2)`, [F.uid.fo, randomUUID()]);
      cek('sesi FO digantikan: SESI_TIDAK_SAH', ditolak(await ambil(asUser(F.uid.fo, { session_id: randomUUID() }), sid), /SESI_TIDAK_SAH/));
    });
  });
}

// ---------- main ----------
const jam = await (async () => {
  const cl = mkClient();
  await cl.connect();
  const r = await cl.query(`SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD HH24:MI ID') AS t,
    extract(isodow FROM now() AT TIME ZONE 'Asia/Jakarta')::int AS dow, extract(hour FROM now() AT TIME ZONE 'Asia/Jakarta')::int AS h`);
  await cl.end();
  return r.rows[0];
})();
console.log(`Waktu server WIB: ${jam.t}`);
if (!paksa && jam.dow <= 5 && jam.h >= 7 && jam.h < 17) {
  console.error('DITOLAK: jam layanan (Senin-Jumat 07:00-16:59 WIB). Jalankan di luar jam layanan atau --paksa.');
  process.exit(2);
}

let kodeKeluar = 0;
const c2 = mkClient();
let sebelumBaris = null;
try {
  await c2.connect();
  sebelumBaris = await hitungBaris(c2);
  console.log('Baris SEBELUM:', JSON.stringify(sebelumBaris));

  await c.connect();
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='3s'");
  await c.query("SET LOCAL statement_timeout='60s'");
  await buatFixture();

  for (const f of preFiles) {
    console.log(`\n-- prasyarat (dalam transaksi, tidak di-commit): ${f}`);
    await c.query(readFileSync(join(root, f), 'utf8'));
  }
  let snapAwal = null;
  if (applyFiles.length) {
    await siapkanLama();
    snapAwal = await snapshot();
    for (const f of applyFiles) {
      console.log(`\n-- menerapkan (dalam transaksi, tidak di-commit): ${f}`);
      await c.query(readFileSync(join(root, f), 'utf8'));
    }
    await seksi('0. Idempoten: menerapkan ulang migrasi tanpa galat', async () => {
      for (const f of applyFiles) cek(`ulang ${f}`, (await pgq(readFileSync(join(root, f), 'utf8'))).ok);
    });
  } else {
    info('tanpa --apply: menguji state DB saat ini; backfill & uji rollback dilewati');
  }
  await siapkanTopik();
  await fasePasca(applyFiles.length > 0);

  if (applyFiles.length) {
    await seksi('10. Rollback mengembalikan katalog sebelum migrasi', async () => {
      if (rollbackFiles.length !== applyFiles.length) {
        cek('semua berkas --apply punya rollback docs/rollback-*-<versi>.sql', false, `${rollbackFiles.length}/${applyFiles.length}`);
        return;
      }
      const snapSetelah = await snapshot();
      cek('snapshot setelah apply BERBEDA dari awal (uji tidak vakum)', selisih(snapAwal, snapSetelah).length > 0);
      for (const f of rollbackFiles) {
        const r = await pgq(readFileSync(join(root, f), 'utf8'));
        cek(`rollback ${f} berhasil dieksekusi`, r.ok, `${r.code ?? ''} ${r.msg ?? ''}`);
      }
      const beda = selisih(snapAwal, await snapshot());
      cek('rollback: tidak ada selisih fungsi/policy/trigger/kolom/constraint/indeks', beda.length === 0, beda.join(' | '));
      const t = await run(SERVICE, `UPDATE public.chat_sesi SET status='aktif', ditangani_oleh=$2 WHERE id=$1`, [F.lama.eskalasi, F.fo]);
      cek('setelah rollback: aksi lama (UPDATE status) kembali diterima', t.ok && t.n === 1, sebut(t));
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
  console.log('Baris SESUDAH :', JSON.stringify(sesudahBaris));
  cek('jumlah baris tabel kunci + status sesi chat SEBELUM == SESUDAH ROLLBACK (tidak ada perubahan permanen)',
    JSON.stringify(sebelumBaris) === JSON.stringify(sesudahBaris));
} catch (e) { console.error('hitung baris sesudah gagal:', e.message); kodeKeluar = 2; }
try { await c2.end(); } catch { /* abaikan */ }
console.log(`\nRINGKASAN: ${lulus} lolos, ${gagal.length} gagal`);
if (gagal.length) { for (const g of gagal) console.log(' - ' + g); kodeKeluar = kodeKeluar || 1; }
process.exit(kodeKeluar);
