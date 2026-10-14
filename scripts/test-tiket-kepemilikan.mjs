// A3 kepemilikan tiket (migrasi 202610140002_tiket_kepemilikan): tes PERILAKU (SET LOCAL ROLE + request.jwt.claims,
// SATU transaksi yang SELALU di-ROLLBACK). Tidak pernah COMMIT. Data uji sintetis (ZZ-TES-*).
// BELUM PERNAH DIJALANKAN oleh penulisnya: jalankan hanya setelah diperiksa dan atas konfirmasi CEO (menyentuh DB
// produksi lewat DIRECT_URL di .env.local, walau semuanya di-rollback). Disarankan di luar jam layanan:
// transaksi memegang kunci baris fixture saja, kecuali seksi opsional --akhir-hari (mengunci tiket 'menunggu' hari ini).
//
// Pakai (DB yang BELUM memuat migrasi A1/A3):
//   node scripts/test-tiket-kepemilikan.mjs --pre supabase/migrations/202610140001_sesi_staf.sql \
//        --apply supabase/migrations/202610140002_tiket_kepemilikan.sql [--akhir-hari]
//   --pre   = diterapkan dulu di dalam transaksi (tanpa uji rollback).
//   --apply = migrasi yang diuji + uji backfill + uji rollback docs/rollback-tiket-kepemilikan-<id>.sql (snapshot).
//   tanpa --apply: menguji state DB saat ini (migrasi harus sudah diterapkan; seksi backfill/rollback dilewati).
//
// Cakupan (docs/analysis/ANTREAN-ARAH-TULIS.md §5.5): 2,3,4,6,7,8,9(opsional),10,11,12 + Admin 7.1, ambil alih 7.2,
// backfill 7.3, draf pemilik 7.5. TIDAK tercakup: konkurensi SEJATI dua sesi (§5.5 butir 1, 5, 13). Satu transaksi
// yang di-rollback tidak bisa dilihat koneksi kedua; yang diuji di sini hanya urutan berurutan (pemanggil kedua
// melihat hasil pemanggil pertama). Uji serentak butuh DB staging (fixture yang di-commit) dan dua klien paralel.
// Harness diturunkan dari scripts/test-rbac-akhir.mjs.
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

// Rollback = docs/rollback-<nama>-<versi>.sql untuk setiap berkas --apply (urutan terbalik).
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

const ditolak = (r, re) => !r.ok && r.code === '42501' && (!re || re.test(r.msg));
const galat = (r, code, re) => !r.ok && r.code === code && (!re || re.test(r.msg));
const nol = (r) => r.ok && r.n === 0;
const sebut = (r) => (r.ok ? `ok n=${r.n} ${JSON.stringify(r.rows?.[0] ?? null)}` : `${r.code} ${r.msg}`);

// ---------- fixture ----------
const F = {};
async function buatFixture() {
  const ids = {};
  for (const k of ['visitor', 'admin', 'admin2', 'adminOff', 'fo', 'petA', 'petA2', 'petB', 'petOff']) ids[k] = randomUUID();
  F.uid = ids;
  for (const [k, uid] of Object.entries(ids)) {
    const r = await pgq(
      `INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES ($1,'authenticated','authenticated',$2,$3)`,
      [uid, `zz-tes-${k}@example.invalid`, k.startsWith('visitor')],
    );
    if (!r.ok) throw new Error(`fixture auth.users ${k}: ${r.msg}`);
  }
  const la = await pgq(`INSERT INTO public.layanan (nama, is_ptsp) VALUES ('ZZ-TES-A', true) RETURNING id`);
  const lb = await pgq(`INSERT INTO public.layanan (nama, is_ptsp) VALUES ('ZZ-TES-B', false) RETURNING id`);
  if (!la.ok || !lb.ok) throw new Error(`fixture layanan: ${la.msg ?? lb.msg}`);
  F.A = la.rows[0].id; F.B = lb.rows[0].id;
  for (const l of [F.A, F.B]) {
    for (let h = 1; h <= 7; h++) await pgq(`INSERT INTO public.jadwal_standby (layanan_id, hari, aktif) VALUES ($1,$2,true)`, [l, h]);
  }
  const pet = async (k, role, layanan, aktif) => {
    const r = await pgq(
      `INSERT INTO public.petugas (auth_user_id, nama, layanan_id, role, aktif) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [ids[k], `ZZ ${k}`, layanan, role, aktif],
    );
    if (!r.ok) throw new Error(`fixture petugas ${k}: ${r.msg}`);
    F[k] = r.rows[0].id;
  };
  await pet('admin', 'admin', null, true);
  await pet('admin2', 'admin', null, true);
  await pet('adminOff', 'admin', null, false);
  await pet('fo', 'front_office', null, true);
  await pet('petA', 'petugas', F.A, true);
  await pet('petA2', 'petugas', F.A, true);
  await pet('petB', 'petugas', F.B, true);
  await pet('petOff', 'petugas', F.A, false);
  const pv = await pgq(`INSERT INTO public.pengunjung (auth_user_id, nama) VALUES ($1,'ZZ visitor') RETURNING id`, [ids.visitor]);
  if (!pv.ok) throw new Error(`fixture pengunjung: ${pv.msg}`);
  F.p_visitor = pv.rows[0].id;
  F.act = Object.fromEntries(Object.entries(ids).map(([k, u]) => [k, asUser(u)]));
  F.hariIni = (await pgq(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS d`)).rows[0].d;
  // Walk-in fixture tidak bergantung jam sebenarnya (bypass resmi guard 202610090005, hanya di transaksi ini).
  await pgq(`SELECT set_config('lmh.izinkan_jam_tutup','on',true)`);
  await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);
}

let nTiket = 0;
async function buatTiket(layanan) {
  const nama = `ZZ Tiket ${++nTiket}`;
  const v = await pgq(
    `INSERT INTO public.visit (asal, nama, keperluan, layanan_id, tujuan, status, waktu_masuk, client_request_id, pengunjung_id)
     VALUES ('walk_in',$1,'x',$2,'loket','menunggu',now(),$3,$4) RETURNING id, qr_token`, [nama, layanan, randomUUID(), F.p_visitor]);
  if (!v.ok) throw new Error(`buatTiket: ${v.msg}`);
  const t = await pgq(`SELECT id, kunjungan_id FROM public.tiket_antrean WHERE legacy_visit_id=$1`, [v.rows[0].id]);
  if (!t.rows?.length) throw new Error('buatTiket: tiket tidak terbit');
  return { visit: v.rows[0].id, qr: v.rows[0].qr_token, tiket: t.rows[0].id, kunjungan: t.rows[0].kunjungan_id };
}
const mulai = (a, tiket) => run(a, `SELECT public.layanan_mulai($1) AS r`, [tiket]);
const selesai = (a, tiket, form = null, payload = null) =>
  run(a, `SELECT public.layanan_selesai($1,$2,$3::jsonb) AS r`, [tiket, form, payload ? JSON.stringify(payload) : null]);
const ambilAlih = (a, tiket, alasan) => run(a, `SELECT public.admin_ambil_alih($1,$2) AS r`, [tiket, alasan]);
const keadaan = async (x) => (await pgq(
  `SELECT t.status AS t_status, t.dilayani_oleh, t.waktu_mulai_layan AS t_mulai, t.waktu_selesai AS t_selesai, t.updated_at AS t_upd,
          v.status AS v_status, v.waktu_mulai_layan AS v_mulai, v.waktu_selesai AS v_selesai, v.updated_at AS v_upd,
          k.status AS k_status
     FROM public.tiket_antrean t
     LEFT JOIN public.visit v ON v.id = t.legacy_visit_id
     JOIN public.kunjungan k ON k.id = t.kunjungan_id
    WHERE t.id=$1`, [x.tiket])).rows[0];
const sama = (a, b) => (a === null && b === null) || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());
const PAYLOAD_OSS = { nama_pemohon: 'Siti', nama_usaha: 'PT X', tindak_lanjut: 't', uraian_solusi: 'u' };

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
  const col = await pgq(`SELECT table_name||'.'||column_name AS k, data_type AS v FROM information_schema.columns WHERE table_schema='public'`);
  for (const r of col.rows) m.set(`col:${r.k}`, r.v);
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
    (SELECT count(*) FROM public.petugas)::int AS petugas, (SELECT count(*) FROM public.layanan)::int AS layanan,
    (SELECT count(*) FROM public.kunjungan)::int AS kunjungan, (SELECT count(*) FROM public.visit)::int AS visit,
    (SELECT count(*) FROM public.tiket_antrean)::int AS tiket_antrean, (SELECT count(*) FROM public.audit_log)::int AS audit_log,
    (SELECT count(*) FROM public.pelayanan_oss)::int AS pelayanan_oss, (SELECT count(*) FROM public.pelayanan_perizinan)::int AS pelayanan_perizinan,
    (SELECT count(*) FROM public.tiket_antrean WHERE dilayani_oleh IS NOT NULL)::int AS tiket_berpemilik,
    (SELECT count(*) FROM public.site_settings)::int AS site_settings, (SELECT count(*) FROM auth.users)::int AS auth_users`);
  return r.rows[0];
}

// ---------- fixture backfill (7.3): dibuat SEBELUM migrasi diterapkan, lewat jalur lama ----------
async function siapkanBackfill() {
  // (a) dimulai petugas A lewat UPDATE langsung (jalur lama) -> audit aktor petA -> backfill = petA.
  F.bfA = await buatTiket(F.A);
  const a = await run(F.act.petA, `UPDATE public.visit SET status='dilayani', waktu_mulai_layan=now() WHERE id=$1`, [F.bfA.visit]);
  // (b) dimulai Admin, lalu ditulis ulang oleh koneksi tanpa JWT (aktor system) -> entri TERAKHIR tak terpetakan -> NULL.
  F.bfSys = await buatTiket(F.A);
  const b1 = await run(F.act.admin, `UPDATE public.visit SET status='dilayani', waktu_mulai_layan=now() WHERE id=$1`, [F.bfSys.visit]);
  const b2 = await pgq(`UPDATE public.visit SET status='dilayani' WHERE id=$1`, [F.bfSys.visit]);
  // (c) tiket selesai (histori) tidak boleh tersentuh backfill.
  F.bfSelesai = await buatTiket(F.A);
  await run(F.act.petA, `UPDATE public.visit SET status='dilayani', waktu_mulai_layan=now() WHERE id=$1`, [F.bfSelesai.visit]);
  await run(F.act.petA, `UPDATE public.visit SET status='selesai', waktu_selesai=now() WHERE id=$1`, [F.bfSelesai.visit]);
  if (!a.ok || !b1.ok || !b2.ok) throw new Error(`siapkanBackfill: ${sebut(a)} / ${sebut(b1)} / ${sebut(b2)}`);
  F.bfProdSebelum = (await pgq(
    `SELECT count(*)::int n FROM public.tiket_antrean WHERE status='dilayani' AND dilayani_oleh IS NULL AND layanan_id NOT IN ($1,$2)`,
    [F.A, F.B])).rows[0].n;
}

async function ujiBackfill() {
  await seksi('0. Backfill dilayani_oleh (keputusan 7.3)', async () => {
    const pemilik = async (x) => (await pgq(`SELECT dilayani_oleh, status FROM public.tiket_antrean WHERE id=$1`, [x.tiket])).rows[0];
    cek('tiket dilayani: aktor audit terakhir (petA) dipetakan ke petugas.id', (await pemilik(F.bfA)).dilayani_oleh === F.petA);
    cek('entri audit terakhir beraktor system -> tetap NULL (tidak menebak Admin dari entri lebih lama)', (await pemilik(F.bfSys)).dilayani_oleh === null);
    const hs = await pemilik(F.bfSelesai);
    cek('tiket selesai (histori) tidak disentuh', hs.status === 'selesai' && hs.dilayani_oleh === null);
    const sesudah = (await pgq(
      `SELECT count(*)::int n FROM public.tiket_antrean WHERE status='dilayani' AND dilayani_oleh IS NULL AND layanan_id NOT IN ($1,$2)`,
      [F.A, F.B])).rows[0].n;
    info(`produksi (di luar fixture): tiket 'dilayani' tanpa pemilik sebelum=${F.bfProdSebelum}, sesudah backfill=${sesudah} (sisa = tak terpetakan, perlu Ambil alih Admin)`);
  });
}

// ---------- fase PASCA migrasi ----------
async function fasePasca() {
  await seksi('1. layanan_mulai: atomik, pemilik, nilai identik', async () => {
    await sp(async () => {
      const x = await buatTiket(F.A);
      const r1 = await mulai(F.act.petA, x.tiket);
      cek('petugas layanannya memulai: ok', r1.ok && r1.rows[0].r.ok === true && r1.rows[0].r.sudah_milik_anda === false, sebut(r1));
      const s = await keadaan(x);
      cek('tiket dilayani, dilayani_oleh = petugas A', s.t_status === 'dilayani' && s.dilayani_oleh === F.petA, JSON.stringify(s));
      cek('visit dan kunjungan ikut dilayani', s.v_status === 'dilayani' && s.k_status === 'dilayani');
      cek('waktu_mulai_layan identik tiket = visit', sama(s.t_mulai, s.v_mulai) && s.t_mulai !== null);
      cek('updated_at identik tiket = visit (trigger menulis ulang nilai sama)', sama(s.t_upd, s.v_upd));
      const auditMulai = async () => (await pgq(
        `SELECT count(*)::int n FROM public.audit_log WHERE entitas='visit' AND entitas_id=$1 AND detail->>'status'='dilayani'`, [x.visit])).rows[0].n;
      const nAudit = await auditMulai();
      cek('audit visit dilayani tercatat 1x', nAudit === 1, `n=${nAudit}`);

      const r2 = await mulai(F.act.petA, x.tiket);
      cek('klik ganda pemilik yang sama: ok + sudah_milik_anda', r2.ok && r2.rows[0].r.sudah_milik_anda === true, sebut(r2));
      info(`audit setelah klik ganda: ${await auditMulai()} entri (klik ganda tidak menulis visit lagi)`);
      cek('petugas lain layanan sama: SUDAH_DIAMBIL', galat(await mulai(F.act.petA2, x.tiket), 'P0001', /SUDAH_DIAMBIL/));
      cek('Admin: SUDAH_DIAMBIL', galat(await mulai(F.act.admin, x.tiket), 'P0001', /SUDAH_DIAMBIL/));
      cek('pemilik tetap petugas A', (await keadaan(x)).dilayani_oleh === F.petA);
    });

    await sp(async () => {
      const x = await buatTiket(F.A);
      cek('Front Office ditolak FORBIDDEN (7.1)', ditolak(await mulai(F.act.fo, x.tiket), /FORBIDDEN/));
      cek('petugas layanan lain ditolak FORBIDDEN', ditolak(await mulai(F.act.petB, x.tiket), /FORBIDDEN/));
      cek('petugas nonaktif ditolak FORBIDDEN', ditolak(await mulai(F.act.petOff, x.tiket), /FORBIDDEN/));
      cek('Admin nonaktif ditolak FORBIDDEN', ditolak(await mulai(F.act.adminOff, x.tiket), /FORBIDDEN/));
      cek('pengunjung ditolak FORBIDDEN', ditolak(await mulai(F.act.visitor, x.tiket), /FORBIDDEN/));
      cek('anon tidak punya EXECUTE (42501)', ditolak(await mulai(ANON, x.tiket)));
      cek('tiket tak ada: NOT_FOUND (P0002)', galat(await mulai(F.act.petA, randomUUID()), 'P0002', /NOT_FOUND/));
      cek('setelah semua penolakan tiket masih menunggu tanpa pemilik', (await keadaan(x)).t_status === 'menunggu' && (await keadaan(x)).dilayani_oleh === null);
      const y = await buatTiket(F.B);
      const ra = await mulai(F.act.admin, y.tiket);
      cek('Admin boleh memulai tiket layanan mana pun (7.1) dan menjadi pemilik', ra.ok && (await keadaan(y)).dilayani_oleh === F.admin, sebut(ra));
    });
  });

  await seksi('2. layanan_selesai: hanya pemilik', async () => {
    await sp(async () => {
      const x = await buatTiket(F.A);
      cek('selesai sebelum mulai: INVALID_STATUS', galat(await selesai(F.act.petA, x.tiket), 'P0001', /INVALID_STATUS/));
      await mulai(F.act.petA, x.tiket);
      cek('petugas lain (layanan sama): BUKAN_PEMILIK', ditolak(await selesai(F.act.petA2, x.tiket), /BUKAN_PEMILIK/));
      cek('Admin bukan pemilik: BUKAN_PEMILIK', ditolak(await selesai(F.act.admin, x.tiket), /BUKAN_PEMILIK/));
      cek('Front Office: FORBIDDEN', ditolak(await selesai(F.act.fo, x.tiket), /FORBIDDEN/));
      cek('form tak dikenal: INVALID_FORM', galat(await selesai(F.act.petA, x.tiket, 'xx', {}), '22023', /INVALID_FORM/));
      cek('penolakan tidak mengubah baris', (await keadaan(x)).t_status === 'dilayani');

      const rr = async () => (await pgq(`SELECT coalesce(sum(dilayani),0)::int n FROM public.skm_response_rate WHERE layanan_id=$1`, [F.A])).rows[0].n;
      const rrAwal = await rr();
      const r = await selesai(F.act.petA, x.tiket);
      cek('pemilik menyelesaikan (tanpa pendataan): ok', r.ok && r.rows[0].r.ok === true && r.rows[0].r.is_locked === false, sebut(r));
      const s = await keadaan(x);
      cek('tiket/visit/kunjungan selesai', s.t_status === 'selesai' && s.v_status === 'selesai' && s.k_status === 'selesai', JSON.stringify(s));
      cek('waktu_selesai identik tiket = visit', sama(s.t_selesai, s.v_selesai) && s.t_selesai !== null);
      cek('skm_response_rate.dilayani +1 tepat sekali (trigger visit)', (await rr()) === rrAwal + 1);
      cek('audit visit selesai tercatat 1x', (await pgq(
        `SELECT count(*)::int n FROM public.audit_log WHERE entitas='visit' AND entitas_id=$1 AND detail->>'status'='selesai'`, [x.visit])).rows[0].n === 1);
      cek('selesai kedua oleh pemilik: INVALID_STATUS (pengganti uji serentak §5.5-5)', galat(await selesai(F.act.petA, x.tiket), 'P0001', /INVALID_STATUS/));
    });

    await sp(async () => {
      const x = await buatTiket(F.A);
      await mulai(F.act.petA, x.tiket);
      cek('finalize_pelayanan oleh FO: FORBIDDEN', ditolak(await run(F.act.fo, `SELECT public.finalize_pelayanan($1,'oss',$2::jsonb)`, [x.tiket, JSON.stringify(PAYLOAD_OSS)]), /FORBIDDEN/));
      cek('finalize_pelayanan tanpa form: INVALID_FORM', galat(await run(F.act.petA, `SELECT public.finalize_pelayanan($1,NULL,'{}'::jsonb)`, [x.tiket]), '22023', /INVALID_FORM/));
      const f = await run(F.act.petA, `SELECT public.finalize_pelayanan($1,'oss',$2::jsonb) AS r`, [x.tiket, JSON.stringify(PAYLOAD_OSS)]);
      cek('finalize_pelayanan (pembungkus) oleh pemilik: ok', f.ok && f.rows[0].r.is_locked === true, sebut(f));
      const po = (await pgq(`SELECT petugas_id, is_locked, status_draft FROM public.pelayanan_oss WHERE tiket_id=$1`, [x.tiket])).rows;
      cek('pelayanan_oss tunggal, terkunci, petugas_id = pemilik', po.length === 1 && po[0].is_locked && po[0].status_draft === 'selesai' && po[0].petugas_id === F.petA, JSON.stringify(po));
    });
  });

  await seksi('3. Draf pendataan hanya pemilik (7.5, RLS)', async () => {
    await sp(async () => {
      const x = await buatTiket(F.A);
      const ins = (a, petugas) => run(a,
        `INSERT INTO public.pelayanan_oss (tiket_id, kunjungan_id, petugas_id, nama_pemohon, nama_usaha, tindak_lanjut, uraian_solusi, status_draft, is_locked)
         VALUES ($1,$2,$3,'Budi','CV','tl','ur','draft',false)`, [x.tiket, x.kunjungan, petugas]);
      const upd = (a) => run(a, `UPDATE public.pelayanan_oss SET nama_usaha='Ubah' WHERE tiket_id=$1`, [x.tiket]);
      cek('draf saat tiket menunggu ditolak (petugas A)', ditolak(await ins(F.act.petA, F.petA)));
      cek('draf saat tiket menunggu ditolak (FO)', ditolak(await ins(F.act.fo, F.fo)));
      await mulai(F.act.petA, x.tiket);
      cek('bukan pemilik (petugas A2) tidak bisa INSERT draf', ditolak(await ins(F.act.petA2, F.petA2)));
      cek('Admin bukan pemilik tidak bisa INSERT draf', ditolak(await ins(F.act.admin, F.admin)));
      cek('pemilik INSERT draf: ok', (await ins(F.act.petA, F.petA)).ok);
      cek('pemilik UPDATE draf: 1 baris', (await upd(F.act.petA)).n === 1);
      cek('petugas A2 UPDATE draf: 0 baris', nol(await upd(F.act.petA2)));
      cek('FO UPDATE draf: 0 baris', nol(await upd(F.act.fo)));
      cek('Admin bukan pemilik UPDATE draf: 0 baris', nol(await upd(F.act.admin)));
      const aa = await ambilAlih(F.act.admin, x.tiket, 'petugas A pulang sakit');
      cek('setelah ambil alih: Admin UPDATE draf 1 baris, petugas A 0 baris', aa.ok && (await upd(F.act.admin)).n === 1 && nol(await upd(F.act.petA)), sebut(aa));
      const f = await selesai(F.act.admin, x.tiket, 'oss', PAYLOAD_OSS);
      const po = (await pgq(`SELECT petugas_id, is_locked FROM public.pelayanan_oss WHERE tiket_id=$1`, [x.tiket])).rows[0];
      cek('Admin (pemilik baru) menyelesaikan; petugas_id draf = pemilik (Admin)', f.ok && po.is_locked && po.petugas_id === F.admin, `${sebut(f)} ${JSON.stringify(po)}`);
    });
  });

  await seksi('4. admin_ambil_alih (7.2)', async () => {
    await sp(async () => {
      const x = await buatTiket(F.A);
      cek('tiket menunggu: INVALID_STATUS', galat(await ambilAlih(F.act.admin, x.tiket, 'alasan cukup'), 'P0001', /INVALID_STATUS/));
      await mulai(F.act.petA, x.tiket);
      cek('petugas: FORBIDDEN', ditolak(await ambilAlih(F.act.petA2, x.tiket, 'alasan cukup'), /FORBIDDEN/));
      cek('FO: FORBIDDEN', ditolak(await ambilAlih(F.act.fo, x.tiket, 'alasan cukup'), /FORBIDDEN/));
      cek('Admin nonaktif: FORBIDDEN', ditolak(await ambilAlih(F.act.adminOff, x.tiket, 'alasan cukup'), /FORBIDDEN/));
      cek('alasan < 5 karakter: ALASAN_WAJIB', galat(await ambilAlih(F.act.admin, x.tiket, ' abc '), '22023', /ALASAN_WAJIB/));
      cek('alasan NULL: ALASAN_WAJIB', galat(await ambilAlih(F.act.admin, x.tiket, null), '22023', /ALASAN_WAJIB/));
      const sebelum = await keadaan(x);
      const r = await ambilAlih(F.act.admin, x.tiket, '  petugas A pulang sakit  ');
      cek('Admin mengambil alih: ok, pemilik lama dilaporkan', r.ok && r.rows[0].r.pemilik_lama === F.petA && r.rows[0].r.dilayani_oleh === F.admin, sebut(r));
      const s = await keadaan(x);
      cek('dilayani_oleh = Admin; status/waktu/updated_at tidak berubah', s.dilayani_oleh === F.admin && s.t_status === 'dilayani'
        && sama(s.t_mulai, sebelum.t_mulai) && sama(s.t_upd, sebelum.t_upd) && s.v_status === 'dilayani');
      const au = (await pgq(`SELECT actor_role, detail, nilai_lama, nilai_baru FROM public.audit_log WHERE aksi='admin_ambil_alih' AND entitas_id=$1`, [x.tiket])).rows;
      cek('audit_log: 1 entri berisi pemilik lama, pemilik baru, alasan (dirapikan)', au.length === 1 && au[0].actor_role === 'admin'
        && au[0].detail.pemilik_lama === F.petA && au[0].detail.pemilik_baru === F.admin && au[0].detail.alasan === 'petugas A pulang sakit'
        && au[0].nilai_lama.dilayani_oleh === F.petA && au[0].nilai_baru.dilayani_oleh === F.admin, JSON.stringify(au));
      const r2 = await ambilAlih(F.act.admin, x.tiket, 'lagi lagi');
      cek('ambil alih tiket milik sendiri: ok sudah_milik_anda, tanpa audit tambahan', r2.ok && r2.rows[0].r.sudah_milik_anda === true
        && (await pgq(`SELECT count(*)::int n FROM public.audit_log WHERE aksi='admin_ambil_alih' AND entitas_id=$1`, [x.tiket])).rows[0].n === 1);
      cek('Admin lain dapat mengambil alih dari Admin', (await ambilAlih(F.act.admin2, x.tiket, 'shift berganti')).ok);
      cek('pemilik lama (petugas A) kini BUKAN_PEMILIK', ditolak(await selesai(F.act.petA, x.tiket), /BUKAN_PEMILIK/));
      cek('pemilik baru menyelesaikan', (await selesai(F.act.admin2, x.tiket)).ok);
    });
    await sp(async () => {
      const x = await buatTiket(F.A);
      await mulai(F.act.petA, x.tiket);
      await pgq(`UPDATE public.tiket_antrean SET dilayani_oleh = NULL WHERE id=$1`, [x.tiket]); // tiket lama tanpa pemilik (backfill gagal)
      cek('tiket dilayani tanpa pemilik: hanya bisa diselesaikan setelah ambil alih', ditolak(await selesai(F.act.petA, x.tiket), /BUKAN_PEMILIK/)
        && (await ambilAlih(F.act.admin, x.tiket, 'pemilik tidak tercatat')).ok && (await selesai(F.act.admin, x.tiket)).ok);
    });
  });

  await seksi('5. Jalur pintas tertutup: UPDATE langsung visit / tiket_antrean', async () => {
    await sp(async () => {
      const x = await buatTiket(F.A);
      cek('petugas UPDATE visit -> dilayani: TRANSISI_LEWAT_RPC', ditolak(await run(F.act.petA,
        `UPDATE public.visit SET status='dilayani', waktu_mulai_layan=now() WHERE id=$1`, [x.visit]), /TRANSISI_LEWAT_RPC/));
      cek('Admin UPDATE visit -> dilayani: TRANSISI_LEWAT_RPC', ditolak(await run(F.act.admin,
        `UPDATE public.visit SET status='dilayani' WHERE id=$1`, [x.visit]), /TRANSISI_LEWAT_RPC/));
      cek('pemilik DB (tanpa flag) juga ditolak', ditolak(await pgq(`UPDATE public.visit SET status='dilayani' WHERE id=$1`, [x.visit]), /TRANSISI_LEWAT_RPC/));
      cek('UPDATE kolom lain visit tetap boleh (petugas, layanannya)', (await run(F.act.petA, `UPDATE public.visit SET catatan_petugas='ok' WHERE id=$1`, [x.visit])).n === 1);
      cek('UPDATE langsung tiket_antrean oleh Admin: 0 baris', nol(await run(F.act.admin, `UPDATE public.tiket_antrean SET dilayani_oleh=$2 WHERE id=$1`, [x.tiket, F.admin])));
      cek('UPDATE langsung tiket_antrean oleh petugas: 0 baris', nol(await run(F.act.petA, `UPDATE public.tiket_antrean SET status='dilayani' WHERE id=$1`, [x.tiket])));
      cek('tiket tetap menunggu tanpa pemilik', (await keadaan(x)).t_status === 'menunggu' && (await keadaan(x)).dilayani_oleh === null);
      await mulai(F.act.petA, x.tiket);
      cek('petugas UPDATE visit dilayani -> selesai: TRANSISI_LEWAT_RPC', ditolak(await run(F.act.petA,
        `UPDATE public.visit SET status='selesai', waktu_selesai=now() WHERE id=$1`, [x.visit]), /TRANSISI_LEWAT_RPC/));
      info('flag lmh.antrean_rpc via PostgREST TIDAK diuji di sini: koneksi SQL langsung selalu bisa set_config; '
        + 'perlindungannya bergantung pada PostgREST yang tidak mengekspos pg_catalog.set_config (DUGAAN, sama dengan lmh.koreksi)');
    });
    await sp(async () => {
      const besok = (await pgq(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date + 1,'YYYY-MM-DD') AS d`)).rows[0].d;
      const rsv = async (nama) => (await pgq(
        `INSERT INTO public.visit (asal, pengunjung_id, nama, tujuan, tanggal_rencana, keperluan, status, layanan_id)
         VALUES ('reservasi',$1,$2,'loket',$3,'x','terjadwal',$4) RETURNING id`, [F.p_visitor, nama, besok, F.A])).rows[0].id;
      const v1 = await rsv('ZZ Resv 1');
      const sc = await run(F.act.petA, `UPDATE public.visit SET status='menunggu', waktu_scan=now(), waktu_masuk=now() WHERE id=$1`, [v1]);
      const tk = await pgq(`SELECT count(*)::int n FROM public.tiket_antrean WHERE legacy_visit_id=$1`, [v1]);
      cek('scan check-in terjadwal -> menunggu tetap jalan dan menerbitkan tiket', sc.ok && sc.n === 1 && tk.rows[0].n === 1, sebut(sc));
      const v2 = await rsv('ZZ Resv 2');
      cek('tolak reservasi terjadwal -> batal tetap jalan', (await run(F.act.petA, `UPDATE public.visit SET status='batal' WHERE id=$1`, [v2])).n === 1);
    });
  });

  await seksi('6. Tiket tanpa visit, divergensi, sesi', async () => {
    await sp(async () => {
      const k = await pgq(`INSERT INTO public.kunjungan (nama, asal, tanggal, status) VALUES ('ZZ Tanpa Visit','walk_in',$1,'menunggu') RETURNING id`, [F.hariIni]);
      const t = await pgq(`SELECT public.terbit_tiket($1,$2) AS id`, [k.rows[0].id, F.A]);
      const x = { tiket: t.rows[0].id, kunjungan: k.rows[0].id };
      const m = await mulai(F.act.petA, x.tiket);
      const s = await selesai(F.act.petA, x.tiket);
      cek('tiket tanpa legacy_visit_id: mulai & selesai tanpa galat (hanya tiket)', m.ok && s.ok && (await keadaan(x)).t_status === 'selesai', `${sebut(m)} / ${sebut(s)}`);
    });
    await sp(async () => {
      const x = await buatTiket(F.A);
      // Divergensi buatan: visit 'batal' (trigger menyalin ke tiket) lalu tiket dikembalikan ke 'menunggu' langsung.
      await pgq(`SELECT set_config('lmh.antrean_rpc','on',true)`);
      await pgq(`UPDATE public.visit SET status='batal' WHERE id=$1`, [x.visit]);
      await pgq(`SELECT set_config('lmh.antrean_rpc','off',true)`);
      await pgq(`UPDATE public.tiket_antrean SET status='menunggu' WHERE id=$1`, [x.tiket]);
      const r = await mulai(F.act.petA, x.tiket);
      const s = await keadaan(x);
      cek('visit tidak menunggu: DIVERGENSI dan rollback total (tiket tetap menunggu tanpa pemilik)',
        galat(r, 'P0001', /DIVERGENSI/) && s.t_status === 'menunggu' && s.dilayani_oleh === null && s.v_status === 'batal', `${sebut(r)} ${JSON.stringify(s)}`);
    });
    await sp(async () => {
      const x = await buatTiket(F.A);
      const sidLama = randomUUID();
      const sidBaru = randomUUID();
      await pgq(`INSERT INTO public.sesi_staf (user_id, session_id) VALUES ($1,$2)`, [F.uid.petA, sidBaru]);
      cek('sesi digantikan (klaim session_id lama): SESI_TIDAK_SAH', ditolak(await mulai(asUser(F.uid.petA, { session_id: sidLama }), x.tiket), /SESI_TIDAK_SAH/));
      cek('sesi sah (klaim = baris): ok', (await mulai(asUser(F.uid.petA, { session_id: sidBaru }), x.tiket)).ok);
      await pgq(`UPDATE public.sesi_staf SET aktivitas_at = now() - interval '5 hours' WHERE user_id=$1`, [F.uid.petA]);
      cek('sesi idle: layanan_selesai SESI_TIDAK_SAH', ditolak(await selesai(asUser(F.uid.petA, { session_id: sidBaru }), x.tiket), /SESI_TIDAK_SAH/));
      cek('sesi idle: admin_ambil_alih juga SESI_TIDAK_SAH (bila Admin idle)', await (async () => {
        await pgq(`INSERT INTO public.sesi_staf (user_id, session_id, aktivitas_at) VALUES ($1,$2, now() - interval '5 hours')`, [F.uid.admin, sidLama]);
        return ditolak(await ambilAlih(asUser(F.uid.admin, { session_id: sidLama }), x.tiket, 'alasan cukup'), /SESI_TIDAK_SAH/);
      })());
    });
  });

  if (ujiAkhirHari) {
    await seksi('7. Job akhir hari tetap jalan dengan penjaga aktif (mengunci tiket menunggu hari ini!)', async () => {
      await sp(async () => {
        const a = await buatTiket(F.A);
        const b = await buatTiket(F.A);
        await mulai(F.act.petA, b.tiket);
        const r = await pgq(`SELECT public.tandai_tidak_terlayani_akhir_hari()`);
        cek('tandai_tidak_terlayani_akhir_hari berjalan', r.ok, sebut(r));
        cek('menunggu -> tidak_terlayani (tiket + visit)', (await keadaan(a)).t_status === 'tidak_terlayani' && (await keadaan(a)).v_status === 'tidak_terlayani');
        cek('tiket dilayani tidak tersentuh', (await keadaan(b)).t_status === 'dilayani' && (await keadaan(b)).dilayani_oleh === F.petA);
      });
    });
  } else {
    info('seksi job akhir hari dilewati (tambahkan --akhir-hari; job mengunci SEMUA tiket menunggu hari ini selama transaksi)');
  }
}

// ---------- main ----------
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
  await c.query("SET LOCAL statement_timeout='30s'");
  await buatFixture();

  for (const f of preFiles) {
    console.log(`\n-- prasyarat (dalam transaksi, tidak di-commit): ${f}`);
    await c.query(readFileSync(join(root, f), 'utf8'));
  }
  let snapAwal = null;
  if (applyFiles.length) {
    await siapkanBackfill();
    snapAwal = await snapshot();
    for (const f of applyFiles) {
      console.log(`\n-- menerapkan (dalam transaksi, tidak di-commit): ${f}`);
      await c.query(readFileSync(join(root, f), 'utf8'));
    }
    await ujiBackfill();
  } else {
    info('tanpa --apply: menguji state DB saat ini (migrasi harus sudah diterapkan); uji backfill dan rollback dilewati');
  }
  await fasePasca();

  if (applyFiles.length) {
    await seksi('8. Rollback migrasi mengembalikan snapshot sebelum migrasi', async () => {
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
      cek('rollback: tidak ada selisih fungsi/policy/trigger/RLS/kolom', beda.length === 0, beda.join(' | '));
      const v = await buatTiket(F.A);
      cek('setelah rollback: jalur lama UPDATE visit -> dilayani kembali jalan', (await run(F.act.petA,
        `UPDATE public.visit SET status='dilayani', waktu_mulai_layan=now() WHERE id=$1`, [v.visit])).n === 1);
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
  cek('jumlah baris tabel kunci SEBELUM == SESUDAH ROLLBACK (tidak ada perubahan permanen)',
    JSON.stringify(sebelumBaris) === JSON.stringify(sesudahBaris));
} catch (e) { console.error('hitung baris sesudah gagal:', e.message); kodeKeluar = 2; }
try { await c2.end(); } catch { /* abaikan */ }
console.log(`\nRINGKASAN: ${lulus} lolos, ${gagal.length} gagal`);
if (gagal.length) { for (const g of gagal) console.log(' - ' + g); kodeKeluar = kodeKeluar || 1; }
process.exit(kodeKeluar);
