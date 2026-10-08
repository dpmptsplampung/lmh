// RBAC Tahap 2 (akun/username): tes PERILAKU migrasi 202610090002. Semuanya di SATU transaksi yang SELALU
// di-ROLLBACK (data uji sintetis; tidak pernah COMMIT). Menerapkan berkas migrasi DI DALAM transaksi.
//   node scripts/test-rbac-akun.mjs
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { mengandungKontrolTransaksi } from './lib/sql-txn.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8').split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
if (!env.DIRECT_URL) { console.error('DIRECT_URL tidak ada di .env.local'); process.exit(2); }
const MIG = readFileSync(join(root, 'supabase/migrations/202610090002_akun_username.sql'), 'utf8');
if (mengandungKontrolTransaksi(MIG)) { console.error('DITOLAK: migrasi memuat kontrol transaksi'); process.exit(2); }

const c = new pg.Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
let lulus = 0; const gagal = [];
const cek = (n, ok, d = '') => { if (ok) lulus++; else gagal.push(`${n} :: ${d}`); console.log(`${ok ? 'LOLOS' : 'GAGAL'}  ${n}${!ok && d ? ' :: ' + d : ''}`); };

let spN = 0;
const POSTGRES = { dbRole: null, claims: null };
const ANON = { dbRole: 'anon', claims: { role: 'anon' } };
const SERVICE = { dbRole: 'service_role', claims: { role: 'service_role' } };
const asUser = (uid) => ({ dbRole: 'authenticated', claims: { sub: uid, role: 'authenticated' } });
async function run(a, sql, params = []) {
  const name = `r${++spN}`;
  await c.query(`SAVEPOINT ${name}`);
  try {
    await c.query('RESET ROLE');
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [a.claims ? JSON.stringify(a.claims) : '']);
    if (a.dbRole) await c.query(`SET LOCAL ROLE ${a.dbRole}`);
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
async function sp(fn) { // skenario terisolasi
  const name = `s${++spN}`;
  await c.query(`SAVEPOINT ${name}`);
  try { return await fn(); } finally { await c.query('RESET ROLE'); await c.query(`ROLLBACK TO SAVEPOINT ${name}`); }
}
const pgq = (sql, p) => run(POSTGRES, sql, p);
const ditolak = (r) => !r.ok && r.code === '42501';
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function main() {
  await c.connect();
  await c.query("SET lock_timeout = '3s'; SET statement_timeout = '20s'");
  await c.query('BEGIN');

  const sudahAda = (await pgq(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='petugas' AND column_name='username'`)).rows.length > 0;
  if (!sudahAda) {
    const ap = await pgq(MIG);
    cek('migrasi 0002 dapat diterapkan di dalam transaksi', ap.ok, `${ap.code} ${ap.msg}`);
    if (!ap.ok) return;
  } else console.log('INFO   kolom username sudah ada: migrasi dianggap sudah diterapkan');

  // ---- fixture ----
  const U = {}; const P = {};
  for (const k of ['admin', 'fo', 'pet', 'off']) {
    U[k] = randomUUID();
    const r = await pgq(`INSERT INTO auth.users (id, aud, role, email, last_sign_in_at) VALUES ($1,'authenticated','authenticated',$2,$3)`,
      [U[k], `zz-tes-${k}@example.invalid`, k === 'admin' ? new Date().toISOString() : null]);
    if (!r.ok) throw new Error(`fixture auth.users ${k}: ${r.msg}`);
  }
  const lay = (await pgq(`INSERT INTO public.layanan (nama, is_ptsp) VALUES ('ZZ-TES-AKUN', true) RETURNING id`)).rows[0].id;
  for (let h = 1; h <= 7; h++) await pgq(`INSERT INTO public.jadwal_standby (layanan_id, hari, aktif) VALUES ($1,$2,true)`, [lay, h]);
  for (const [k, role, l, aktif] of [['admin', 'admin', null, true], ['fo', 'front_office', null, true], ['pet', 'petugas', lay, true], ['off', 'petugas', lay, false]]) {
    const r = await pgq(`INSERT INTO public.petugas (auth_user_id, nama, layanan_id, role, aktif) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [U[k], `ZZ ${k}`, l, role, aktif]);
    if (!r.ok) throw new Error(`fixture petugas ${k}: ${r.msg}`);
    P[k] = r.rows[0].id;
  }
  const A = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, asUser(u)]));

  // ---- username/format ----
  const upd = (v) => pgq(`UPDATE public.petugas SET username=$1 WHERE id=$2`, [v, P.pet]);
  cek('username valid diterima', (await sp(() => upd('helpdesk-oss'))).ok);
  for (const bad of ['Ab', 'admin', 'Helpdesk', 'a_b_c', '-abc']) {
    const r = await sp(() => upd(bad));
    cek(`username ditolak: ${bad}`, !r.ok && r.code === '23514', `${r.code}`);
  }
  await sp(async () => {
    await upd('dup-user');
    const r = await pgq(`UPDATE public.petugas SET username='dup-user' WHERE id=$1`, [P.fo]);
    cek('username unik (23505)', !r.ok && r.code === '23505', `${r.code}`);
  });
  cek('no_hp format ditolak', (await sp(() => pgq(`UPDATE public.petugas SET no_hp='abc' WHERE id=$1`, [P.pet]))).code === '23514');

  // ---- profil sendiri ----
  await sp(async () => {
    const r = await run(A.pet, `SELECT public.petugas_ubah_profil($1::jsonb)`, [JSON.stringify({ no_hp: '+6281234567890', email_notifikasi: 'Saya@Contoh.com', operator_default: 'Budi' })]);
    const row = (await pgq(`SELECT no_hp, email_notifikasi, operator_default, role, aktif, layanan_id, username FROM public.petugas WHERE id=$1`, [P.pet])).rows[0];
    cek('profil sendiri: no_hp/email(lowercase)/operator tersimpan', r.ok && row.no_hp === '+6281234567890' && row.email_notifikasi === 'saya@contoh.com' && row.operator_default === 'Budi', JSON.stringify(r));
    cek('profil sendiri: role/layanan/aktif tidak berubah', row.role === 'petugas' && row.aktif === true && row.layanan_id === lay);
    await pgq(`UPDATE public.petugas SET email_notifikasi_verified_at=now() WHERE id=$1`, [P.pet]);
    await run(A.pet, `SELECT public.petugas_ubah_profil($1::jsonb)`, [JSON.stringify({ no_hp: '+6281234567891' })]);
    cek('ubah no_hp TIDAK mereset verifikasi email', (await pgq(`SELECT email_notifikasi_verified_at IS NOT NULL AS v FROM public.petugas WHERE id=$1`, [P.pet])).rows[0].v);
    await run(A.pet, `SELECT public.petugas_ubah_profil($1::jsonb)`, [JSON.stringify({ email_notifikasi: 'lain@contoh.com' })]);
    cek('email notifikasi baru mereset verifikasi', (await pgq(`SELECT email_notifikasi_verified_at IS NULL AS v FROM public.petugas WHERE id=$1`, [P.pet])).rows[0].v);
    const bad = await run(A.pet, `SELECT public.petugas_ubah_profil($1::jsonb)`, [JSON.stringify({ no_hp: 'xx' })]);
    cek('profil: no_hp tidak valid ditolak', !bad.ok && bad.code === '23514');
  });
  cek('anon tidak bisa petugas_ubah_profil', ditolak(await run(ANON, `SELECT public.petugas_ubah_profil('{}'::jsonb)`)));
  cek('petugas NONAKTIF tidak bisa petugas_ubah_profil', ditolak(await run(A.off, `SELECT public.petugas_ubah_profil('{"no_hp":"+6281234567890"}'::jsonb)`)));
  const direct = await run(A.pet, `UPDATE public.petugas SET role='admin', no_hp='+6281234567890' WHERE id=$1`, [P.pet]);
  cek('petugas TIDAK bisa menulis tabel petugas langsung (RLS)', (direct.ok && direct.n === 0) || ditolak(direct), JSON.stringify(direct));

  // ---- akun_daftar ----
  const dAdmin = await run(A.admin, `SELECT * FROM public.akun_daftar()`);
  const rowPet = dAdmin.rows?.find((r) => r.id === P.pet);
  const rowAdm = dAdmin.rows?.find((r) => r.id === P.admin);
  cek('akun_daftar: Admin melihat daftar + belum_pernah_login', dAdmin.ok && rowPet?.belum_pernah_login === true && rowAdm?.belum_pernah_login === false, JSON.stringify(dAdmin.msg ?? ''));
  await sp(async () => {
    await pgq(`UPDATE public.petugas SET email_notifikasi='rahasia@contoh.com' WHERE id=$1`, [P.pet]);
    const r = await run(A.admin, `SELECT * FROM public.akun_daftar()`);
    const row = r.rows.find((x) => x.id === P.pet);
    cek('akun_daftar: email notifikasi tersamar', row.email_notifikasi_tersamar === 'r***@contoh.com' && !JSON.stringify(row).includes('rahasia@'), JSON.stringify(row.email_notifikasi_tersamar));
  });
  cek('akun_daftar: FO ditolak', ditolak(await run(A.fo, `SELECT * FROM public.akun_daftar()`)));
  cek('akun_daftar: petugas ditolak', ditolak(await run(A.pet, `SELECT * FROM public.akun_daftar()`)));
  cek('akun_daftar: anon ditolak', ditolak(await run(ANON, `SELECT * FROM public.akun_daftar()`)));
  cek('akun_daftar: service_role boleh', (await run(SERVICE, `SELECT * FROM public.akun_daftar()`)).ok);

  // ---- akhiri sesi ----
  await sp(async () => {
    const ins = await pgq(`INSERT INTO auth.sessions (id, user_id) VALUES ($1,$2)`, [randomUUID(), U.pet]);
    cek('akun_akhiri_sesi: authenticated ditolak', ditolak(await run(A.admin, `SELECT public.akun_akhiri_sesi($1)`, [U.pet])));
    if (ins.ok) {
      const r = await run(SERVICE, `SELECT public.akun_akhiri_sesi($1) AS n`, [U.pet]);
      cek('akun_akhiri_sesi: service_role menghapus sesi', r.ok && r.rows[0].n === 1, JSON.stringify(r));
    } else console.log(`INFO   auth.sessions tidak bisa disisipi di lingkungan ini (${ins.msg}); uji hapus-sesi dilewati`);
  });

  // ---- token verifikasi email ----
  await sp(async () => {
    await pgq(`UPDATE public.petugas SET email_notifikasi='v@contoh.com', email_notifikasi_verified_at=NULL WHERE id=$1`, [P.pet]);
    const tok = (n) => sha(`token-${n}`);
    const simpan = (n, email, menit) => pgq(`INSERT INTO public.petugas_verif_email (petugas_id,email,token_hash,kedaluwarsa) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval) ON CONFLICT (petugas_id) DO UPDATE SET email=$2, token_hash=$3, kedaluwarsa=now() + ($4 || ' minutes')::interval`, [P.pet, email, tok(n), String(menit)]);
    cek('tabel token: authenticated tak bisa baca', ditolak(await run(A.pet, `SELECT * FROM public.petugas_verif_email`)));
    cek('tabel token: anon tak bisa baca', ditolak(await run(ANON, `SELECT * FROM public.petugas_verif_email`)));
    await simpan(1, 'v@contoh.com', 30);
    cek('verifikasi: authenticated ditolak', ditolak(await run(A.pet, `SELECT public.petugas_verifikasi_email($1)`, [tok(1)])));
    const ok = await run(SERVICE, `SELECT public.petugas_verifikasi_email($1) AS id`, [tok(1)]);
    cek('verifikasi: token valid -> verified_at terisi', ok.ok && ok.rows[0].id === P.pet && (await pgq(`SELECT email_notifikasi_verified_at IS NOT NULL AS v FROM public.petugas WHERE id=$1`, [P.pet])).rows[0].v);
    const ulang = await run(SERVICE, `SELECT public.petugas_verifikasi_email($1) AS id`, [tok(1)]);
    cek('verifikasi: token sekali pakai', ulang.ok && ulang.rows[0].id === null);
    await pgq(`UPDATE public.petugas SET email_notifikasi_verified_at=NULL WHERE id=$1`, [P.pet]);
    await simpan(2, 'v@contoh.com', -1);
    cek('verifikasi: token kedaluwarsa ditolak', (await run(SERVICE, `SELECT public.petugas_verifikasi_email($1) AS id`, [tok(2)])).rows[0].id === null);
    await simpan(3, 'lama@contoh.com', 30);
    cek('verifikasi: email sudah diganti -> ditolak', (await run(SERVICE, `SELECT public.petugas_verifikasi_email($1) AS id`, [tok(3)])).rows[0].id === null);
  });

  // ---- penjaga Admin aktif terakhir ----
  await sp(async () => {
    await pgq(`UPDATE public.petugas SET aktif=false WHERE role='admin' AND id<>$1`, [P.admin]); // admin nyata (di-rollback)
    const a = await pgq(`UPDATE public.petugas SET aktif=false WHERE id=$1`, [P.admin]);
    cek('guard: Admin aktif terakhir tak bisa dinonaktifkan (tulis langsung)', !a.ok && /terakhir/.test(a.msg), `${a.code} ${a.msg}`);
    const b = await pgq(`UPDATE public.petugas SET role='front_office' WHERE id=$1`, [P.admin]);
    cek('guard: Admin aktif terakhir tak bisa diturunkan', !b.ok && /terakhir/.test(b.msg), `${b.code} ${b.msg}`);
  });
  cek('guard: bukan Admin terakhir boleh diturunkan', (await sp(() => pgq(`UPDATE public.petugas SET role='front_office' WHERE id=$1`, [P.admin]))).ok);

  // ---- operator bertugas pada absensi ----
  await sp(async () => {
    await pgq(`UPDATE public.petugas SET operator_default='Budi Santoso' WHERE id=$1`, [P.pet]);
    const r = await run(A.fo, `SELECT public.catat_absensi($1,'fo') AS id`, [P.pet]);
    const row = r.ok ? (await pgq(`SELECT operator_nama FROM public.absensi_petugas WHERE id=$1`, [r.rows[0].id])).rows[0] : null;
    cek('absensi: operator_nama diisi dari operator_default', r.ok && row?.operator_nama === 'Budi Santoso', JSON.stringify(r.ok ? row : r));
  });

  // ---- tidak mengubah fungsi lain ----
  cek('catat_absensi 3-argumen tidak terpengaruh (masih ada)', (await pgq(`SELECT 1 FROM pg_proc WHERE proname='catat_absensi' AND pronamespace='public'::regnamespace`)).rows.length >= 1);

  // ---- rollback migrasi (di dalam transaksi yang sama) ----
  if (!sudahAda) {
    const rb = readFileSync(join(root, 'docs/rollback-rbac-tahap2-202610090002.sql'), 'utf8');
    const r = await pgq(rb);
    const sisa = await pgq(`SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND ((table_name='petugas' AND column_name IN ('username','no_hp','email_notifikasi','operator_default','wajib_ganti_sandi')) OR (table_name='absensi_petugas' AND column_name='operator_nama'))) AS kol,
      (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('akun_daftar','akun_akhiri_sesi','petugas_ubah_profil','petugas_verifikasi_email','guard_admin_terakhir','absensi_isi_operator','tersamarkan_email')) AS fn`);
    cek('rollback 0002 menghapus kolom & fungsi', r.ok && sisa.rows[0].kol == 0 && sisa.rows[0].fn == 0, `${r.msg ?? ''} ${JSON.stringify(sisa.rows?.[0])}`);
  }
}

try { await main(); }
catch (e) { gagal.push(`GALAT TAK TERDUGA: ${e.message}`); console.error(e); }
finally {
  try { await c.query('ROLLBACK'); const n = (await c.query('SELECT count(*)::int AS n FROM public.petugas')).rows[0].n; console.log(`INFO   rollback selesai; baris petugas sekarang=${n}`); } catch {}
  await c.end().catch(() => {});
}
console.log(`\n${lulus} lolos, ${gagal.length} gagal`);
if (gagal.length) { console.log(gagal.map((g) => ' - ' + g).join('\n')); process.exit(1); }
