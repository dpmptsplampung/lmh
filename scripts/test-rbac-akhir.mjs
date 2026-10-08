// RBAC akhir (kelola layanan + buku tamu + audit): tes PERILAKU (SET LOCAL ROLE + request.jwt.claims, satu transaksi yang SELALU di-ROLLBACK).
// Pakai: node scripts/test-rbac-akhir.mjs --pre <migrasi prasyarat>... --apply supabase/migrations/202610090004_kelola_layanan_audit.sql
//   --pre = diterapkan dulu (dalam transaksi) TANPA di-rollback; --apply = yang diuji + diuji rollback-nya.
//   (PRA snapshot, terapkan di DALAM transaksi, uji, jalankan rollback docs/rollback-rbac-tahap1-<id>.sql, bandingkan snapshot, ROLLBACK).
//   tanpa --apply: menguji state DB saat ini. Tidak pernah COMMIT. Data uji sintetis; jumlah baris dibandingkan sebelum/sesudah.
// Harness diturunkan dari scripts/test-rbac-tahap0.mjs.
import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
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
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--apply') applyFiles.push(argv[++i]);
  else if (argv[i] === '--pre') preFiles.push(argv[++i]);
}

// F3: tolak berkas yang memuat kontrol transaksi (akan merusak transaksi pembungkus/ROLLBACK).
const rollbackFiles = applyFiles
  .map((f) => { const m = basename(f).match(/^(\d{12})_/); return m ? `docs/rollback-rbac-akhir-${m[1]}.sql` : null; })
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
const asUser = (uid) => ({ dbRole: 'authenticated', claims: { sub: uid, role: 'authenticated' } });

async function setActor(a) {
  await c.query('RESET ROLE');
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [a.claims ? JSON.stringify(a.claims) : '']);
  if (a.dbRole) await c.query(`SET LOCAL ROLE ${a.dbRole}`);
}
// Satu pernyataan; efek berhasil dipertahankan sampai sp() luar di-rollback.
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
// Skenario terisolasi: semua efek di-rollback di akhir.
async function sp(fn) {
  const name = `s${++spN}`;
  await c.query(`SAVEPOINT ${name}`);
  try { return await fn(); } finally {
    await c.query('RESET ROLE');
    await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }
}
const pgq = (sql, params) => run(POSTGRES, sql, params);

// SQLSTATE ketat: 42501 (insufficient_privilege: EXECUTE dicabut, RLS, atau RAISE ... ERRCODE '42501').
const ditolak = (r, re) => !r.ok && r.code === '42501' && (!re || re.test(r.msg));
const nol = (r) => r.ok && r.n === 0;
// UPDATE/DELETE ditolak RLS = 0 baris (tanpa galat). INSERT ditolak RLS = 42501.

// ---------- fixture ----------
const F = {};
async function buatFixture() {
  const ids = {};
  for (const k of ['visitor', 'visitor2', 'admin', 'adminOff', 'fo', 'petA', 'petB', 'petOff']) ids[k] = randomUUID();
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
    for (let h = 1; h <= 7; h++) { // buka 7 hari: tes tidak bergantung hari
      await pgq(`INSERT INTO public.jadwal_standby (layanan_id, hari, aktif) VALUES ($1,$2,true)`, [l, h]);
    }
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
  await pet('adminOff', 'admin', null, false);
  await pet('fo', 'front_office', null, true);
  await pet('petA', 'petugas', F.A, true);
  await pet('petB', 'petugas', F.B, true);
  await pet('petOff', 'petugas', F.A, false);
  for (const k of ['visitor', 'visitor2']) {
    const r = await pgq(`INSERT INTO public.pengunjung (auth_user_id, nama) VALUES ($1,$2) RETURNING id`, [ids[k], `ZZ ${k}`]);
    if (!r.ok) throw new Error(`fixture pengunjung ${k}: ${r.msg}`);
    F['p_' + k] = r.rows[0].id;
  }
  F.act = Object.fromEntries(Object.entries(ids).map(([k, u]) => [k, asUser(u)]));
  F.hariIni = (await pgq(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS d`)).rows[0].d;
}

// ---------- skenario check-in (bukti tidak putus) ----------
async function checkinWalkIn(label, { dgnPengunjung }) {
  return sp(async () => {
    const payload = [
      'walk_in', 'ZZ Tamu', 'perlu cek', F.A, 'loket', 'menunggu', new Date().toISOString(), randomUUID(),
      dgnPengunjung ? F.p_visitor : null,
    ];
    const ins = await run(F.act.visitor,
      `INSERT INTO public.visit (asal, nama, keperluan, layanan_id, tujuan, status, waktu_masuk, client_request_id, pengunjung_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, payload);
    const vis = await pgq(`SELECT id FROM public.visit WHERE nama='ZZ Tamu' AND layanan_id=$1`, [F.A]);
    const kj = await pgq(`SELECT k.id, t.id AS tiket, t.nomor_display FROM public.kunjungan k
                          LEFT JOIN public.tiket_antrean t ON t.kunjungan_id = k.id WHERE k.nama='ZZ Tamu'`);
    const ok = ins.ok && vis.rows?.length === 1 && kj.rows?.length === 1 && !!kj.rows[0].tiket;
    cek(label, ok, ins.ok ? `kunjungan=${kj.rows?.length} tiket=${kj.rows?.[0]?.tiket ? 'ada' : 'TIDAK'}` : `${ins.code} ${ins.msg}`);
  });
}
async function checkinReservasi(label) {
  return sp(async () => {
    const besok = (await pgq(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date + 1,'YYYY-MM-DD') AS d`)).rows[0].d;
    const ins = await run(F.act.visitor,
      `INSERT INTO public.visit (asal, pengunjung_id, nama, tujuan, tanggal_rencana, keperluan, status, layanan_id)
       VALUES ('reservasi',$1,'ZZ Reservasi','loket',$2,'x','terjadwal',$3)`, [F.p_visitor, besok, F.A]);
    cek(label, ins.ok, ins.ok ? '' : `${ins.code} ${ins.msg}`);
  });
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
  const cr = await pgq(`SELECT jobname AS k, active::text||' '||schedule AS v FROM cron.job`);
  for (const r of cr.rows) m.set(`cron:${r.k}`, r.v);
  const tb = await pgq(`SELECT c.relname AS k, c.relrowsecurity::text||' '||c.relforcerowsecurity::text AS v FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'`);
  for (const r of tb.rows) m.set(`rls:${r.k}`, r.v);
  const tg = await pgq(`SELECT c.relname||'.'||t.tgname AS k, md5(pg_get_triggerdef(t.oid)) AS v FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`);
  for (const r of tg.rows) m.set(`trigger:${r.k}`, r.v);
  const vw = await pgq(`SELECT c.relname AS k, md5(regexp_replace(pg_get_viewdef(c.oid),'[[:space:]]+','','g')) AS v FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='v'`);
  for (const r of vw.rows) m.set(`view:${r.k}`, r.v);
  const col = await pgq(`SELECT table_name||'.'||column_name AS k, data_type AS v FROM information_schema.columns WHERE table_schema='public'`);
  for (const r of col.rows) m.set(`col:${r.k}`, r.v);
  return m;
}
function selisih(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k)).sort();
}

// ---------- pembungkus seksi ----------
async function seksi(judul, fn) {
  console.log(`\n== ${judul} ==`);
  try { await fn(); } catch (e) { cek(`${judul}: seksi berhenti karena galat tak terduga`, false, e.message); }
}


// ---------- helper ----------
const sebut = (r) => (r.ok ? `ok n=${r.n}` : `${r.code} ${r.msg}`);
const SERVICE = { dbRole: 'service_role', claims: { role: 'service_role' } };
const auditBaru = async (sql, params) => (await pgq(sql, params)).rows ?? [];

async function hitungBaris(cl) {
  const r = await cl.query(`SELECT
    (SELECT count(*) FROM public.petugas)::int AS petugas, (SELECT count(*) FROM public.layanan)::int AS layanan,
    (SELECT count(*) FROM public.kunjungan)::int AS kunjungan, (SELECT count(*) FROM public.visit)::int AS visit,
    (SELECT count(*) FROM public.tiket_antrean)::int AS tiket_antrean, (SELECT count(*) FROM public.audit_log)::int AS audit_log,
    (SELECT count(*) FROM public.buku_tamu)::int AS buku_tamu, (SELECT count(*) FROM public.site_settings)::int AS site_settings,
    (SELECT count(*) FROM public.landing_content)::int AS landing_content, (SELECT count(*) FROM public.faq_knowledge_base)::int AS faq,
    (SELECT count(*) FROM public.layar_token)::int AS layar_token, (SELECT count(*) FROM auth.users)::int AS auth_users`);
  return r.rows[0];
}

// ---------- fase PASCA migrasi ----------
async function fasePasca() {
  await pgq(`SELECT set_config('lmh.izinkan_jam_tutup','on',true)`); // bypass resmi guard 0005 untuk tes
  await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);

  await seksi('1. Layanan: tampil di layar TV + daftar publik', async () => {
    await sp(async () => {
      const v = (a, sql, p) => run(a, sql, p);
      const nama = async (a, view) => (await v(a, `SELECT layanan_nama AS n FROM public.${view} WHERE layanan_nama IN ('ZZ-TES-A','ZZ-TES-B') ORDER BY 1`)).rows?.map((r) => r.n) ?? [];
      cek('layar TV (anon) menampilkan A dan B secara default', JSON.stringify(await nama(ANON, 'v_layar_antrian')) === '["ZZ-TES-A","ZZ-TES-B"]');
      cek('FO tidak bisa mengubah layanan (0 baris)', nol(await v(F.act.fo, `UPDATE public.layanan SET tampil_di_layar=false WHERE id=$1`, [F.A])));
      cek('petugas A tidak bisa mengubah layanannya (0 baris)', nol(await v(F.act.petA, `UPDATE public.layanan SET nomor_loket='9' WHERE id=$1`, [F.A])));
      cek('pengunjung tidak bisa mengubah layanan (0 baris)', nol(await v(F.act.visitor, `UPDATE public.layanan SET punya_chat=false WHERE id=$1`, [F.A])));
      const adm = await v(F.act.admin, `UPDATE public.layanan SET tampil_di_layar=false, nomor_loket='3', prefiks_antrean='ZA' WHERE id=$1`, [F.A]);
      cek('Admin mengubah tampil_di_layar/nomor_loket/prefiks', adm.ok && adm.n === 1, sebut(adm));
      cek('layar TV tidak lagi memuat A (B tetap)', JSON.stringify(await nama(ANON, 'v_layar_antrian')) === '["ZZ-TES-B"]');
      cek('Admin NONAKTIF tidak bisa mengubah layanan (0 baris)', nol(await v(F.act.adminOff, `UPDATE public.layanan SET nomor_loket='x' WHERE id=$1`, [F.A])));

      const pub = async (a) => (await v(a, `SELECT nama, status_tampilan FROM public.v_layanan_publik WHERE nama IN ('ZZ-TES-A','ZZ-TES-B') ORDER BY 1`)).rows ?? [];
      cek('v_layanan_publik (anon): A dan B tampil', (await pub(ANON)).length === 2);
      await v(F.act.admin, `UPDATE public.layanan SET status_tampilan='coming_soon' WHERE id=$1`, [F.A]);
      const cs = await pub(ANON);
      cek('coming_soon tetap tampil (diberi label segera)', cs.length === 2 && cs[0].status_tampilan === 'coming_soon');
      await v(F.act.admin, `UPDATE public.layanan SET status_tampilan='nonaktif' WHERE id=$1`, [F.A]);
      cek('nonaktif (sembunyi) hilang dari daftar publik, anon', JSON.stringify((await pub(ANON)).map((r) => r.nama)) === '["ZZ-TES-B"]');
      cek('nonaktif hilang dari daftar publik, pengunjung login', (await pub(F.act.visitor)).length === 1);
      cek('anon tetap bisa membaca tabel layanan (halaman lain tidak putus)', (await v(ANON, `SELECT id FROM public.layanan WHERE id=$1`, [F.A])).n === 1);
      cek('prefiks unik: duplikat ditolak (23505)', (await v(F.act.admin, `UPDATE public.layanan SET prefiks_antrean='ZA' WHERE id=$1`, [F.B])).code === '23505');

      // Check-in TIDAK putus walau layanan disembunyikan dari publik & layar.
      await checkinWalkIn('check-in walk-in ke layanan SEMBUNYI + tidak tampil di layar tetap menerbitkan kunjungan+tiket', { dgnPengunjung: true });
      await checkinReservasi('reservasi ke layanan sembunyi tetap bisa dibuat');
    });
  });

  await seksi('2. Buku tamu: Admin/FO saja', async () => {
    await sp(async () => {
      const ins = (a, oleh, nama = 'ZZ Tamu BT') => run(a,
        `INSERT INTO public.buku_tamu (nama, asal, menemui_siapa, keperluan, dicatat_oleh) VALUES ($1,'CV X','Kabid','Audiensi',$2)`, [nama, oleh]);
      cek('FO menambah tamu (dicatat_oleh = dirinya)', (await ins(F.act.fo, F.fo)).ok);
      cek('Admin menambah tamu', (await ins(F.act.admin, F.admin, 'ZZ Tamu BT2')).ok);
      cek('FO tidak bisa memalsukan dicatat_oleh (42501)', ditolak(await ins(F.act.fo, F.admin)));
      cek('FO tidak bisa dicatat_oleh NULL (42501)', ditolak(await ins(F.act.fo, null)));
      cek('petugas tidak bisa menambah (42501)', ditolak(await ins(F.act.petA, F.petA)));
      cek('pengunjung tidak bisa menambah (42501)', ditolak(await ins(F.act.visitor, F.fo)));
      cek('anon tidak bisa menambah (42501)', ditolak(await ins(ANON, F.fo)));
      cek('Admin nonaktif tidak bisa menambah (42501)', ditolak(await ins(F.act.adminOff, F.adminOff)));
      cek('FO membaca 2 tamu', (await run(F.act.fo, `SELECT count(*)::int n FROM public.buku_tamu WHERE nama LIKE 'ZZ Tamu BT%'`)).rows?.[0]?.n === 2);
      cek('petugas tidak melihat buku tamu (0)', (await run(F.act.petA, `SELECT count(*)::int n FROM public.buku_tamu WHERE nama LIKE 'ZZ Tamu BT%'`)).rows?.[0]?.n === 0);
      cek('FO tidak bisa mengubah tamu (0 baris)', nol(await run(F.act.fo, `UPDATE public.buku_tamu SET nama='X' WHERE nama LIKE 'ZZ Tamu BT%'`)));
      cek('FO tidak bisa menghapus tamu (0 baris)', nol(await run(F.act.fo, `DELETE FROM public.buku_tamu WHERE nama LIKE 'ZZ Tamu BT%'`)));
      cek('Admin mengubah tamu', (await run(F.act.admin, `UPDATE public.buku_tamu SET keperluan='koreksi' WHERE nama='ZZ Tamu BT2'`)).n === 1);
      cek('Admin menghapus tamu', (await run(F.act.admin, `DELETE FROM public.buku_tamu WHERE nama='ZZ Tamu BT2'`)).n === 1);
    });
  });

  await seksi('3. Audit: tulis langsung ditutup (S14), baca Admin saja', async () => {
    await sp(async () => {
      const ins = (a) => run(a, `INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas) VALUES ($1,'admin','palsu','x')`, [a.claims?.sub ?? null]);
      cek('Admin tidak bisa INSERT langsung audit_log (42501)', ditolak(await ins(F.act.admin)));
      cek('FO tidak bisa INSERT langsung (42501)', ditolak(await ins(F.act.fo)));
      cek('petugas tidak bisa memalsukan audit atas namanya (42501)', ditolak(await ins(F.act.petA)));
      cek('pengunjung tidak bisa INSERT (42501)', ditolak(await ins(F.act.visitor)));
      cek('anon tidak bisa INSERT (42501)', ditolak(await ins(ANON)));
      cek('Admin tidak bisa UPDATE audit_log (42501)', ditolak(await run(F.act.admin, `UPDATE public.audit_log SET aksi='x' WHERE false`)));
      cek('Admin tidak bisa DELETE audit_log (42501)', ditolak(await run(F.act.admin, `DELETE FROM public.audit_log WHERE false`)));
      cek('service_role (route server) masih bisa menulis audit_log',
        (await run(SERVICE, `INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id) VALUES (null,'admin','tes_server','zz','1')`)).ok);

      // Penulis sah lain tetap jalan: trigger definer baseline (petugas INSERT) setelah pencabutan.
      const u = randomUUID();
      await pgq(`INSERT INTO auth.users (id, aud, role, email) VALUES ($1,'authenticated','authenticated','zz-tes-baru@example.invalid')`, [u]);
      const sebelum = (await pgq(`SELECT count(*)::int n FROM public.audit_log WHERE aksi='insert_petugas'`)).rows[0].n;
      const pb = await pgq(`INSERT INTO public.petugas (auth_user_id, nama, role, aktif) VALUES ($1,'ZZ Baru','admin',true)`, [u]);
      const sesudah = (await pgq(`SELECT count(*)::int n FROM public.audit_log WHERE aksi='insert_petugas'`)).rows[0].n;
      cek('trigger definer baseline (audit_change) tetap menulis audit_log', pb.ok && sesudah === sebelum + 1, sebut(pb));

      // Baca
      await pgq(`INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas) VALUES (null,'system','zz_baca','zz')`);
      const baca = (a) => run(a, `SELECT count(*)::int n FROM public.audit_log WHERE aksi='zz_baca'`);
      cek('Admin membaca audit_log', (await baca(F.act.admin)).rows?.[0]?.n === 1);
      cek('FO tidak melihat audit_log (0)', (await baca(F.act.fo)).rows?.[0]?.n === 0);
      cek('petugas tidak melihat audit_log (0)', (await baca(F.act.petA)).rows?.[0]?.n === 0);
      cek('Admin NONAKTIF tidak melihat audit_log (0)', (await baca(F.act.adminOff)).rows?.[0]?.n === 0);
      cek('anon ditolak membaca audit_log (42501)', ditolak(await baca(ANON)));
    });
  });

  await seksi('4. Trigger audit: layanan/jadwal/libur/site_settings/landing/FAQ/token layar/petugas', async () => {
    await sp(async () => {
      const ambil = (entitas, aksi) => auditBaru(
        `SELECT actor_id, actor_role, aksi, entitas_id, nilai_lama, nilai_baru FROM public.audit_log WHERE entitas=$1 AND aksi=$2 ORDER BY id DESC`, [entitas, aksi]);

      // layanan: pelaku Admin tercatat, hanya kolom berubah
      await run(F.act.admin, `UPDATE public.layanan SET nomor_loket='7', punya_chat=false WHERE id=$1`, [F.B]);
      let r = (await ambil('layanan', 'layanan_ubah')).find((x) => x.entitas_id === F.B);
      cek('layanan_ubah: pelaku=Admin, entitas_id=layanan, role=admin', !!r && r.actor_id === F.uid.admin && r.actor_role === 'admin', JSON.stringify(r));
      cek('layanan_ubah: nilai_baru hanya kolom yang berubah', !!r && JSON.stringify(Object.keys(r.nilai_baru).sort()) === '["nomor_loket","punya_chat"]' && r.nilai_baru.nomor_loket === '7' && r.nilai_baru.punya_chat === false, JSON.stringify(r?.nilai_baru));
      cek('layanan_ubah: nilai_lama memuat punya_chat=true', !!r && r.nilai_lama.punya_chat === true);
      const n0 = (await ambil('layanan', 'layanan_ubah')).length;
      await run(F.act.admin, `UPDATE public.layanan SET nomor_loket='7' WHERE id=$1`, [F.B]);
      cek('UPDATE tanpa perubahan nyata tidak membuat entri', (await ambil('layanan', 'layanan_ubah')).length === n0);

      // jadwal & libur
      await pgq(`INSERT INTO public.layanan_jadwal (layanan_id) VALUES ($1) ON CONFLICT DO NOTHING`, [F.B]); // fixture dibuat setelah seed jadwal
      await run(F.act.admin, `UPDATE public.layanan_jadwal SET jam_buka='07:30' WHERE layanan_id=$1`, [F.B]);
      r = (await ambil('layanan_jadwal', 'layanan_jadwal_ubah'))[0];
      cek('layanan_jadwal_ubah tercatat (entitas_id=layanan_id)', !!r && r.entitas_id === F.B && r.nilai_baru.jam_buka === '07:30:00', JSON.stringify(r));
      await run(F.act.admin, `INSERT INTO public.layanan_libur (layanan_id, tanggal, keterangan) VALUES ($1, '2030-01-01', 'cuti bersama')`, [F.B]);
      r = (await ambil('layanan_libur', 'layanan_libur_tambah'))[0];
      cek('layanan_libur_tambah tercatat dengan nilai_baru', !!r && r.nilai_baru.keterangan === 'cuti bersama');
      await run(F.act.admin, `DELETE FROM public.layanan_libur WHERE layanan_id=$1`, [F.B]);
      cek('layanan_libur_hapus tercatat dengan nilai_lama', ((await ambil('layanan_libur', 'layanan_libur_hapus'))[0]?.nilai_lama?.keterangan) === 'cuti bersama');

      // site_settings: nilai kunci rahasia disamarkan
      await pgq(`INSERT INTO public.site_settings (key, value) VALUES ('zz_tes_biasa','halo'), ('zz_tes_api_key','RAHASIA123')`);
      const ss = await auditBaru(`SELECT entitas_id, nilai_baru FROM public.audit_log WHERE entitas='site_settings' AND entitas_id LIKE 'zz_tes_%'`);
      cek('site_settings_tambah: nilai biasa tercatat', ss.find((x) => x.entitas_id === 'zz_tes_biasa')?.nilai_baru?.value === 'halo');
      cek('site_settings: nilai kunci rahasia disamarkan, tidak bocor', ss.find((x) => x.entitas_id === 'zz_tes_api_key')?.nilai_baru?.value === '[disamarkan]' && !JSON.stringify(ss).includes('RAHASIA123'));

      // landing_content
      await pgq(`INSERT INTO public.landing_content (section, item_key, item_value, item_order) VALUES ('zz','k','v',99)`);
      cek('landing_content_tambah tercatat', (await ambil('landing_content', 'landing_content_tambah')).length >= 1);

      // FAQ: tanpa embedding, teks panjang dipotong
      const faq = await pgq(`INSERT INTO public.faq_knowledge_base (layanan_id, pertanyaan, jawaban) VALUES ($1,'zz?',$2) RETURNING id`, [F.B, 'x'.repeat(1200)]);
      r = (await ambil('faq_knowledge_base', 'faq_knowledge_base_tambah'))[0];
      cek('FAQ tercatat tanpa kolom embedding, jawaban panjang dipotong (<=501 karakter)', faq.ok && !!r && !('embedding' in r.nilai_baru) && r.nilai_baru.jawaban.length <= 501, sebut(faq));
      await pgq(`UPDATE public.faq_knowledge_base SET jawaban='pendek' WHERE id=$1`, [faq.rows[0].id]);
      r = (await ambil('faq_knowledge_base', 'faq_knowledge_base_ubah'))[0];
      cek('FAQ ubah: hanya jawaban di nilai_baru', !!r && JSON.stringify(Object.keys(r.nilai_baru)) === '["jawaban"]');

      // token layar: nilai token TIDAK tercatat
      const lt = await pgq(`INSERT INTO public.layar_token (nama) VALUES ('ZZ layar') RETURNING token`);
      const tok = lt.rows?.[0]?.token;
      const alt = await auditBaru(`SELECT nilai_baru, detail FROM public.audit_log WHERE entitas='layar_token' ORDER BY id DESC LIMIT 1`);
      cek('layar_token_tambah tercatat tanpa nilai token', lt.ok && alt.length === 1 && !!tok && !JSON.stringify(alt).includes(tok) && alt[0].nilai_baru.nama === 'ZZ layar');

      // petugas: Admin menonaktifkan petugas B -> tercatat dgn pelaku; ubah lewat service/SQL langsung tidak dobel
      await run(F.act.admin, `UPDATE public.petugas SET aktif=false, layanan_id=$2 WHERE id=$1`, [F.petB, F.A]);
      r = (await ambil('petugas', 'petugas_ubah'))[0];
      cek('petugas_ubah: pelaku Admin, aktif & layanan_id lama->baru', !!r && r.actor_id === F.uid.admin && r.nilai_baru.aktif === false && r.nilai_lama.aktif === true && r.nilai_baru.layanan_id === F.A, JSON.stringify(r));
      const nP = (await ambil('petugas', 'petugas_ubah')).length;
      await pgq(`UPDATE public.petugas SET nama='ZZ ganti' WHERE id=$1`, [F.petA]);
      cek('perubahan petugas oleh service/SQL (tanpa auth.uid) tidak dobel dengan audit route', (await ambil('petugas', 'petugas_ubah')).length === nP);
      cek('trigger lama trg_audit_petugas_role digantikan', (await pgq(`SELECT count(*)::int n FROM pg_trigger WHERE tgname='trg_audit_petugas_role' AND NOT tgisinternal`)).rows[0].n === 0);

      // fungsi internal tidak dapat dipanggil pengguna
      cek('audit_perubahan() tidak dapat dipanggil langsung', !(await run(F.act.admin, `SELECT public.audit_perubahan()`)).ok);
      cek('audit_saring() tidak dapat dipanggil pengguna (42501)', ditolak(await run(F.act.admin, `SELECT public.audit_saring('{}'::jsonb, '{}')`)));
    });
  });

  const ada0005 = (await pgq(`SELECT count(*)::int n FROM pg_policies WHERE policyname='petugas_fo_read'`)).rows[0].n === 1;
  if (ada0005) await seksi('6. Perbaikan review (0005)', async () => {
    await sp(async () => {
      const cnt = (a, w) => run(a, `SELECT count(*)::int n FROM public.petugas WHERE ${w}`);
      cek('FO membaca petugas lintas layanan (A dan B)', (await cnt(F.act.fo, `layanan_id IN ('${F.A}','${F.B}')`)).rows?.[0]?.n === 3);
      cek('FO membaca daftar petugas aktif satu layanan (query modal absensi)', (await run(F.act.fo, `SELECT id, nama FROM public.petugas WHERE layanan_id=$1 AND aktif=true`, [F.A])).n === 1);
      cek('FO: embed absensi->petugas->layanan terbaca (nama petugas)', await (async () => {
        await pgq(`INSERT INTO public.absensi_petugas (petugas_id, tanggal, status) VALUES ($1, (now() AT TIME ZONE 'Asia/Jakarta')::date, 'approved')`, [F.petA]);
        const r = await run(F.act.fo, `SELECT p.nama, l.nama AS ln FROM public.absensi_petugas a JOIN public.petugas p ON p.id=a.petugas_id LEFT JOIN public.layanan l ON l.id=p.layanan_id WHERE a.petugas_id=$1`, [F.petA]);
        return r.ok && r.rows.length === 1 && r.rows[0].nama === 'ZZ petA';
      })());
      cek('FO tidak bisa mengubah petugas (0 baris)', nol(await run(F.act.fo, `UPDATE public.petugas SET nama='X' WHERE id=$1`, [F.petA])));
      cek('FO tidak bisa menghapus petugas (0 baris)', nol(await run(F.act.fo, `DELETE FROM public.petugas WHERE id=$1`, [F.petA])));
      cek('petugas A tetap hanya melihat dirinya (1 baris)', (await cnt(F.act.petA, 'true')).rows?.[0]?.n === 1);
      cek('pengunjung tidak melihat petugas (0)', (await cnt(F.act.visitor, 'true')).rows?.[0]?.n === 0);
      cek('anon ditolak membaca petugas atau 0 baris', (await cnt(ANON, 'true')).rows?.[0]?.n === 0 || !(await cnt(ANON, 'true')).ok);
    });
    await sp(async () => {
      // Admin aktif terakhir
      await pgq(`DELETE FROM public.petugas WHERE role='admin' AND aktif AND id <> $1`, [F.admin]);
      const d = await pgq(`DELETE FROM public.petugas WHERE id=$1`, [F.admin]);
      cek('hapus Admin aktif TERAKHIR ditolak', !d.ok && /Admin aktif terakhir/.test(d.msg), sebut(d));
      const c = await pgq(`DELETE FROM auth.users WHERE id=$1`, [F.uid.admin]);
      cek('cascade dari auth.users untuk Admin terakhir juga ditolak', !c.ok && /Admin aktif terakhir/.test(c.msg), sebut(c));
    });
    await sp(async () => {
      const d = await pgq(`DELETE FROM public.petugas WHERE role='admin' AND aktif`);
      cek('hapus SEMUA admin aktif dalam satu pernyataan ditolak', !d.ok && /Admin aktif terakhir/.test(d.msg), sebut(d));
    });
    await sp(async () => {
      const d = await pgq(`DELETE FROM public.petugas WHERE id=$1`, [F.admin]);
      cek('hapus admin ketika masih ada admin aktif lain diizinkan', d.ok, sebut(d));
      cek('hapus petugas biasa diizinkan', (await pgq(`DELETE FROM public.petugas WHERE id=$1`, [F.petA])).ok);
    });
    await sp(async () => {
      await pgq(`SELECT set_config('lmh.izinkan_jam_tutup','off',true)`);
      const x = await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);
      cek('jam_tutup_layanan selain 16:00 ditolak (22023)', !x.ok && x.code === '22023', sebut(x));
      cek('jam_tutup_layanan = 16:00 diizinkan', (await pgq(`UPDATE public.site_settings SET value='16:00' WHERE key='jam_tutup_layanan'`)).ok);
      cek('INSERT kunci lain tak terpengaruh', (await pgq(`INSERT INTO public.site_settings (key,value) VALUES ('zz_lain','x')`)).ok);
    });
    cek('kolom rahasia_pengaturan.host ada', (await pgq(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='rahasia_pengaturan' AND column_name='host'`)).rows[0].n === 1);
  });
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
    snapAwal = await snapshot();
    for (const f of applyFiles) {
      console.log(`\n-- menerapkan (dalam transaksi, tidak di-commit): ${f}`);
      await c.query(readFileSync(join(root, f), 'utf8'));
    }
  } else {
    info('tanpa --apply: menguji state DB saat ini (migrasi harus sudah diterapkan)');
  }
  await fasePasca();

  if (applyFiles.length) {
    await seksi('5. Rollback migrasi mengembalikan snapshot sebelum migrasi', async () => {
      const snapSetelah = await snapshot();
      cek('snapshot setelah apply BERBEDA dari awal (uji tidak vakum)', selisih(snapAwal, snapSetelah).length > 0);
      for (const f of rollbackFiles) {
        const r = await pgq(readFileSync(join(root, f), 'utf8'));
        cek(`rollback ${f} berhasil dieksekusi`, r.ok, `${r.code ?? ''} ${r.msg ?? ''}`);
      }
      const beda = selisih(snapAwal, await snapshot());
      cek('rollback: tidak ada selisih fungsi/policy/trigger/view/RLS/kolom/cron', beda.length === 0, beda.join(' | '));
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
