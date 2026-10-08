// RBAC Tahap 1: tes PERILAKU (SET LOCAL ROLE + request.jwt.claims, satu transaksi yang SELALU di-ROLLBACK).
// Pakai: node scripts/test-rbac-tahap1.mjs --apply supabase/migrations/202610090001_rbac_tahap1.sql
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
for (let i = 0; i < argv.length; i++) if (argv[i] === '--apply') applyFiles.push(argv[++i]);

// F3: tolak berkas yang memuat kontrol transaksi (akan merusak transaksi pembungkus/ROLLBACK).
const rollbackFiles = applyFiles
  .map((f) => { const m = basename(f).match(/^(\d{12})_/); return m ? `docs/rollback-rbac-tahap1-${m[1]}.sql` : null; })
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


// ---------- helper khusus Tahap 1 ----------
const sebut = (r) => (r.ok ? `ok n=${r.n}` : `${r.code} ${r.msg}`);
async function buatTiket(layanan, nama = 'ZZ Tiket') {
  const v = await pgq(
    `INSERT INTO public.visit (asal, nama, keperluan, layanan_id, tujuan, status, waktu_masuk, client_request_id)
     VALUES ('walk_in',$1,'x',$2,'loket','menunggu',now(),$3) RETURNING id`, [nama, layanan, randomUUID()]);
  if (!v.ok) throw new Error(`buatTiket: ${v.msg}`);
  const t = await pgq(`SELECT id, kunjungan_id FROM public.tiket_antrean WHERE legacy_visit_id=$1`, [v.rows[0].id]);
  return { visit: v.rows[0].id, tiket: t.rows[0].id, kunjungan: t.rows[0].kunjungan_id };
}
const insOss = (a, tiket, kunj, petugas, { locked = false, draft = 'draft' } = {}) => run(a,
  `INSERT INTO public.pelayanan_oss (tiket_id, kunjungan_id, petugas_id, nama_pemohon, nama_usaha, tindak_lanjut, uraian_solusi, status_draft, is_locked)
   VALUES ($1,$2,$3,'Budi','CV Lama','tl','ur',$4,$5)`, [tiket, kunj, petugas, draft, locked]);

// ---------- fase PASCA Tahap 1 ----------
async function fasePasca1() {
  // Tes check-in/pelayanan tidak boleh bergantung jam sebenarnya: jam tutup 23:59 kecuali tes jam tutup.
  await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);

  await seksi('1. Data pelayanan terkunci & koreksi (S8)', async () => {
    await sp(async () => {
      const a = await buatTiket(F.A, 'ZZ A');
      const b = await buatTiket(F.B, 'ZZ B');
      cek('petugas A tidak bisa INSERT data TERKUNCI langsung (S8)', ditolak(await insOss(F.act.petA, a.tiket, a.kunjungan, F.petA, { locked: true, draft: 'selesai' })));
      cek('petugas A tidak bisa INSERT draf untuk tiket layanan B', ditolak(await insOss(F.act.petA, b.tiket, b.kunjungan, F.petA)));
      cek('petugas A tidak bisa INSERT draf atas nama petugas lain', ditolak(await insOss(F.act.petA, a.tiket, a.kunjungan, F.petB)));
      cek('petugas A bisa INSERT draf layanannya', (await insOss(F.act.petA, a.tiket, a.kunjungan, F.petA)).ok);
      cek('FO bisa INSERT draf lintas layanan', (await insOss(F.act.fo, b.tiket, b.kunjungan, F.fo)).ok);
      cek('pengunjung tidak bisa INSERT pelayanan_oss', ditolak(await insOss(F.act.visitor, a.tiket, a.kunjungan, F.petA)));
      const rd = await run(F.act.petA, `SELECT count(*)::int n FROM public.pelayanan_oss WHERE tiket_id IN ($1,$2)`, [a.tiket, b.tiket]);
      cek('petugas A hanya melihat draf layanannya (1 baris)', rd.rows?.[0]?.n === 1, sebut(rd));
      cek('FO melihat draf kedua layanan', (await run(F.act.fo, `SELECT count(*)::int n FROM public.pelayanan_oss WHERE tiket_id IN ($1,$2)`, [a.tiket, b.tiket])).rows?.[0]?.n === 2);
      cek('petugas B tidak melihat draf layanan A', (await run(F.act.petB, `SELECT count(*)::int n FROM public.pelayanan_oss WHERE tiket_id=$1`, [a.tiket])).rows?.[0]?.n === 0);

      // terkunci
      await pgq(`UPDATE public.pelayanan_oss SET status_draft='selesai', is_locked=true WHERE tiket_id=$1`, [a.tiket]).then((r) => {
        cek('postgres langsung mengunci draf = ditolak? (tidak: draf belum terkunci, boleh dikunci)', r.ok, sebut(r));
      });
      const upd = (act, kolom = `nama_usaha='Hack'`) => run(act, `UPDATE public.pelayanan_oss SET ${kolom} WHERE tiket_id=$1`, [a.tiket]);
      cek('petugas A UPDATE data terkunci = 0 baris', nol(await upd(F.act.petA)));
      cek('FO UPDATE langsung data terkunci = 0 baris', nol(await upd(F.act.fo)));
      cek('Admin UPDATE langsung data terkunci = 0 baris (hanya lewat koreksi)', nol(await upd(F.act.admin)));
      const lewatDb = await upd(POSTGRES);
      cek('pemilik DB pun ditolak trigger LOCKED tanpa koreksi', !lewatDb.ok && /LOCKED/.test(lewatDb.msg), sebut(lewatDb));
      cek('petugas A tidak bisa membuka kunci (is_locked=false)', nol(await upd(F.act.petA, 'is_locked=false')));

      const kor = (act, tiket = a.tiket, perubahan = { nama_usaha: 'CV Baru' }, alasan = 'salah ketik nama usaha', tipe = 'oss') =>
        run(act, `SELECT public.koreksi_pelayanan($1,$2,$3::jsonb,$4) AS r`, [tiket, tipe, JSON.stringify(perubahan), alasan]);
      cek('petugas A memanggil koreksi_pelayanan = 42501', ditolak(await kor(F.act.petA)));
      cek('pengunjung memanggil koreksi_pelayanan = 42501', ditolak(await kor(F.act.visitor)));
      cek('anon memanggil koreksi_pelayanan = 42501', ditolak(await kor(ANON)));
      cek('Admin NONAKTIF = 42501', ditolak(await kor(F.act.adminOff)));
      cek('tanpa alasan -> ALASAN_WAJIB', galat(await kor(F.act.fo, a.tiket, { nama_usaha: 'X' }, '  '), '22023', /ALASAN_WAJIB/));
      cek('kolom di luar daftar (is_locked) -> FIELD_TIDAK_VALID', galat(await kor(F.act.fo, a.tiket, { is_locked: 'false' }), '22023', /FIELD_TIDAK_VALID/));
      cek('kolom wajib dikosongkan -> FIELD_TIDAK_VALID', galat(await kor(F.act.fo, a.tiket, { nama_usaha: '' }), '22023', /wajib diisi/));
      cek('nilai sama -> TIDAK_ADA_PERUBAHAN', galat(await kor(F.act.fo, a.tiket, { nama_usaha: 'CV Lama' }), '22023', /TIDAK_ADA_PERUBAHAN/));
      cek('tiket tanpa data -> NOT_FOUND', galat(await kor(F.act.fo, randomUUID()), 'P0002', /NOT_FOUND/));
      cek('data masih draf (tiket B) -> BELUM_TERKUNCI', galat(await kor(F.act.fo, b.tiket), '22023', /BELUM_TERKUNCI/));
      cek('form_type salah -> INVALID_FORM', galat(await kor(F.act.fo, a.tiket, { nama_usaha: 'X' }, 'salah tipe form', 'xx'), '22023', /INVALID_FORM/));

      await sp(async () => {
        const r = await kor(F.act.fo, a.tiket, { nama_usaha: 'CV Baru', no_hp: '0812' });
        cek('FO mengoreksi data terkunci', r.ok && r.rows[0].r.ok === true, sebut(r));
        const row = (await pgq(`SELECT nama_usaha, no_hp, is_locked FROM public.pelayanan_oss WHERE tiket_id=$1`, [a.tiket])).rows[0];
        cek('nilai berubah & tetap terkunci', row.nama_usaha === 'CV Baru' && row.no_hp === '0812' && row.is_locked === true);
        const au = (await pgq(`SELECT actor_role, aksi, entitas_id, detail FROM public.audit_log WHERE aksi='koreksi_pelayanan' AND entitas_id=$1`, [a.tiket])).rows;
        cek('audit_log: 1 entri, role FO, alasan + nilai lama -> baru',
          au.length === 1 && au[0].actor_role === 'front_office' && au[0].detail.alasan === 'salah ketik nama usaha'
          && au[0].detail.perubahan.nama_usaha.lama === 'CV Lama' && au[0].detail.perubahan.nama_usaha.baru === 'CV Baru'
          && au[0].detail.perubahan.no_hp.lama === null, JSON.stringify(au));
        cek('setelah koreksi petugas A tetap tidak bisa mengubah', nol(await upd(F.act.petA)));
        const r2 = await kor(F.act.admin, a.tiket, { nama_usaha: 'CV Admin' }, 'koreksi oleh admin');
        cek('Admin juga bisa mengoreksi', r2.ok, sebut(r2));
        cek('audit_log kini 2 entri', (await pgq(`SELECT count(*)::int n FROM public.audit_log WHERE aksi='koreksi_pelayanan' AND entitas_id=$1`, [a.tiket])).rows[0].n === 2);
      });

      // finalize_pelayanan tetap jalan dan mengunci
      await sp(async () => {
        const c2 = await buatTiket(F.A, 'ZZ Final');
        await pgq(`UPDATE public.visit SET status='dilayani', waktu_mulai_layan=now() WHERE id=$1`, [c2.visit]);
        const payload = JSON.stringify({ nama_pemohon: 'Siti', nama_usaha: 'PT X', tindak_lanjut: 't', uraian_solusi: 'u' });
        const f1 = await run(F.act.petA, `SELECT public.finalize_pelayanan($1,'oss',$2::jsonb)`, [c2.tiket, payload]);
        cek('finalize_pelayanan oleh petugas layanannya tetap berhasil', f1.ok, sebut(f1));
        const f2 = await run(F.act.petA, `SELECT public.finalize_pelayanan($1,'oss',$2::jsonb)`, [c2.tiket, payload]);
        cek('finalize ulang pada data terkunci ditolak (LOCKED/status)', !f2.ok, sebut(f2));
        cek('petugas B tidak bisa finalize tiket layanan A', !(await run(F.act.petB, `SELECT public.finalize_pelayanan($1,'oss',$2::jsonb)`, [c2.tiket, payload])).ok);
      });
    });
  });

  await seksi('2. Per layanan: kunjungan, visit, rekap, SKM, investasi_lead', async () => {
    await sp(async () => {
      const a = await buatTiket(F.A, 'ZZ KA');
      const b = await buatTiket(F.B, 'ZZ KB');
      const n = async (act, tabel, where = '') => (await run(act, `SELECT count(*)::int n FROM public.${tabel} ${where}`)).rows?.[0]?.n;
      const kj = (act) => run(act, `SELECT id FROM public.kunjungan WHERE id IN ($1,$2)`, [a.kunjungan, b.kunjungan]);
      cek('kunjungan: petugas A hanya melihat kunjungan layanannya', (await kj(F.act.petA)).rows?.map((x) => x.id).join() === a.kunjungan);
      cek('kunjungan: FO & Admin melihat semuanya', (await kj(F.act.fo)).n === 2 && (await kj(F.act.admin)).n === 2);
      cek('kunjungan: petugas NONAKTIF tidak melihat apa pun', (await kj(F.act.petOff)).n === 0);
      cek('kunjungan: UPDATE kunjungan layanan lain = 0 baris (S8)', nol(await run(F.act.petA, `UPDATE public.kunjungan SET nama='Hack' WHERE id=$1`, [b.kunjungan])));
      cek('kunjungan: UPDATE kunjungan layanannya berhasil', (await run(F.act.petA, `UPDATE public.kunjungan SET kontak_hp='1' WHERE id=$1`, [a.kunjungan])).n === 1);
      cek('visit: petugas A hanya melihat visit layanannya', (await run(F.act.petA, `SELECT id FROM public.visit WHERE id IN ($1,$2)`, [a.visit, b.visit])).rows?.map((x) => x.id).join() === a.visit);
      cek('visit: FO melihat kedua layanan (S7)', (await run(F.act.fo, `SELECT id FROM public.visit WHERE id IN ($1,$2)`, [a.visit, b.visit])).n === 2);
      cek('visit: FO dapat UPDATE visit layanan mana pun (S7)', (await run(F.act.fo, `UPDATE public.visit SET keperluan='fo' WHERE id=$1`, [b.visit])).n === 1);
      cek('visit: petugas A UPDATE visit layanan B = 0 baris', nol(await run(F.act.petA, `UPDATE public.visit SET keperluan='x' WHERE id=$1`, [b.visit])));
      cek('visit: pengunjung tidak melihat visit orang lain', (await run(F.act.visitor, `SELECT id FROM public.visit WHERE id=$1`, [a.visit])).n === 0);

      for (const l of [F.A, F.B]) await pgq(`INSERT INTO public.rekap_harian_layanan (layanan_id, tanggal) VALUES ($1,$2)`, [l, F.hariIni]);
      cek('rekap_harian: petugas A hanya layanannya', (await n(F.act.petA, 'rekap_harian_layanan', `WHERE layanan_id IN ('${F.A}','${F.B}')`)) === 1);
      cek('rekap_harian: FO & Admin melihat keduanya', (await n(F.act.fo, 'rekap_harian_layanan', `WHERE layanan_id IN ('${F.A}','${F.B}')`)) === 2);

      for (const l of [F.A, F.B]) await pgq(`INSERT INTO public.skm_respons (layanan_id, u1_persyaratan, saran) VALUES ($1,3,'bagus')`, [l]);
      cek('skm: tabel rinci tertutup untuk petugas', (await n(F.act.petA, 'skm_respons', `WHERE layanan_id IN ('${F.A}','${F.B}')`)) === 0);
      const sv = await run(F.act.petA, `SELECT * FROM public.v_skm_petugas WHERE layanan_id IN ($1,$2)`, [F.A, F.B]);
      cek('skm: view petugas hanya layanannya & tanpa visit_id/id', sv.n === 1 && sv.rows[0].layanan_id === F.A && !('visit_id' in sv.rows[0]) && !('id' in sv.rows[0]), sebut(sv));
      cek('skm: view kosong untuk FO (pakai tabel)', (await run(F.act.fo, `SELECT 1 FROM public.v_skm_petugas`)).n === 0);
      cek('skm: FO & Admin membaca tabel rinci', (await n(F.act.fo, 'skm_respons', `WHERE layanan_id IN ('${F.A}','${F.B}')`)) === 2 && (await n(F.act.admin, 'skm_respons', `WHERE layanan_id IN ('${F.A}','${F.B}')`)) === 2);
      cek('skm: pengunjung tidak membaca', (await n(F.act.visitor, 'skm_respons', `WHERE layanan_id IN ('${F.A}','${F.B}')`)) === 0);

      const pol = (await pgq(`SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename='investasi_lead' AND cmd='SELECT'`)).rows;
      cek('investasi_lead: semua policy SELECT hanya Admin (peran_saya)', pol.length >= 1 && pol.every((p) => /peran_saya\(\)\s*=\s*'admin'/.test(p.qual)), JSON.stringify(pol));
      cek('investasi_lead: petugas tidak membaca', (await n(F.act.petA, 'investasi_lead')) === 0);
    });
  });

  await seksi('3. Jam tutup layanan (WIB)', async () => {
    const tutup = (iso) => pgq(`SELECT public.layanan_sudah_tutup($1::timestamptz) AS v`, [iso]).then((r) => r.rows?.[0]?.v);
    await sp(async () => {
      await pgq(`UPDATE public.site_settings SET value='16:00' WHERE key='jam_tutup_layanan'`);
      cek('15:59:59 WIB = buka', (await tutup('2026-10-09T08:59:59Z')) === false);
      cek('16:00:00 WIB = tutup', (await tutup('2026-10-09T09:00:00Z')) === true);
      cek('23:30 WIB = tutup', (await tutup('2026-10-09T16:30:00Z')) === true);
      cek('00:10 WIB hari berikut = buka', (await tutup('2026-10-09T17:10:00Z')) === false);
      cek('07:00 WIB = buka', (await tutup('2026-10-09T00:00:00Z')) === false);
      await pgq(`UPDATE public.site_settings SET value='15:30' WHERE key='jam_tutup_layanan'`);
      cek('jam tutup dapat diatur (15:30): 15:30 WIB = tutup', (await tutup('2026-10-09T08:30:00Z')) === true);
      await pgq(`UPDATE public.site_settings SET value='abc' WHERE key='jam_tutup_layanan'`);
      cek('nilai rusak -> default 16:00', (await tutup('2026-10-09T08:59:00Z')) === false && (await tutup('2026-10-09T09:00:00Z')) === true);
      await pgq(`DELETE FROM public.site_settings WHERE key='jam_tutup_layanan'`);
      cek('kunci tidak ada -> default 16:00', (await tutup('2026-10-09T09:00:00Z')) === true);
      await pgq(`UPDATE public.site_settings SET value='16:00' WHERE key='jam_tutup_layanan'`).catch(() => {});
    });
    cek('anon dapat memanggil layanan_sudah_tutup()', (await probe(ANON, `SELECT public.layanan_sudah_tutup() AS v`)).ok);
    cek('anon membaca jam_tutup_layanan dari site_settings (non-rahasia)', (await probe(ANON, `SELECT value FROM public.site_settings WHERE key='jam_tutup_layanan'`)).rows?.[0]?.value === '23:59');

    await sp(async () => { // trigger: sudah tutup (jam tutup 00:00 = selalu tutup)
      await pgq(`UPDATE public.site_settings SET value='00:00' WHERE key='jam_tutup_layanan'`);
      const walkIn = (act) => run(act, `INSERT INTO public.visit (asal, nama, layanan_id, tujuan, status, waktu_masuk, client_request_id, pengunjung_id)
        VALUES ('walk_in','ZZ Late',$1,'loket','menunggu',now(),$2,$3)`, [F.A, randomUUID(), act === F.act.visitor ? F.p_visitor : null]);
      const r = await walkIn(F.act.visitor);
      cek('walk-in setelah tutup ditolak dengan pesan ramah (DETAIL=LAYANAN_TUTUP)', !r.ok && /sudah tutup pukul 00:00 WIB/.test(r.msg) && r.detail === 'LAYANAN_TUTUP', sebut(r) + ' ' + r.detail);
      cek('walk-in oleh FO setelah tutup juga ditolak (tidak ada nomor baru)', !(await walkIn(F.act.fo)).ok);
      cek('tidak ada kunjungan/tiket baru tercipta', (await pgq(`SELECT count(*)::int n FROM public.kunjungan WHERE nama='ZZ Late'`)).rows[0].n === 0);
      const besok = (await pgq(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date + 1,'YYYY-MM-DD') AS d`)).rows[0].d;
      const rsv = await run(F.act.visitor, `INSERT INTO public.visit (asal, pengunjung_id, nama, tujuan, tanggal_rencana, keperluan, status, layanan_id)
        VALUES ('reservasi',$1,'ZZ Rsv','loket',$2,'x','terjadwal',$3) RETURNING id`, [F.p_visitor, besok, F.A]);
      cek('membuat RESERVASI untuk hari lain tetap boleh setelah tutup', rsv.ok, sebut(rsv));
      if (rsv.ok) {
        const up = await run(F.act.fo, `UPDATE public.visit SET status='menunggu', waktu_scan=now() WHERE id=$1`, [rsv.rows[0].id]);
        cek('scan/check-in reservasi (UPDATE) setelah tutup tetap boleh', up.ok && up.n === 1, sebut(up));
      }
    });

    await sp(async () => { // layanan_hari Admin saja; catat_absensi (definer) tetap membuka layanan
      const ins = (act, st = 'ditutup') => run(act, `INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari) VALUES ($1,$2,$3)`, [F.A, F.hariIni, st]);
      cek('FO tidak bisa menulis layanan_hari (tombol darurat dibatalkan)', ditolak(await ins(F.act.fo)));
      cek('petugas tidak bisa menulis layanan_hari', ditolak(await ins(F.act.petA)));
      cek('Admin bisa menulis layanan_hari', (await ins(F.act.admin)).ok);
      cek('anon tetap bisa MEMBACA layanan_hari', (await probe(ANON, `SELECT count(*)::int n FROM public.layanan_hari`)).ok);
      const ab = await run(F.act.fo, `SELECT public.catat_absensi($1,'fo',NULL)`, [F.petA]);
      cek('catat_absensi (FO) tetap membuka layanan_hari lewat fungsi definer', ab.ok && (await pgq(`SELECT status_hari FROM public.layanan_hari WHERE layanan_id=$1 AND tanggal=$2`, [F.A, F.hariIni])).rows[0]?.status_hari === 'dibuka', sebut(ab));
    });

    const job = (await pgq(`SELECT schedule FROM cron.job WHERE jobname='antrean_tidak_terlayani_akhir_hari'`)).rows;
    if (job.length) cek('cron akhir-hari = 09:00 UTC (16:00 WIB)', job[0].schedule === '0 9 * * *', job[0].schedule);
    else info('cron antrean_tidak_terlayani_akhir_hari tidak ada di lingkungan ini');
  });

  await seksi('4. Foto absensi', async () => {
    const fn = await pgq(`SELECT count(*)::int n FROM pg_proc WHERE proname='catat_absensi' AND pronamespace='public'::regnamespace`);
    cek('catat_absensi: tepat SATU overload (tanpa ambigu)', fn.rows[0].n === 1);
    const bk = (await pgq(`SELECT public FROM storage.buckets WHERE id='absensi-foto'`)).rows;
    cek('bucket absensi-foto ada & privat', bk.length === 1 && bk[0].public === false);
    cek('kolom absensi_petugas.foto_url ada', (await pgq(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='absensi_petugas' AND column_name='foto_url'`)).n === 1);
    const path = (p) => `${F.hariIni}/${p}_${Date.now()}.jpg`;
    await sp(async () => {
      const ok = await run(F.act.fo, `SELECT public.catat_absensi($1,'fo',NULL,$2)`, [F.petA, path(F.petA)]);
      cek('FO mencatat hadir dengan foto (4 argumen)', ok.ok, sebut(ok));
      cek('foto_url tersimpan', (await pgq(`SELECT foto_url FROM public.absensi_petugas WHERE petugas_id=$1`, [F.petA])).rows[0]?.foto_url?.startsWith(F.hariIni));
    });
    await sp(async () => {
      const ok = await run(F.act.fo, `SELECT public.catat_absensi($1,'fo',NULL)`, [F.petA]);
      cek('panggilan 3 argumen (tanpa foto) tetap berfungsi', ok.ok, sebut(ok));
    });
    cek('foto dengan path tidak sah ditolak', galat(await probe(F.act.fo, `SELECT public.catat_absensi($1,'fo',NULL,'../../x.jpg')`, [F.petA]), '22023', /foto_url/));
    cek('foto atas nama petugas lain ditolak', !(await probe(F.act.fo, `SELECT public.catat_absensi($1,'fo',NULL,$2)`, [F.petA, path(F.petB)])).ok);
    await sp(async () => {
      const r = await run(F.act.petA, `SELECT public.catat_absensi($1,'petugas_ajukan',NULL,$2)`, [F.petA, path(F.petA)]);
      cek('pengajuan petugas: foto diabaikan (hanya FO/Admin)', r.ok && (await pgq(`SELECT foto_url FROM public.absensi_petugas WHERE petugas_id=$1`, [F.petA])).rows[0]?.foto_url === null, sebut(r));
    });
    cek('petugas tidak bisa mencatat hadir petugas lain (tetap)', ditolak(await probe(F.act.petA, `SELECT public.catat_absensi($1,'fo',NULL)`, [F.petB])));
    cek('FO dapat MEMBACA absensi_petugas', (await probe(F.act.fo, `SELECT count(*)::int n FROM public.absensi_petugas`)).ok);

    cek('FO dapat unggah ke absensi-foto', (await probe(F.act.fo, `INSERT INTO storage.objects (bucket_id, name) VALUES ('absensi-foto',$1)`, [`${F.hariIni}/zz_${randomUUID()}.jpg`])).ok);
    cek('Admin dapat unggah ke absensi-foto', (await probe(F.act.admin, `INSERT INTO storage.objects (bucket_id, name) VALUES ('absensi-foto',$1)`, [`${F.hariIni}/zz_${randomUUID()}.jpg`])).ok);
    cek('petugas TIDAK dapat unggah', ditolak(await probe(F.act.petA, `INSERT INTO storage.objects (bucket_id, name) VALUES ('absensi-foto',$1)`, [`${F.hariIni}/zz_${randomUUID()}.jpg`])));
    cek('pengunjung TIDAK dapat unggah', ditolak(await probe(F.act.visitor, `INSERT INTO storage.objects (bucket_id, name) VALUES ('absensi-foto',$1)`, [`${F.hariIni}/zz_${randomUUID()}.jpg`])));
    cek('anon TIDAK dapat unggah', ditolak(await probe(ANON, `INSERT INTO storage.objects (bucket_id, name) VALUES ('absensi-foto',$1)`, [`${F.hariIni}/zz_${randomUUID()}.jpg`])));
    await sp(async () => {
      const nama = `${F.hariIni}/zz_${randomUUID()}.jpg`;
      await pgq(`INSERT INTO storage.objects (bucket_id, name) VALUES ('absensi-foto',$1)`, [nama]);
      const rd = (act) => run(act, `SELECT count(*)::int n FROM storage.objects WHERE bucket_id='absensi-foto' AND name=$1`, [nama]);
      cek('FO & Admin membaca objek foto', (await rd(F.act.fo)).rows?.[0]?.n === 1 && (await rd(F.act.admin)).rows?.[0]?.n === 1);
      cek('petugas & pengunjung tidak membaca objek foto', (await rd(F.act.petA)).rows?.[0]?.n === 0 && (await rd(F.act.visitor)).rows?.[0]?.n === 0);
      const del = await run(F.act.fo, `DELETE FROM storage.objects WHERE bucket_id='absensi-foto' AND name=$1`, [nama]);
      cek('FO tidak bisa menghapus objek foto (0 baris / ditolak)', !del.ok || del.n === 0, sebut(del));
    });
  });

  await seksi('5. Pengaduan', async () => {
    await sp(async () => {
      const buat = (jalur, layanan) => pgq(
        `INSERT INTO public.pengaduan (jalur, layanan_id, isi, kontak, anonim, batas_verifikasi, batas_penanganan)
         VALUES ($1,$2,'isi aduan','081-RAHASIA',false,current_date+3,current_date+14) RETURNING id`, [jalur, layanan]).then((r) => r.rows[0].id);
      const pl = await buat('layanan', F.A);
      const pi = await buat('integritas', null);
      const ids = [pl, pi];
      const sel = (act, tabel = 'pengaduan') => run(act, `SELECT id FROM public.${tabel} WHERE id = ANY($1::uuid[])`, [ids]);
      cek('petugas A TIDAK bisa membaca tabel pengaduan (identitas pelapor)', (await sel(F.act.petA)).n === 0);
      const v = await run(F.act.petA, `SELECT * FROM public.v_pengaduan_petugas WHERE id = ANY($1::uuid[])`, [ids]);
      cek('petugas A membaca view: hanya jalur layanan layanannya', v.n === 1 && v.rows[0].id === pl, sebut(v));
      cek('view petugas TIDAK memuat kontak/lampiran/sesi chat', v.n === 1 && !('kontak' in v.rows[0]) && !('lampiran_path' in v.rows[0]) && !('sesi_chat_id' in v.rows[0]));
      cek('petugas B tidak melihat pengaduan layanan A', (await sel(F.act.petB, 'v_pengaduan_petugas')).n === 0);
      cek('jalur integritas tidak terlihat petugas (tabel & view)', (await sel(F.act.petA, 'v_pengaduan_petugas')).rows?.every((r) => r.id !== pi));
      cek('FO membaca jalur layanan saja', (await sel(F.act.fo)).rows?.map((r) => r.id).join() === pl);
      cek('Admin membaca kedua jalur', (await sel(F.act.admin)).n === 2);
      cek('pengunjung tidak membaca pengaduan', (await sel(F.act.visitor)).n === 0);
      const upd = (act, id) => run(act, `UPDATE public.pengaduan SET status='diproses' WHERE id=$1`, [id]);
      cek('petugas A UPDATE pengaduan = 0 baris (tidak berwenang)', nol(await upd(F.act.petA, pl)));
      cek('FO UPDATE jalur layanan berhasil', (await upd(F.act.fo, pl)).n === 1);
      cek('FO UPDATE jalur integritas = 0 baris', nol(await upd(F.act.fo, pi)));
      cek('Admin UPDATE jalur integritas berhasil', (await upd(F.act.admin, pi)).n === 1);
      const rw = (act, id, oleh) => run(act, `INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_baru, diubah_oleh) VALUES ($1,'diproses',$2)`, [id, oleh]);
      cek('FO menulis riwayat pengaduan layanan atas namanya', (await rw(F.act.fo, pl, F.fo)).ok);
      cek('FO tidak bisa menulis riwayat jalur integritas', ditolak(await rw(F.act.fo, pi, F.fo)));
      cek('FO tidak bisa menyamar sebagai staf lain di riwayat', ditolak(await rw(F.act.fo, pl, F.admin)));
      cek('petugas tidak bisa menulis riwayat', ditolak(await rw(F.act.petA, pl, F.petA)));
    });
  });

  await seksi('6. Check-in publik tidak terputus (setelah migrasi)', async () => {
    await checkinWalkIn('PASCA: check-in walk-in (pengunjung anon) jalan', { dgnPengunjung: true });
    await checkinWalkIn('PASCA: check-in walk-in tanpa pengunjung jalan', { dgnPengunjung: false });
    await checkinReservasi('PASCA: reservasi jalan');
    const s = await probe(ANON, 'SELECT count(*)::int n FROM public.v_layar_antrian');
    cek('layar antrean publik (anon) tetap terbaca', s.ok, sebut(s));
    const pa = await probe(F.act.petA, 'SELECT count(*)::int n FROM public.tiket_antrean');
    cek('petugas masih membaca tiket layanannya', pa.ok, sebut(pa));
  });
}

// ---------- main ----------
async function hitungBaris(cl) {
  const r = await cl.query(`SELECT
    (SELECT count(*) FROM public.petugas)::int AS petugas, (SELECT count(*) FROM public.kunjungan)::int AS kunjungan,
    (SELECT count(*) FROM public.visit)::int AS visit, (SELECT count(*) FROM public.absensi_petugas)::int AS absensi_petugas,
    (SELECT count(*) FROM public.tiket_antrean)::int AS tiket_antrean, (SELECT count(*) FROM public.layanan)::int AS layanan,
    (SELECT count(*) FROM public.layanan_hari)::int AS layanan_hari, (SELECT count(*) FROM public.audit_log)::int AS audit_log,
    (SELECT count(*) FROM public.pelayanan_oss)::int AS pelayanan_oss, (SELECT count(*) FROM public.pelayanan_perizinan)::int AS pelayanan_perizinan,
    (SELECT count(*) FROM public.pengaduan)::int AS pengaduan, (SELECT count(*) FROM public.skm_respons)::int AS skm_respons,
    (SELECT count(*) FROM auth.users)::int AS auth_users,
    (SELECT count(*) FROM public.site_settings)::int AS site_settings,
    (SELECT schedule FROM cron.job WHERE jobname='antrean_tidak_terlayani_akhir_hari') AS cron_akhir_hari`);
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
  let rawAwal = null;
  if (applyFiles.length) {
    snapAwal = await snapshot();
    rawAwal = (await pgq(`SELECT policyname, qual FROM pg_policies WHERE policyname IN ('oss_read_staff','perizinan_read_staff') ORDER BY 1`)).rows;
    for (const f of applyFiles) {
      console.log(`\n-- menerapkan (dalam transaksi, tidak di-commit): ${f}`);
      await c.query(readFileSync(join(root, f), 'utf8'));
    }
  } else {
    info('tanpa --apply: menguji state DB saat ini (migrasi harus sudah diterapkan)');
  }
  await fasePasca1();

  if (applyFiles.length) {
    await seksi('7. Rollback migrasi mengembalikan snapshot awal', async () => {
      if (rollbackFiles.length !== applyFiles.length) {
        cek('semua berkas --apply punya rollback docs/rollback-rbac-tahap1-<id>.sql', false, `${rollbackFiles.length}/${applyFiles.length}`);
        return;
      }
      const snapSetelah = await snapshot();
      cek('snapshot setelah apply BERBEDA dari awal (uji tidak vakum)', selisih(snapAwal, snapSetelah).length > 0);
      await pgq(`UPDATE public.site_settings SET value='16:00' WHERE key='jam_tutup_layanan'`);
      for (const f of rollbackFiles) {
        const r = await pgq(readFileSync(join(root, f), 'utf8'));
        cek(`rollback ${f} berhasil dieksekusi`, r.ok, `${r.code ?? ''} ${r.msg ?? ''}`);
      }
      const beda = selisih(snapAwal, await snapshot());
      // Diharapkan: kolom foto_url dipertahankan (data); badan catat_absensi 3-arg tanpa komentar lama.
      const diharapkan = [/^col:absensi_petugas\.foto_url$/, /^fn:catat_absensi\(/];
      info(`selisih diharapkan setelah rollback: ${beda.filter((k) => diharapkan.some((re) => re.test(k))).join(', ') || '(tidak ada)'}`);
      if (beda.some((k) => k.startsWith('policy:'))) {
        const rawRb = (await pgq(`SELECT policyname, qual FROM pg_policies WHERE policyname IN ('oss_read_staff','perizinan_read_staff') ORDER BY 1`)).rows;
        info(`policy awal: ${JSON.stringify(rawAwal)}`);
        info(`policy setelah rollback: ${JSON.stringify(rawRb)}`);
      }
      const tak = beda.filter((k) => !diharapkan.some((re) => re.test(k)));
      cek('rollback: tidak ada selisih fungsi/policy/ACL/RLS/kolom/cron di luar yang diharapkan', tak.length === 0, tak.join(' | '));
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
