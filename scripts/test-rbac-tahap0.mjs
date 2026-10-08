// RBAC Tahap 0: tes PERILAKU. Menjalankan aksi (terlarang/diizinkan) sebagai tiap pelaku
// (anon, pengunjung anon-signin, petugas aktif/nonaktif, FO, admin, admin nonaktif, service_role)
// dengan SET LOCAL ROLE + request.jwt.claims di dalam SATU transaksi yang SELALU di-ROLLBACK.
//
// Pakai:
//   node scripts/test-rbac-tahap0.mjs                       # uji state DB saat ini
//   node scripts/test-rbac-tahap0.mjs --apply supabase/migrations/202610080001_...sql [--apply ...0002...]
//        -> fase PRA (sebelum migrasi: bukti check-in jalan & celah ada), terapkan file di
//           DALAM transaksi, fase PASCA, lalu uji ROLLBACK-MIGRASI (docs/rollback-rbac-tahap0-<id>.sql
//           dalam urutan terbalik) dan bandingkan snapshot fungsi/policy/ACL/cron dengan snapshot awal.
//           Tidak pernah COMMIT.
//
// Jaminan keamanan skrip:
//  * DIRECT_URL dibaca dari .env.local (tidak dicetak). lock_timeout 3s, statement_timeout 20s.
//  * Berkas --apply / rollback ditolak bila memuat BEGIN/COMMIT/END/ROLLBACK/SAVEPOINT/RELEASE.
//  * Semua data uji sintetis (auth.users/petugas/layanan) dibuat di dalam transaksi. Data nyata hanya
//    disentuh di dalam savepoint yang di-rollback (penonaktifan admin lain utk guard "admin terakhir",
//    tandai_alpa_otomatis utk bukti F6). Jumlah baris tabel kunci dibandingkan SEBELUM BEGIN vs
//    SESUDAH ROLLBACK lewat koneksi terpisah.
//  * Tes check-in TIDAK bergantung jam/hari: layanan fixture dibuka 7 hari (jadwal_standby 1..7), tanggal
//    diambil dari DB (WIB). Satu-satunya hasil bergantung-waktu (jumlah alpa pada INFO F6) ditandai.
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
for (let i = 0; i < argv.length; i++) if (argv[i] === '--apply') applyFiles.push(argv[++i]);

// F3: tolak berkas yang memuat kontrol transaksi (akan merusak transaksi pembungkus/ROLLBACK).
const rollbackFiles = applyFiles
  .map((f) => { const m = basename(f).match(/^(\d{12})_/); return m ? `docs/rollback-rbac-tahap0-${m[1]}.sql` : null; })
  .filter((f) => f && existsSync(join(root, f)))
  .reverse();
for (const f of [...applyFiles, ...rollbackFiles]) {
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
    return { ok: false, code: e.code, msg: e.message };
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
const probe = (a, sql, params) => sp(() => run(a, sql, params));
const pgq = (sql, params) => run(POSTGRES, sql, params);

// SQLSTATE ketat: 42501 (insufficient_privilege: EXECUTE dicabut, RLS, atau RAISE ... ERRCODE '42501').
const ditolak = (r, re) => !r.ok && r.code === '42501' && (!re || re.test(r.msg));
// Galat aturan bisnis (RAISE bawaan P0001 / P0002 not found) dengan SQLSTATE yang diharapkan.
const galat = (r, code, re) => !r.ok && r.code === code && (!re || re.test(r.msg));
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

// ---------- fase PASCA ----------
async function fasePasca() {
  await seksi('1. Helper akses (S5)', async () => {
    const lyn = (k) => probe(F.act[k], 'SELECT public.get_my_layanan_id() AS v');
    cek('get_my_layanan_id petugas aktif = layanannya', (await lyn('petA')).rows?.[0]?.v === F.A);
    cek('get_my_layanan_id petugas NONAKTIF = NULL (S5)', (await lyn('petOff')).rows?.[0]?.v === null);
    cek('get_my_layanan_id pengunjung = NULL', (await lyn('visitor')).rows?.[0]?.v === null);
    const ptsp = (k) => probe(F.act[k], 'SELECT public.is_ptsp_staff() AS v');
    cek('is_ptsp_staff petugas PTSP aktif = true', (await ptsp('petA')).rows?.[0]?.v === true);
    cek('is_ptsp_staff petugas PTSP NONAKTIF = false (S5)', (await ptsp('petOff')).rows?.[0]?.v === false);
    const saya = (k) => probe(F.act[k], 'SELECT * FROM public.staf_saya()');
    cek('staf_saya aktif -> 1 baris & role benar', (await saya('fo')).rows?.[0]?.role === 'front_office');
    cek('staf_saya nonaktif -> 0 baris', (await saya('petOff')).rows?.length === 0);
    cek('staf_saya admin nonaktif -> 0 baris', (await saya('adminOff')).rows?.length === 0);
    cek('staf_saya pengunjung -> 0 baris', (await saya('visitor')).rows?.length === 0);
    const bl = (k, l) => probe(F.act[k], 'SELECT public.boleh_layanan($1) AS v', [l]);
    cek('boleh_layanan petugas A atas A', (await bl('petA', F.A)).rows?.[0]?.v === true);
    cek('boleh_layanan petugas A atas B = false', (await bl('petA', F.B)).rows?.[0]?.v === false);
    cek('boleh_layanan FO atas B', (await bl('fo', F.B)).rows?.[0]?.v === true);
    cek('boleh_layanan admin atas B', (await bl('admin', F.B)).rows?.[0]?.v === true);
    cek('boleh_layanan petugas nonaktif = false', (await bl('petOff', F.A)).rows?.[0]?.v === false);
    cek('boleh_layanan pengunjung = false', (await bl('visitor', F.A)).rows?.[0]?.v === false);
  });

  await seksi('2. Hak EXECUTE (has_function_privilege) fungsi baru/diubah/internal', async () => {
    const T = true, Fa = false;
    // [signature, {anon, authenticated, service_role}]
    const matriks = [
      ['public.staf_saya()', [Fa, T, T]],
      ['public.boleh_layanan(uuid)', [Fa, T, T]],
      ['public.petugas_set_nonaktif(uuid,text,uuid)', [Fa, T, T]],
      ['public.petugas_set_aktif(uuid)', [Fa, T, T]],
      ['public.catat_absensi(uuid,text,uuid)', [Fa, T, T]],
      ['public.catat_pulang(uuid)', [Fa, T, T]],
      ['public.setujui_absensi(uuid,text)', [Fa, T, T]],
      ['public.panggil_tiket(uuid)', [Fa, T, T]],
      ['public.get_my_layanan_id()', [Fa, T, T]],
      ['public.is_ptsp_staff()', [Fa, T, T]],
      ['public.guard_absensi_tanggal_today()', [Fa, Fa, null]],
      // internal: dicabut dari anon/authenticated, tersisa service_role
      ['public.terbit_tiket(uuid,uuid)', [Fa, Fa, T]],
      ['public.terbit_nomor_antrean(uuid,date)', [Fa, Fa, T]],
      ['public.skm_rr_tambah(uuid,text)', [Fa, Fa, T]],
      ['public.match_dokumen(extensions.vector,double precision,integer,uuid)', [Fa, Fa, T]],
    ];
    for (const [sig, [a, u, s]] of matriks) {
      const r = await pgq(
        `SELECT has_function_privilege('anon',$1::regprocedure,'EXECUTE') a,
                has_function_privilege('authenticated',$1::regprocedure,'EXECUTE') u,
                has_function_privilege('service_role',$1::regprocedure,'EXECUTE') s,
                has_function_privilege('postgres',$1::regprocedure,'EXECUTE') p,
                (SELECT count(*) FROM pg_proc q, aclexplode(q.proacl) x WHERE q.oid=$1::regprocedure AND x.grantee=0) AS publik`, [sig]);
      const x = r.rows?.[0] ?? {};
      cek(`EXECUTE ${sig}: anon=${a} authenticated=${u}${s === null ? '' : ' service_role=' + s}, PUBLIC tidak diberi`,
        r.ok && x.a === a && x.u === u && (s === null || x.s === s) && x.p === true && Number(x.publik) === 0, JSON.stringify(x) + (r.msg ?? ''));
    }
    const hx = await pgq(`SELECT has_function_privilege('supabase_auth_admin','public.set_user_role_claim(jsonb)','EXECUTE') a,
      has_function_privilege('authenticated','public.set_user_role_claim(jsonb)','EXECUTE') b,
      has_function_privilege('anon','public.set_user_role_claim(jsonb)','EXECUTE') c`);
    cek('EXECUTE set_user_role_claim: hanya supabase_auth_admin', hx.rows?.[0]?.a === true && hx.rows[0].b === false && hx.rows[0].c === false);
    const noExec = await probe(F.act.visitor, 'SELECT public.terbit_nomor_antrean($1, current_date)', [F.A]);
    cek('pengunjung memanggil terbit_nomor_antrean -> 42501', ditolak(noExec), `${noExec.code} ${noExec.msg}`);
    const noExec2 = await probe(F.act.admin, 'SELECT public.skm_rr_tambah($1, $2)', [F.A, 'dilayani']);
    cek('admin pun tidak memanggil skm_rr_tambah langsung -> 42501', ditolak(noExec2), `${noExec2.code} ${noExec2.msg}`);
    const noExec3 = await probe(F.act.visitor, 'SELECT * FROM public.match_dokumen(array_fill(0::real, ARRAY[3072])::extensions.vector, 0.1, 1, NULL)');
    cek('pengunjung memanggil match_dokumen -> 42501', ditolak(noExec3), `${noExec3.code} ${noExec3.msg}`);
    const svcOk = await probe(SERVICE, 'SELECT public.terbit_nomor_antrean($1, current_date) AS n', [F.A]);
    cek('service_role masih boleh terbit_nomor_antrean', svcOk.ok && svcOk.rows[0].n >= 1, svcOk.msg);
  });

  await seksi('3. petugas_set_nonaktif / petugas_set_aktif (S1, S11)', async () => {
    const nonaktif = (a, target, actor = F.admin) =>
      probe(a, `SELECT public.petugas_set_nonaktif($1,'uji',$2)`, [target, actor]);
    cek('anon -> 42501', ditolak(await nonaktif(ANON, F.petB)));
    cek('pengunjung anon-signin menonaktifkan petugas -> 42501', ditolak(await nonaktif(F.act.visitor, F.petB), /Admin/));
    cek('petugas aktif -> 42501', ditolak(await nonaktif(F.act.petA, F.petB), /Admin/));
    cek('petugas NONAKTIF -> 42501', ditolak(await nonaktif(F.act.petOff, F.petB), /Admin/));
    cek('FO -> 42501 (admin saja)', ditolak(await nonaktif(F.act.fo, F.petB), /Admin/));
    cek('admin NONAKTIF -> 42501', ditolak(await nonaktif(F.act.adminOff, F.petB), /Admin/));
    await sp(async () => {
      const r = await run(F.act.admin, `SELECT public.petugas_set_nonaktif($1,'uji',$2)`, [F.petB, F.fo]); // p_actor dipalsukan = FO
      const p = await pgq('SELECT aktif, nonaktif_oleh FROM public.petugas WHERE id=$1', [F.petB]);
      cek('admin aktif boleh; p_actor palsu diabaikan (nonaktif_oleh = admin pemanggil)',
        r.ok && p.rows[0].aktif === false && p.rows[0].nonaktif_oleh === F.admin, r.msg ?? JSON.stringify(p.rows[0]));
    });
    cek('admin tidak boleh menonaktifkan diri sendiri (P0001)', galat(await nonaktif(F.act.admin, F.admin), 'P0001', /sendiri/));
    cek('alasan kosong ditolak (P0001)', galat(await probe(F.act.admin, `SELECT public.petugas_set_nonaktif($1,'  ',$2)`, [F.petB, F.admin]), 'P0001', /alasan/));
    cek('petugas tidak ditemukan (P0002)', galat(await probe(F.act.admin, `SELECT public.petugas_set_nonaktif($1,'uji',$2)`, [randomUUID(), F.admin]), 'P0002'));
    await sp(async () => {
      await pgq(`UPDATE public.petugas SET aktif=false WHERE role='admin' AND aktif AND id <> $1`, [F.admin]);
      const last = await run(SERVICE, `SELECT public.petugas_set_nonaktif($1,'uji',$2)`, [F.admin, F.fo]);
      cek('Admin aktif terakhir tidak bisa dinonaktifkan (jalur service, P0001)', galat(last, 'P0001', /terakhir/), `${last.code} ${last.msg}`);
    });
    await sp(async () => {
      const r = await run(SERVICE, `SELECT public.petugas_set_nonaktif($1,'uji',$2)`, [F.petB, F.admin]);
      const p = await pgq('SELECT aktif, nonaktif_oleh FROM public.petugas WHERE id=$1', [F.petB]);
      cek('service_role (route server) boleh & p_actor dipakai', r.ok && !p.rows[0].aktif && p.rows[0].nonaktif_oleh === F.admin, r.msg);
      const back = await run(SERVICE, 'SELECT public.petugas_set_aktif($1)', [F.petB]);
      const p2 = await pgq('SELECT aktif FROM public.petugas WHERE id=$1', [F.petB]);
      cek('aktifkan kembali lewat service_role (auth.uid() NULL) berhasil (S11)', back.ok && p2.rows[0].aktif === true, back.msg);
    });
    cek('aktifkan kembali oleh pengunjung -> 42501', ditolak(await probe(F.act.visitor, 'SELECT public.petugas_set_aktif($1)', [F.petOff]), /Admin/));
    cek('aktifkan kembali oleh FO -> 42501', ditolak(await probe(F.act.fo, 'SELECT public.petugas_set_aktif($1)', [F.petOff]), /Admin/));
    await sp(async () => {
      const r = await run(F.act.admin, 'SELECT public.petugas_set_aktif($1)', [F.petOff]);
      const p = await pgq('SELECT aktif FROM public.petugas WHERE id=$1', [F.petOff]);
      cek('aktifkan kembali oleh admin aktif berhasil', r.ok && p.rows[0].aktif === true, r.msg);
    });
  });

  await seksi('4. catat_absensi / catat_pulang / setujui_absensi (S2, S3, F4)', async () => {
    const absen = (a, target, sumber, dicatat = null) =>
      probe(a, 'SELECT public.catat_absensi($1,$2,$3) AS id', [target, sumber, dicatat]);
    cek('anon -> 42501', ditolak(await absen(ANON, F.petA, 'fo')));
    cek('pengunjung catat_absensi fo -> 42501', ditolak(await absen(F.act.visitor, F.petA, 'fo'), /staf aktif/));
    cek('petugas sumber fo atas dirinya -> 42501 (S3)', ditolak(await absen(F.act.petA, F.petA, 'fo'), /Front Office/));
    cek('petugas sumber fo atas orang lain -> 42501', ditolak(await absen(F.act.petA, F.petB, 'fo'), /Front Office/));
    cek('petugas sumber otomatis -> 42501', ditolak(await absen(F.act.petA, F.petA, 'otomatis'), /sistem/));
    cek('petugas ajukan atas petugas lain -> 42501', ditolak(await absen(F.act.petA, F.petB, 'petugas_ajukan'), /diri sendiri/));
    cek('petugas NONAKTIF ajukan -> 42501', ditolak(await absen(F.act.petOff, F.petOff, 'petugas_ajukan'), /staf aktif/));
    cek('FO sumber otomatis -> 42501', ditolak(await absen(F.act.fo, F.petA, 'otomatis'), /sistem/));
    cek('sumber tidak valid ditolak (P0001)', galat(await absen(F.act.fo, F.petA, 'x'), 'P0001', /tidak valid/));
    await sp(async () => {
      const r = await run(F.act.petA, 'SELECT public.catat_absensi($1,$2,$3) AS id', [F.petA, 'petugas_ajukan', F.admin]); // dicatat_oleh dipalsukan
      const a = await pgq('SELECT status, dicatat_oleh, approved_by FROM public.absensi_petugas WHERE petugas_id=$1', [F.petA]);
      cek('petugas ajukan diri sendiri -> pending; dicatat_oleh dipaksa dari sesi; approved_by kosong',
        r.ok && a.rows[0].status === 'pending' && a.rows[0].dicatat_oleh === F.petA && a.rows[0].approved_by === null, r.msg ?? JSON.stringify(a.rows[0]));
    });
    await sp(async () => {
      const r = await run(F.act.fo, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'fo']);
      const a = await pgq('SELECT status, dicatat_oleh, approved_by FROM public.absensi_petugas WHERE petugas_id=$1', [F.petA]);
      const lh = await pgq(`SELECT status_hari FROM public.layanan_hari WHERE layanan_id=$1 AND tanggal=$2`, [F.A, F.hariIni]);
      cek('FO catat hadir petugas -> approved, dicatat_oleh=approved_by=FO, layanan_hari dibuka',
        r.ok && a.rows[0].status === 'approved' && a.rows[0].dicatat_oleh === F.fo && a.rows[0].approved_by === F.fo && lh.rows[0]?.status_hari === 'dibuka', r.msg ?? JSON.stringify(a.rows[0]));
      const nonaktifTarget = await run(F.act.fo, 'SELECT public.catat_absensi($1,$2)', [F.petOff, 'fo']);
      cek('catat hadir atas petugas NONAKTIF ditolak (P0002)', galat(nonaktifTarget, 'P0002', /nonaktif/), `${nonaktifTarget.code} ${nonaktifTarget.msg}`);
    });
    // F4: FO/admin menaikkan pending/alpa -> approved; ditolak hanya dibalik admin
    const sebelum = (status) => pgq(`INSERT INTO public.absensi_petugas (petugas_id, tanggal, status, sumber) VALUES ($1,$2,$3,'otomatis')`, [F.petA, F.hariIni, status]);
    const status = async () => (await pgq('SELECT status, approved_by FROM public.absensi_petugas WHERE petugas_id=$1', [F.petA])).rows[0];
    await sp(async () => {
      await sebelum('pending'); await run(F.act.fo, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'fo']);
      const a = await status();
      cek("F4: FO 'fo' pada baris pending -> approved (approved_by=FO)", a.status === 'approved' && a.approved_by === F.fo, JSON.stringify(a));
    });
    await sp(async () => {
      await sebelum('alpa'); await run(F.act.fo, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'fo']);
      cek("F4: FO 'fo' pada baris alpa -> approved", (await status()).status === 'approved');
    });
    await sp(async () => {
      await sebelum('ditolak'); await run(F.act.fo, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'fo']);
      const sebelumFo = await status();
      cek("F4: FO 'fo' pada baris ditolak -> tetap ditolak, approved_by TIDAK berubah (N1)", sebelumFo.status === 'ditolak' && sebelumFo.approved_by === null, JSON.stringify(sebelumFo));
      await run(F.act.admin, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'fo']);
      const sesudahAdm = await status();
      cek("F4: admin 'fo' pada baris ditolak -> approved, approved_by=admin", sesudahAdm.status === 'approved' && sesudahAdm.approved_by === F.admin, JSON.stringify(sesudahAdm));
      // N1: panggilan ulang pada baris yang sudah approved TIDAK menimpa approved_by
      await run(F.act.fo, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'fo']);
      cek('N1: baris sudah approved oleh admin; FO memanggil ulang -> approved_by tetap admin', (await status()).approved_by === F.admin);
    });
    await sp(async () => {
      await sebelum('alpa'); await run(F.act.petA, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'petugas_ajukan']);
      cek("petugas ajukan pada baris alpa -> pending (tidak approved sendiri)", (await status()).status === 'pending');
      await run(F.act.petA, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'petugas_ajukan']);
      cek('pengajuan berulang tidak mengubah pending', (await status()).status === 'pending');
    });
    await sp(async () => {
      await sebelum('ditolak'); await run(F.act.petA, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'petugas_ajukan']);
      cek('petugas ajukan pada baris ditolak -> tetap ditolak', (await status()).status === 'ditolak');
    });
    await sp(async () => {
      await sebelum('approved'); await run(F.act.petA, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'petugas_ajukan']);
      cek('petugas ajukan pada baris approved -> tetap approved', (await status()).status === 'approved');
    });
    await sp(async () => {
      await sebelum('alpa'); const r = await run(SERVICE, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'otomatis']);
      cek('service_role boleh sumber otomatis; alpa -> approved (perilaku lama)', r.ok && (await status()).status === 'approved', r.msg);
    });
    // catat_pulang
    cek('pengunjung catat_pulang -> 42501', ditolak(await probe(F.act.visitor, 'SELECT public.catat_pulang($1)', [F.petA]), /staf aktif/));
    cek('petugas catat_pulang orang lain -> 42501', ditolak(await probe(F.act.petA, 'SELECT public.catat_pulang($1)', [F.petB]), /diri sendiri/));
    cek('petugas NONAKTIF catat_pulang -> 42501', ditolak(await probe(F.act.petOff, 'SELECT public.catat_pulang($1)', [F.petOff]), /staf aktif/));
    await sp(async () => {
      await pgq(`INSERT INTO public.absensi_petugas (petugas_id, tanggal, jam_masuk, status, sumber) VALUES ($1,$2, now(),'approved','fo')`, [F.petA, F.hariIni]);
      const own = await run(F.act.petA, 'SELECT public.catat_pulang($1)', [F.petA]);
      const a = await pgq('SELECT jam_pulang FROM public.absensi_petugas WHERE petugas_id=$1', [F.petA]);
      cek('petugas catat_pulang diri sendiri berhasil', own.ok && a.rows[0].jam_pulang !== null, own.msg);
    });
    await sp(async () => {
      await pgq(`INSERT INTO public.absensi_petugas (petugas_id, tanggal, jam_masuk, status, sumber) VALUES ($1,$2, now(),'approved','fo')`, [F.petA, F.hariIni]);
      cek('FO catat_pulang petugas lain berhasil', (await run(F.act.fo, 'SELECT public.catat_pulang($1)', [F.petA])).ok);
    });
    // setujui_absensi
    await sp(async () => {
      const ins = await run(F.act.petA, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'petugas_ajukan']);
      const aid = (await pgq('SELECT id FROM public.absensi_petugas WHERE petugas_id=$1', [F.petA])).rows[0].id;
      cek('(prasyarat) petugas mengajukan hadir', ins.ok, ins.msg);
      cek('petugas menyetujui absensinya sendiri via RPC -> 42501', ditolak(await run(F.act.petA, 'SELECT public.setujui_absensi($1,$2)', [aid, 'approved']), /Front Office/));
      cek('pengunjung setujui_absensi -> 42501', ditolak(await run(F.act.visitor, 'SELECT public.setujui_absensi($1,$2)', [aid, 'approved']), /Front Office/));
      cek('petugas nonaktif setujui_absensi -> 42501', ditolak(await run(F.act.petOff, 'SELECT public.setujui_absensi($1,$2)', [aid, 'approved']), /Front Office/));
      cek('status tidak valid ditolak (P0001)', galat(await run(F.act.fo, 'SELECT public.setujui_absensi($1,$2)', [aid, 'alpa']), 'P0001'));
      const ok = await run(F.act.fo, 'SELECT public.setujui_absensi($1,$2)', [aid, 'approved']);
      const a = await pgq('SELECT status, approved_by FROM public.absensi_petugas WHERE id=$1', [aid]);
      cek('FO menyetujui -> approved, approved_by=FO (menutup M1)', ok.ok && a.rows[0].status === 'approved' && a.rows[0].approved_by === F.fo, ok.msg);
      cek('admin menolak', (await run(F.act.admin, 'SELECT public.setujui_absensi($1,$2)', [aid, 'ditolak'])).ok);
    });
  });

  await seksi('5. Tulis langsung absensi_petugas ditutup untuk non-admin (S3) + guard tanggal', async () => {
    const ins = (k, status) => probe(F.act[k],
      `INSERT INTO public.absensi_petugas (petugas_id, tanggal, jam_masuk, status, sumber) VALUES ($1,$2, now(), $3, 'petugas_ajukan')`,
      [F[k], F.hariIni, status]);
    cek('petugas INSERT absensi langsung status approved -> 42501 (RLS)', ditolak(await ins('petA', 'approved')));
    cek('petugas INSERT absensi langsung status pending -> 42501 (RLS)', ditolak(await ins('petA', 'pending')));
    cek('FO INSERT absensi langsung -> 42501 (RLS)', ditolak(await ins('fo', 'approved')));
    await sp(async () => {
      await run(F.act.petA, 'SELECT public.catat_absensi($1,$2)', [F.petA, 'petugas_ajukan']);
      const up = await run(F.act.petA, `UPDATE public.absensi_petugas SET status='approved', approved_by=$1 WHERE petugas_id=$1`, [F.petA]);
      const a = await pgq('SELECT status FROM public.absensi_petugas WHERE petugas_id=$1', [F.petA]);
      cek('petugas UPDATE absensi sendiri -> approved: 0 baris, status tetap pending', nol(up) && a.rows[0].status === 'pending', JSON.stringify(up));
      cek('FO UPDATE absensi langsung -> 0 baris (wajib lewat RPC)', nol(await run(F.act.fo, `UPDATE public.absensi_petugas SET status='approved' WHERE petugas_id=$1`, [F.petA])));
      const sel = await run(F.act.petA, 'SELECT * FROM public.absensi_petugas');
      cek('petugas masih bisa MEMBACA absensi miliknya', sel.ok && sel.n === 1, JSON.stringify(sel.n));
      const sel2 = await run(F.act.petB, 'SELECT * FROM public.absensi_petugas WHERE petugas_id=$1', [F.petA]);
      cek('petugas lain tidak bisa membaca absensi petugas A', sel2.ok && sel2.n === 0);
      const ad = await run(F.act.admin, `UPDATE public.absensi_petugas SET status='approved', approved_by=$1 WHERE petugas_id=$2`, [F.admin, F.petA]);
      cek('admin masih bisa UPDATE absensi langsung (UI admin sekarang)', ad.ok && ad.n === 1, JSON.stringify(ad));
    });
    // bug produksi: guard_absensi_tanggal_today
    const lama = await pgq(`INSERT INTO public.absensi_petugas (petugas_id, tanggal, status, sumber) VALUES ($1,(now() AT TIME ZONE 'Asia/Jakarta')::date - 1,'approved','fo')`, [F.petA]);
    cek("guard tanggal: INSERT tanggal kemarin ditolak 'harus hari ini' (bukan galat pg_catalog)", !lama.ok && /hari ini/.test(lama.msg), `${lama.code} ${lama.msg}`);
    await sp(async () => {
      const ok = await pgq(`INSERT INTO public.absensi_petugas (petugas_id, tanggal, status, sumber) VALUES ($1,$2,'pending','petugas_ajukan')`, [F.petA, F.hariIni]);
      cek('guard tanggal: INSERT absensi tanggal WIB hari ini berhasil (bug CURRENT_DATE diperbaiki)', ok.ok, `${ok.code} ${ok.msg}`);
    });
  });

  await seksi('6. panggil_tiket (S2) + S5 menyebar ke policy berbasis layanan', async () => {
    await sp(async () => {
      const v = await run(F.act.visitor,
        `INSERT INTO public.visit (asal, nama, layanan_id, tujuan, status, waktu_masuk, pengunjung_id) VALUES ('walk_in','ZZ Tamu',$1,'loket','menunggu',now(),$2)`, [F.A, F.p_visitor]);
      const t = await pgq(`SELECT t.id FROM public.tiket_antrean t JOIN public.kunjungan k ON k.id=t.kunjungan_id WHERE k.nama='ZZ Tamu'`);
      const tid = t.rows?.[0]?.id;
      cek('(prasyarat) check-in membuat tiket', v.ok && !!tid, v.msg);
      cek('pengunjung panggil_tiket -> 42501', ditolak(await run(F.act.visitor, 'SELECT public.panggil_tiket($1)', [tid]), /staf aktif/));
      cek('anon panggil_tiket -> 42501', ditolak(await run(ANON, 'SELECT public.panggil_tiket($1)', [tid])));
      cek('petugas NONAKTIF panggil_tiket -> 42501', ditolak(await run(F.act.petOff, 'SELECT public.panggil_tiket($1)', [tid]), /staf aktif/));
      cek('petugas layanan lain panggil_tiket -> 42501', ditolak(await run(F.act.petB, 'SELECT public.panggil_tiket($1)', [tid]), /layanan/));
      const ok1 = await run(F.act.petA, 'SELECT public.panggil_tiket($1) AS n', [tid]);
      cek('petugas layanan sendiri panggil_tiket -> nomor', ok1.ok && /^Z-\d{3}$/.test(ok1.rows[0].n), ok1.msg ?? ok1.rows?.[0]?.n);
      cek('FO panggil_tiket', (await run(F.act.fo, 'SELECT public.panggil_tiket($1) AS n', [tid])).ok);
      cek('admin panggil_tiket', (await run(F.act.admin, 'SELECT public.panggil_tiket($1) AS n', [tid])).ok);
      const sa = await run(F.act.petA, 'SELECT count(*)::int AS n FROM public.tiket_antrean');
      const so = await run(F.act.petOff, 'SELECT count(*)::int AS n FROM public.tiket_antrean');
      cek('S5: petugas aktif melihat tiket layanannya, petugas NONAKTIF tidak', sa.rows[0].n >= 1 && so.rows[0].n === 0, `${sa.rows?.[0]?.n}/${so.rows?.[0]?.n}`);
      const ua = await run(F.act.petA, `UPDATE public.visit SET catatan_petugas='ok' WHERE nama='ZZ Tamu'`);
      const uo = await run(F.act.petOff, `UPDATE public.visit SET catatan_petugas='ok' WHERE nama='ZZ Tamu'`);
      cek('S5: UPDATE visit layanan sendiri oleh petugas aktif ok, nonaktif 0 baris', ua.ok && ua.n === 1 && nol(uo), `${ua.n}/${uo.n}`);
      const fa = await run(F.act.petA, `INSERT INTO public.faq_knowledge_base (layanan_id, pertanyaan, jawaban) VALUES ($1,'q','j')`, [F.A]);
      const fo2 = await run(F.act.petOff, `INSERT INTO public.faq_knowledge_base (layanan_id, pertanyaan, jawaban) VALUES ($1,'q','j')`, [F.A]);
      cek('S5: FAQ layanan sendiri: petugas aktif boleh, nonaktif 42501', fa.ok && ditolak(fo2), `${fa.msg ?? ''}|${fo2.msg ?? ''}`);
    });
  });

  await seksi('7. S4: INSERT langsung kunjungan/tiket_antrean ditutup; check-in tetap jalan', async () => {
    const kj = (a) => probe(a, `INSERT INTO public.kunjungan (nama, asal, tanggal) VALUES ('palsu','walk_in',current_date)`);
    for (const [n, a] of [['anon', ANON], ['pengunjung', F.act.visitor], ['petugas', F.act.petA], ['FO', F.act.fo]]) {
      cek(`${n} INSERT kunjungan langsung -> 42501`, ditolak(await kj(a)));
    }
    await sp(async () => {
      const k = await pgq(`INSERT INTO public.kunjungan (nama, asal, tanggal) VALUES ('seed','walk_in',current_date) RETURNING id`);
      const kid = k.rows[0].id;
      for (const [n, a] of [['anon', ANON], ['pengunjung', F.act.visitor], ['petugas', F.act.petA]]) {
        const t = await run(a, `INSERT INTO public.tiket_antrean (kunjungan_id, layanan_id, tanggal, nomor, nomor_display) VALUES ($1,$2,current_date,999,'X-999')`, [kid, F.A]);
        cek(`${n} INSERT tiket_antrean langsung (tiket palsu di layar TV) -> 42501`, ditolak(t));
      }
    });
    await checkinWalkIn('CHECK-IN walk-in (api/checkin, pengunjung login anon-signin) tetap membuat visit+kunjungan+tiket', { dgnPengunjung: true });
    await checkinWalkIn('CHECK-IN walk-in tanpa pengunjung_id (null) tetap bekerja', { dgnPengunjung: false });
    await checkinReservasi('CHECK-IN reservasi (me/reservasi) tetap bekerja');
    cek('anon (tanpa login) INSERT visit -> 42501 (perilaku lama dipertahankan)', ditolak(await probe(ANON,
      `INSERT INTO public.visit (asal, nama, layanan_id, tujuan, status, waktu_masuk) VALUES ('walk_in','ZZ',$1,'loket','menunggu',now())`, [F.A])));
    const bad = (sql, params) => probe(F.act.visitor, sql, params);
    cek("pengunjung INSERT visit status 'selesai' -> 42501 (bypass SKM/tiket palsu)", ditolak(await bad(
      `INSERT INTO public.visit (asal, nama, layanan_id, tujuan, status, waktu_masuk) VALUES ('walk_in','ZZ',$1,'loket','selesai',now())`, [F.A])));
    cek("pengunjung INSERT visit status 'dilayani' -> 42501", ditolak(await bad(
      `INSERT INTO public.visit (asal, nama, layanan_id, tujuan, status, waktu_masuk) VALUES ('walk_in','ZZ',$1,'loket','dilayani',now())`, [F.A])));
    cek('pengunjung INSERT visit atas pengunjung_id orang lain -> 42501', ditolak(await bad(
      `INSERT INTO public.visit (asal, nama, layanan_id, tujuan, status, waktu_masuk, pengunjung_id) VALUES ('walk_in','ZZ',$1,'loket','menunggu',now(),$2)`, [F.A, F.p_visitor2])));
    cek('pengunjung INSERT visit dengan waktu_selesai terisi -> 42501', ditolak(await bad(
      `INSERT INTO public.visit (asal, nama, layanan_id, tujuan, status, waktu_masuk, waktu_selesai) VALUES ('walk_in','ZZ',$1,'loket','menunggu',now(),now())`, [F.A])));
    cek('rate limit walk-in tetap berlaku (7 insert berturut-turut -> ada yang 42501)', await sp(async () => {
      let ditolakAda = false;
      for (let i = 0; i < 7; i++) {
        const r = await run(F.act.visitor, `INSERT INTO public.visit (asal, nama, layanan_id, tujuan, status, waktu_masuk) VALUES ('walk_in','ZZ',$1,'loket','menunggu',now())`, [F.A]);
        if (ditolak(r)) ditolakAda = true;
      }
      return ditolakAda;
    }));
  });

  await seksi('7b. Alur turunan check-in tetap jalan setelah REVOKE (trigger -> fungsi internal)', async () => {
    await sp(async () => {
      // walk-in -> petugas layanan melayani -> selesai (trg_visit_selesai_rr -> skm_rr_tambah) -> SKM anon (trg_skm_insert_rr)
      const qr = randomUUID();
      const v = await run(F.act.visitor,
        `INSERT INTO public.visit (asal, nama, layanan_id, tujuan, status, waktu_masuk, pengunjung_id, qr_token) VALUES ('walk_in','ZZ Alur',$1,'loket','menunggu',now(),$2,$3)`,
        [F.A, F.p_visitor, qr]);
      const d = await run(F.act.petA, `UPDATE public.visit SET status='dilayani', waktu_mulai_layan=now() WHERE qr_token=$1`, [qr]);
      const f = await run(F.act.petA, `UPDATE public.visit SET status='selesai', waktu_selesai=now() WHERE qr_token=$1`, [qr]);
      const rr = await pgq(`SELECT dilayani FROM public.skm_response_rate WHERE layanan_id=$1`, [F.A]);
      const tk = await pgq(`SELECT t.status FROM public.tiket_antrean t JOIN public.kunjungan k ON k.id=t.kunjungan_id WHERE k.nama='ZZ Alur'`);
      cek('petugas melayani & menyelesaikan visit: dual-write tiket + skm_response_rate (trigger memanggil fungsi yang di-REVOKE)',
        v.ok && d.ok && f.ok && rr.rows?.[0]?.dilayani >= 1 && tk.rows?.[0]?.status === 'selesai', `${v.msg ?? ''}${d.msg ?? ''}${f.msg ?? ''}${JSON.stringify(rr.rows)}${JSON.stringify(tk.rows)}`);
      const skm = await run(ANON, `SELECT public.submit_skm_response($1,4,4,4,4,4,4,4,4,4,'ok')`, [qr]);
      const rr2 = await pgq(`SELECT mengisi FROM public.skm_response_rate WHERE layanan_id=$1`, [F.A]);
      cek('SKM anon (submit_skm_response -> trigger -> skm_rr_tambah) tetap berhasil', skm.ok && rr2.rows?.[0]?.mengisi >= 1, skm.msg ?? JSON.stringify(rr2.rows));
    });
    await sp(async () => {
      // reservasi -> scan hari-H (terbit_tiket lewat UPDATE)
      const qr = randomUUID();
      const r = await run(F.act.visitor,
        `INSERT INTO public.visit (asal, pengunjung_id, nama, tujuan, tanggal_rencana, status, layanan_id, qr_token) VALUES ('reservasi',$1,'ZZ Resv','loket',$2,'terjadwal',$3,$4)`,
        [F.p_visitor, F.hariIni, F.A, qr]);
      const sc = await run(F.act.petA, `UPDATE public.visit SET status='menunggu', waktu_scan=now(), waktu_masuk=now() WHERE qr_token=$1`, [qr]);
      const tk = await pgq(`SELECT t.id FROM public.tiket_antrean t JOIN public.kunjungan k ON k.id=t.kunjungan_id WHERE k.nama='ZZ Resv'`);
      cek('reservasi di-scan petugas -> tiket terbit (terbit_tiket via trigger)', r.ok && sc.ok && tk.rows?.length === 1, `${r.msg ?? ''}${sc.msg ?? ''}${tk.rows?.length}`);
    });
  });

  await seksi('8. N7: Auth Hook', async () => {
    const hook = async (uid) => (await pgq(`SELECT public.set_user_role_claim($1::jsonb) AS r`, [JSON.stringify({ user_id: uid, claims: { app_metadata: {} } })])).rows?.[0]?.r?.claims?.app_metadata?.role;
    cek('hook: admin aktif -> admin', (await hook(F.uid.admin)) === 'admin');
    cek('hook: FO aktif -> front_office', (await hook(F.uid.fo)) === 'front_office');
    cek('hook: petugas aktif -> petugas', (await hook(F.uid.petA)) === 'petugas');
    cek('hook: petugas NONAKTIF -> pengunjung (N7)', (await hook(F.uid.petOff)) === 'pengunjung');
    cek('hook: admin NONAKTIF -> pengunjung (N7)', (await hook(F.uid.adminOff)) === 'pengunjung');
    cek('hook: pengunjung -> pengunjung', (await hook(F.uid.visitor)) === 'pengunjung');
  });

  await seksi('9. F6: guard diperbaiki + cron alpa dijeda', async () => {
    const job = await pgq(`SELECT active FROM cron.job WHERE jobname='absensi_alpa_otomatis'`);
    cek("cron 'absensi_alpa_otomatis' DIJEDA (active=false) setelah migrasi", job.rows?.[0]?.active === false, JSON.stringify(job.rows));
    await sp(async () => {
      // BUKTI DAMPAK F6 (data nyata, di dalam savepoint yang di-rollback): jalankan fungsi cron seolah sudah lewat batas jam.
      await pgq(`UPDATE public.site_settings SET value='00:00' WHERE key='batas_jam_alpa'`);
      const sebelum = (await pgq(`SELECT count(*)::int n FROM public.absensi_petugas`)).rows[0].n;
      const r = await run(SERVICE, 'SELECT public.tandai_alpa_otomatis() AS n');
      const sesudah = await pgq(`SELECT count(*)::int n, count(DISTINCT pt.layanan_id)::int layanan FROM public.absensi_petugas a JOIN public.petugas pt ON pt.id=a.petugas_id
        WHERE a.tanggal=$1 AND a.status='alpa' AND pt.nama NOT LIKE 'ZZ %'`, [F.hariIni]);
      const lh = await pgq(`SELECT count(*)::int n FROM public.layanan_hari h JOIN public.layanan l ON l.id=h.layanan_id WHERE h.tanggal=$1 AND h.status_hari='alpa' AND l.nama NOT LIKE 'ZZ-TES%'`, [F.hariIni]);
      cek('tandai_alpa_otomatis() tidak lagi galat setelah guard diperbaiki', r.ok, r.msg);
      info(`F6 AKUN NYATA (BERGANTUNG HARI: 0 pada akhir pekan/libur) bila cron dinyalakan pukul 10:00 WIB: layanan_hari 'alpa'=${lh.rows?.[0]?.n} layanan, baris absensi 'alpa'=${sesudah.rows?.[0]?.n} petugas di ${sesudah.rows?.[0]?.layanan} layanan (sebelum=${sebelum} baris)`);
    });
  });

  await seksi('10. S6 + keputusan CEO: layanan & jadwal (bergantung 202610080002)', async () => {
    const sudah0002 = (await pgq(`SELECT 1 FROM pg_policies WHERE tablename='layanan' AND policyname='layanan_petugas_chatbot_toggle'`)).n === 0;
    info(sudah0002 ? 'migrasi 0002 TERDETEKSI (policy toggle petugas sudah tidak ada)' : 'migrasi 0002 BELUM diterapkan (hak tulis lama masih ada, sesuai rencana bertahap)');
    const insJadwal = (a) => probe(a, `INSERT INTO public.layanan_jadwal (layanan_id) VALUES ($1) ON CONFLICT (layanan_id) DO UPDATE SET jam_buka='07:00'`, [F.B]);
    const insLibur = (a) => probe(a, `INSERT INTO public.layanan_libur (layanan_id, tanggal, keterangan) VALUES ($1,current_date,'x')`, [F.B]);
    const insStandby = (a) => probe(a, `INSERT INTO public.jadwal_standby (layanan_id, hari) VALUES ($1,1) ON CONFLICT (layanan_id, hari) DO UPDATE SET jam_mulai='07:00'`, [F.B]);
    const insPeng = (a) => probe(a, `INSERT INTO public.jadwal_pengecualian (layanan_id, tanggal, jenis, alasan) VALUES ($1,current_date,'libur','x')`, [F.B]);
    const insHari = (a) => probe(a, `INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari) VALUES ($1,$2,'dibuka') ON CONFLICT (layanan_id, tanggal) DO UPDATE SET status_hari='dibuka'`, [F.B, F.hariIni]);
    const toggle = (k) => probe(F.act[k], `UPDATE public.layanan SET chatbot_aktif = NOT chatbot_aktif WHERE id=$1`, [F.A]);

    cek('admin selalu bisa UPDATE layanan', (await probe(F.act.admin, `UPDATE public.layanan SET chatbot_aktif = true WHERE id=$1`, [F.A])).n === 1);
    cek('S5: petugas NONAKTIF tidak bisa UPDATE layanan (di kedua state)', nol(await toggle('petOff')));
    cek('admin boleh tulis layanan_jadwal / layanan_libur / jadwal_standby / jadwal_pengecualian (di kedua state)',
      (await insJadwal(F.act.admin)).ok && (await insLibur(F.act.admin)).ok && (await insStandby(F.act.admin)).ok && (await insPeng(F.act.admin)).ok);
    cek('FO tetap bisa menulis layanan_hari (di kedua state; dipakai FO/definer)', (await insHari(F.act.fo)).ok);
    cek('admin boleh menulis layanan_hari', (await insHari(F.act.admin)).ok);
    cek('baca publik jadwal_standby/layanan_jadwal tetap bisa (anon)', (await probe(ANON, 'SELECT count(*)::int AS n FROM public.jadwal_standby')).ok);
    cek('petugas aktif tetap bisa MEMBACA jadwal_standby', (await probe(F.act.petA, 'SELECT count(*)::int AS n FROM public.jadwal_standby')).rows?.[0]?.n > 0);
    if (sudah0002) {
      const tg = await toggle('petA');
      cek('0002: petugas tidak bisa toggle chatbot_aktif (0 baris)', nol(tg), JSON.stringify(tg));
      cek('0002: petugas tidak bisa menaikkan is_ptsp (eskalasi hak)', nol(await probe(F.act.petB, `UPDATE public.layanan SET is_ptsp = true WHERE id=$1`, [F.B])));
      cek('0002: petugas layanan PTSP tidak bisa menulis jadwal layanan lain -> 42501', ditolak(await insJadwal(F.act.petA)));
      cek('0002: petugas PTSP tidak bisa menulis libur layanan lain -> 42501', ditolak(await insLibur(F.act.petA)));
      for (const [nama, fn] of [['layanan_jadwal', insJadwal], ['layanan_libur', insLibur], ['jadwal_standby', insStandby], ['jadwal_pengecualian', insPeng]]) {
        cek(`0002: FO tidak bisa menulis ${nama} -> 42501`, ditolak(await fn(F.act.fo)));
        cek(`0002: petugas tidak bisa menulis ${nama} -> 42501`, ditolak(await fn(F.act.petA)));
        cek(`0002: pengunjung tidak bisa menulis ${nama} -> 42501`, ditolak(await fn(F.act.visitor)));
      }
      cek('0002: FO tidak bisa UPDATE/DELETE jadwal_standby (0 baris)', nol(await probe(F.act.fo, `UPDATE public.jadwal_standby SET aktif=false WHERE layanan_id=$1`, [F.A])) && nol(await probe(F.act.fo, `DELETE FROM public.jadwal_standby WHERE layanan_id=$1`, [F.A])));
      cek('0002: admin NONAKTIF tidak bisa menulis jadwal -> 42501', ditolak(await insJadwal(F.act.adminOff)));
    } else {
      const tg = await toggle('petA');
      info(`state saat ini: petugas toggle chatbot_aktif n=${tg.n}; FO menulis layanan_jadwal ok=${(await insJadwal(F.act.fo)).ok}`);
    }
  });
}

// ---------- main ----------
async function hitungBaris(cl) {
  const r = await cl.query(`SELECT
    (SELECT count(*) FROM public.petugas)::int AS petugas, (SELECT count(*) FROM public.kunjungan)::int AS kunjungan,
    (SELECT count(*) FROM public.visit)::int AS visit, (SELECT count(*) FROM public.absensi_petugas)::int AS absensi_petugas,
    (SELECT count(*) FROM public.tiket_antrean)::int AS tiket_antrean, (SELECT count(*) FROM public.layanan)::int AS layanan,
    (SELECT count(*) FROM public.layanan_hari)::int AS layanan_hari, (SELECT count(*) FROM public.audit_log)::int AS audit_log,
    (SELECT count(*) FROM auth.users)::int AS auth_users,
    (SELECT active::text FROM cron.job WHERE jobname='absensi_alpa_otomatis') AS cron_alpa_aktif,
    (SELECT value FROM public.site_settings WHERE key='batas_jam_alpa') AS batas_jam_alpa`);
  return r.rows[0];
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
  await c.query("SET LOCAL statement_timeout='20s'");
  await buatFixture();

  let snapAwal = null;
  if (applyFiles.length) {
    console.log('\n== PRA-MIGRASI (state produksi saat ini) ==');
    await checkinWalkIn('PRA: check-in walk-in jalan', { dgnPengunjung: true });
    await checkinReservasi('PRA: check-in reservasi jalan');
    const pra = await probe(ANON, `INSERT INTO public.kunjungan (nama, asal, tanggal) VALUES ('palsu','walk_in',current_date)`);
    info(`PRA: anon INSERT kunjungan langsung -> ${pra.ok ? 'DIIZINKAN (celah S4 terkonfirmasi)' : 'ditolak (' + pra.msg + ')'}`);
    const praRpc = await probe(F.act.visitor, `SELECT public.petugas_set_nonaktif($1,'x',$2)`, [F.petB, F.admin]);
    info(`PRA: pengunjung memanggil petugas_set_nonaktif -> ${praRpc.ok ? 'DIIZINKAN (celah S1 terkonfirmasi)' : 'ditolak (' + praRpc.msg + ')'}`);
    const praAbs = await probe(F.act.admin, `INSERT INTO public.absensi_petugas (petugas_id, tanggal, status) VALUES ($1,(now() AT TIME ZONE 'Asia/Jakarta')::date,'pending')`, [F.petA]);
    info(`PRA: INSERT absensi_petugas -> ${praAbs.ok ? 'berhasil' : 'GAGAL (bug guard_absensi_tanggal_today): ' + praAbs.msg}`);
    snapAwal = await snapshot();
    for (const f of applyFiles) {
      console.log(`\n-- menerapkan (dalam transaksi, tidak di-commit): ${f}`);
      await c.query(readFileSync(join(root, f), 'utf8'));
    }
  }
  await fasePasca();

  if (applyFiles.length) {
    await seksi('11. F8: rollback migrasi (urutan terbalik) mengembalikan snapshot awal', async () => {
      if (rollbackFiles.length !== applyFiles.length) {
        cek('semua berkas --apply punya rollback docs/rollback-rbac-tahap0-<id>.sql', false, `${rollbackFiles.length}/${applyFiles.length}`);
        return;
      }
      const snapSetelah = await snapshot();
      cek('snapshot setelah apply BERBEDA dari awal (uji tidak vakum)', selisih(snapAwal, snapSetelah).length > 0);
      for (const f of rollbackFiles) {
        const r = await pgq(readFileSync(join(root, f), 'utf8'));
        cek(`rollback ${f} berhasil dieksekusi`, r.ok, `${r.code ?? ''} ${r.msg ?? ''}`);
      }
      const snapRb = await snapshot();
      const beda = selisih(snapAwal, snapRb);
      // Selisih YANG DIHARAPKAN: guard dipertahankan versi benar; cron alpa tetap dijeda.
      const diharapkan = [/^fn:guard_absensi_tanggal_today\(/, /^cron:absensi_alpa_otomatis$/];
      const tidakDiharapkan = beda.filter((k) => !diharapkan.some((re) => re.test(k)));
      const adaDiharapkan = beda.filter((k) => diharapkan.some((re) => re.test(k)));
      info(`selisih diharapkan setelah rollback: ${adaDiharapkan.join(', ') || '(tidak ada)'}`);
      cek('rollback: tidak ada selisih fungsi/policy/ACL/RLS/kolom/cron di luar yang diharapkan', tidakDiharapkan.length === 0, tidakDiharapkan.join(' | '));
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
  cek('jumlah baris/keadaan tabel kunci SEBELUM == SESUDAH ROLLBACK (tidak ada perubahan permanen)',
    JSON.stringify(sebelumBaris) === JSON.stringify(sesudahBaris));
} catch (e) { console.error('hitung baris sesudah gagal:', e.message); kodeKeluar = 2; }
try { await c2.end(); } catch { /* abaikan */ }
console.log(`\nRINGKASAN: ${lulus} lolos, ${gagal.length} gagal`);
if (gagal.length) { for (const g of gagal) console.log(' - ' + g); kodeKeluar = kodeKeluar || 1; }
process.exit(kodeKeluar);
