// WP-24 (B-DB2): tes PERILAKU migrasi 202610140007_wp24_akhiri_dual_write + 202610140008_wp24_tutup_otomatis_retensi.
// SET LOCAL ROLE + request.jwt.claims, SATU transaksi yang SELALU di-ROLLBACK (tidak pernah COMMIT). Data uji sintetis
// (ZZ-TES-*). Menyentuh DB produksi lewat DIRECT_URL di .env.local: jalankan hanya di luar jam layanan (skrip menolak
// hari kerja sebelum 16:00 WIB kecuali --paksa-jam). Migrasi di dalam transaksi mengunci tabel visit/kunjungan/
// tiket_antrean/layanan dan view v_antrian_loket sampai ROLLBACK (sekitar 1-2 menit).
//
// Pakai (DB produksi saat ini: 202610140001 sudah ada; 0002..0006 belum):
//   node scripts/test-wp24.mjs \
//     --pre supabase/migrations/202610140002_tiket_kepemilikan.sql \
//     --pre supabase/migrations/202610140003_fo_model_data.sql \
//     --pre supabase/migrations/202610140004_fo_rpc.sql \
//     --pre supabase/migrations/202610140005_fo_selaras_antrean.sql \
//     --pre supabase/migrations/202610140006_pernyataan_kebenaran.sql \
//     --apply supabase/migrations/202610140007_wp24_akhiri_dual_write.sql \
//     --apply supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql [--akhir-hari]
//   --pre   = diterapkan dulu di dalam transaksi (tanpa uji rollback); fixture alur LAMA (visit) dibuat SESUDAHNYA,
//             sebelum --apply, sehingga keadaan "saat cutover" tersimulasi.
//   --apply = migrasi yang diuji + uji rollback docs/rollback-*-<versi>.sql (urutan terbalik, snapshot katalog).
//   --akhir-hari = juga menjalankan tandai_tidak_terlayani_akhir_hari(), tandai_reservasi_no_show() dan
//                  tutup_penanganan_tertinggal() (ikut menyentuh baris produksi yang memenuhi syarat, DI DALAM transaksi).
// TIDAK tercakup: konkurensi sejati (dua koneksi), pengiriman notifikasi sungguhan (hanya baris notifikasi yang
// diantrekan), eksekusi pg_cron terjadwal (fungsi dipanggil langsung).
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
let paksaJam = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--apply') applyFiles.push(argv[++i]);
  else if (argv[i] === '--pre') preFiles.push(argv[++i]);
  else if (argv[i] === '--akhir-hari') ujiAkhirHari = true;
  else if (argv[i] === '--paksa-jam') paksaJam = true;
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
const angka = async (sql, params) => Number((await satu(sql, params))?.n ?? NaN);

const ditolak = (r, re) => !r.ok && r.code === '42501' && (!re || re.test(r.msg));
const galat = (r, code, re) => !r.ok && r.code === code && (!re || re.test(r.msg));
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
const mulai = (a, t) => rpc(a, 'layanan_mulai', [t]);
const selesai = (a, t, topik = null, catatan = null) =>
  run(a, `SELECT public.layanan_selesai($1, NULL, NULL, $2, $3) AS r`, [t, topik, catatan]);
const skmKonteks = (a, token) => run(a, `SELECT * FROM public.get_skm_context($1)`, [token]);
const skmKirim = (a, token, nilai = 3) =>
  run(a, `SELECT public.submit_skm_response($1,$2,$2,$2,$2,$2,$2,$2,$2,$2,'uji WP-24') AS r`, [token, nilai]);

// ---------- fixture ----------
const F = {};
async function buatFixture() {
  const ids = {};
  for (const k of ['visitor', 'visitor2', 'visitorFk', 'visitorTua', 'admin', 'fo', 'petA', 'petA2', 'petB']) ids[k] = randomUUID();
  F.uid = ids;
  for (const [k, uid] of Object.entries(ids)) {
    const r = await pgq(
      `INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES ($1,'authenticated','authenticated',$2,false)`,
      [uid, `zz-tes-${k.toLowerCase()}@example.invalid`]);
    if (!r.ok) throw new Error(`fixture auth.users ${k}: ${r.msg}`);
  }
  for (const [kunci, nama] of [['A', 'ZZ-TES-A'], ['B', 'ZZ-TES-B']]) {
    const r = await pgq(`INSERT INTO public.layanan (nama, is_ptsp) VALUES ($1, false) RETURNING id`, [nama]);
    if (!r.ok) throw new Error(`fixture layanan ${nama}: ${r.msg}`);
    F[kunci] = r.rows[0].id;
    for (let h = 1; h <= 7; h++) await pgq(`INSERT INTO public.jadwal_standby (layanan_id, hari, aktif) VALUES ($1,$2,true)`, [F[kunci], h]);
  }
  const pet = async (k, role, layanan) => {
    const r = await pgq(`INSERT INTO public.petugas (auth_user_id, nama, layanan_id, role, aktif) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids[k], `ZZ ${k}`, layanan, role]);
    if (!r.ok) throw new Error(`fixture petugas ${k}: ${r.msg}`);
    F[k] = r.rows[0].id;
  };
  await pet('admin', 'admin', null);
  await pet('fo', 'front_office', null);
  await pet('petA', 'petugas', F.A);
  await pet('petA2', 'petugas', F.A);
  await pet('petB', 'petugas', F.B);
  for (const k of ['visitor', 'visitor2', 'visitorFk']) {
    const r = await pgq(`INSERT INTO public.pengunjung (auth_user_id, nama, no_hp, asal_instansi, kategori, email)
      VALUES ($1,$2,'081234567890','ZZ Instansi','Umum',$3) RETURNING id`, [ids[k], `ZZ ${k}`, `zz-${k.toLowerCase()}@example.invalid`]);
    if (!r.ok) throw new Error(`fixture pengunjung ${k}: ${r.msg}`);
    F[`p_${k}`] = r.rows[0].id;
  }
  // Profil lengkap yang tidak aktif > 730 hari (nama terkunci menurut 202610140006 bila sudah diterapkan).
  const tua = await pgq(`INSERT INTO public.pengunjung (auth_user_id, nama, no_hp, asal_instansi, kategori, email, created_at, updated_at)
    VALUES ($1,'ZZ Pengunjung Tua','081234567891','ZZ Instansi','Umum','zz-tua@example.invalid', now() - interval '800 days', now() - interval '800 days')
    RETURNING id`, [ids.visitorTua]);
  if (!tua.ok) throw new Error(`fixture pengunjung tua: ${tua.msg}`);
  F.p_tua = tua.rows[0].id;
  F.act = Object.fromEntries(Object.entries(ids).map(([k, u]) => [k, asUser(u)]));
  const t = await satu(`SELECT to_char(d,'YYYY-MM-DD') hari_ini, to_char(d + 1,'YYYY-MM-DD') besok, to_char(d - 1,'YYYY-MM-DD') kemarin,
      to_char(d - 1100,'YYYY-MM-DD') dulu FROM (SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date AS d) x`);
  Object.assign(F, t);
  await pgq(`SELECT set_config('lmh.izinkan_jam_tutup','on',true)`);
  await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);
}

// Keadaan "saat cutover" (dibuat lewat alur LAMA, sebelum --apply): visit + dual-write + RPC 0005 yang menyinkronkan visit.
async function siapkanLama() {
  const resv = async (o) => {
    const r = await pgq(`INSERT INTO public.visit (asal, pengunjung_id, nama, tujuan, tanggal_rencana, keperluan, status, layanan_id,
        nama_yang_ditemui, asal_instansi, created_at)
      VALUES ('reservasi',$1,$2,$3,$4::date,$5,'terjadwal',$6,$7,'ZZ Instansi Lama',$8) RETURNING id, qr_token`,
      [o.pengunjung, o.nama, o.tujuan, o.tanggal, o.keperluan ?? 'uji lama', o.layanan ?? null, o.temu ?? null, o.created ?? new Date()]);
    if (!r.ok) throw new Error(`siapkanLama ${o.nama}: ${r.msg}`);
    return r.rows[0];
  };
  F.resvLoketHariIni = await resv({ pengunjung: F.p_visitor, nama: 'ZZ Resv Loket', tujuan: 'loket', tanggal: F.hari_ini, layanan: F.A });
  F.resvLoketKemarin = await resv({ pengunjung: F.p_visitor2, nama: 'ZZ Resv Kemarin', tujuan: 'loket', tanggal: F.kemarin, layanan: F.A });
  F.resvTemuBesok = await resv({ pengunjung: F.p_visitor2, nama: 'ZZ Resv Temu', tujuan: 'bertemu_seseorang', tanggal: F.besok, temu: 'Bapak Kabid' });
  F.resvTemuKemarin = await resv({ pengunjung: F.p_visitorFk, nama: 'ZZ Resv Temu Lalu', tujuan: 'bertemu_seseorang', tanggal: F.kemarin, temu: 'Ibu Kasi' });
  F.visitDulu = await resv({ pengunjung: null, nama: 'ZZ Arsip Dulu', tujuan: 'bertemu_seseorang', tanggal: F.dulu, temu: 'Pejabat Lama',
    created: new Date(Date.now() - 1100 * 864e5) });

  const walkin = async (nama, pengunjung = null) => {
    const w = await pgq(`INSERT INTO public.visit (asal, pengunjung_id, nama, keperluan, layanan_id, tujuan, status, waktu_masuk, client_request_id)
      VALUES ('walk_in',$1,$2,'x',$3,'loket','menunggu',now(),$4) RETURNING id, qr_token`, [pengunjung, nama, F.A, randomUUID()]);
    if (!w.ok) throw new Error(`siapkanLama walk-in ${nama}: ${w.msg}`);
    const t = await satu(`SELECT id FROM public.tiket_antrean WHERE legacy_visit_id=$1`, [w.rows[0].id]);
    if (!t) throw new Error(`siapkanLama walk-in ${nama}: tiket dual-write tidak terbit`);
    const m = await mulai(F.act.petA, t.id);
    if (!m.ok) throw new Error(`siapkanLama mulai ${nama}: ${sebut(m)}`);
    return { visit: w.rows[0].id, qr: w.rows[0].qr_token, tiket: t.id };
  };
  F.lamaDilayani = await walkin('ZZ Lama Dilayani', F.p_visitor);
  F.lamaDilayani2 = await walkin('ZZ Lama Dilayani 2');
  F.lamaSelesai = await walkin('ZZ Lama Selesai');
  const s = await selesai(F.act.petA, F.lamaSelesai.tiket);
  if (!s.ok) throw new Error(`siapkanLama selesai: ${sebut(s)}`);
  // SKM lama sudah diisi sebelum cutover (lewat visit).
  const k = await skmKirim(ANON, F.lamaSelesai.qr);
  if (hasil(k) !== 'submitted') throw new Error(`siapkanLama SKM lama: ${sebut(k)}`);
  for (const [nama, kunci] of [['loket hari ini', 'resvLoketHariIni'], ['loket kemarin', 'resvLoketKemarin']]) {
    F[`k_${kunci}`] = (await satu(`SELECT id FROM public.kunjungan WHERE legacy_visit_id=$1`, [F[kunci].id]))?.id;
    if (!F[`k_${kunci}`]) throw new Error(`siapkanLama: kunjungan dual-write reservasi ${nama} tidak ada`);
  }
  F.k_lamaDilayani = (await satu(`SELECT kunjungan_id id FROM public.tiket_antrean WHERE id=$1`, [F.lamaDilayani.tiket])).id;
  F.k_lamaDilayani2 = (await satu(`SELECT kunjungan_id id FROM public.tiket_antrean WHERE id=$1`, [F.lamaDilayani2.tiket])).id;
  F.k_lamaSelesai = (await satu(`SELECT kunjungan_id id FROM public.tiket_antrean WHERE id=$1`, [F.lamaSelesai.tiket])).id;
}

async function siapkanTopik() {
  F.topikFo = (await satu(`SELECT id FROM public.topik_penanganan WHERE layanan_id IS NULL AND aktif ORDER BY urut LIMIT 1`))?.id;
  const r = await pgq(`INSERT INTO public.topik_penanganan (layanan_id, nama, urut) VALUES ($1,'ZZ topik WP24',1) RETURNING id`, [F.A]);
  F.topikA = r.rows?.[0]?.id;
}
async function eskalasiBaru(o = {}) {
  const m = hasil(await mulaiKunjungan(F.act.fo, o));
  if (!m) throw new Error('eskalasiBaru: fo_mulai_kunjungan gagal');
  const e = await foEskalasi(F.act.fo, m.penanganan_id, F.A, F.topikFo, 'perlu petugas');
  if (!e.ok) throw new Error(`eskalasiBaru: ${sebut(e)}`);
  return { kunjungan: m.kunjungan_id, qr: m.qr_token, pfo: m.penanganan_id, tiket: hasil(e).tiket_id, plyn: hasil(e).penanganan_layanan_id };
}
const kunj = (id) => satu(`SELECT * FROM public.kunjungan WHERE id=$1`, [id]);
const tiket = (id) => satu(`SELECT * FROM public.tiket_antrean WHERE id=$1`, [id]);
const tahap = (id) => satu(`SELECT * FROM public.penanganan WHERE id=$1`, [id]);
const visitStatus = async (id) => (await satu(`SELECT status FROM public.visit WHERE id=$1`, [id]))?.status;
const notif = (kid, type) => angka(`SELECT count(*)::int n FROM public.notifikasi WHERE payload->>'kunjungan_id'=$1 AND payload->>'type'=$2`, [kid, type]);
const rr = (layanan, kolom) => angka(`SELECT coalesce(sum(${kolom}),0)::int n FROM public.skm_response_rate WHERE layanan_id=$1`, [layanan]);
const mvBaris = async () => (await pgq(`SELECT layanan_id::text, jam_slot, avg_durasi_menit, sample_count FROM public.mv_estimasi_layanan ORDER BY 1,2`)).rows;

// ---------- snapshot katalog (fungsi, policy, trigger + status aktif, kolom, constraint, indeks, view/MV, hak, cron) ----------
async function snapshot() {
  const m = new Map();
  const tambah = async (awalan, sql) => { const q = await pgq(sql); if (!q.ok) throw new Error(`snapshot ${awalan}: ${q.code} ${q.msg}`); for (const r of q.rows) m.set(`${awalan}:${r.k}`, r.v); };
  await tambah('fn', `SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS k,
      md5(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g'))||' '||coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p.proacl::text[]) x), 'null') AS v
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'`);
  await tambah('policy', `SELECT tablename||'.'||policyname AS k, cmd||' '||roles::text||' '||md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) AS v FROM pg_policies WHERE schemaname='public'`);
  await tambah('trigger', `SELECT c.relname||'.'||t.tgname AS k, md5(pg_get_triggerdef(t.oid))||' '||t.tgenabled::text AS v
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`);
  await tambah('col', `SELECT table_name||'.'||column_name AS k, data_type||' '||is_nullable AS v FROM information_schema.columns WHERE table_schema='public'`);
  await tambah('con', `SELECT conrelid::regclass::text||'.'||conname AS k, md5(pg_get_constraintdef(oid)) AS v FROM pg_constraint WHERE connamespace='public'::regnamespace`);
  await tambah('idx', `SELECT tablename||'.'||indexname AS k, md5(indexdef) AS v FROM pg_indexes WHERE schemaname='public'`);
  await tambah('rel', `SELECT c.relname AS k, c.relkind::text||' '||coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(c.relacl::text[]) x),'null')
      ||' '||coalesce(md5(CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) END),'-')||' '||coalesce(md5(obj_description(c.oid,'pg_class')),'-') AS v
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','v','m')`);
  await tambah('cron', `SELECT jobname AS k, schedule||' '||command||' '||active AS v FROM cron.job`);
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
    (SELECT count(*) FROM public.skm_respons)::int AS skm_respons, (SELECT coalesce(sum(dilayani),0)::int FROM public.skm_response_rate) AS rr_dilayani,
    (SELECT count(*) FROM public.petugas)::int AS petugas, (SELECT count(*) FROM public.pengunjung)::int AS pengunjung,
    (SELECT count(*) FROM auth.users)::int AS auth_users, (SELECT count(*) FROM cron.job)::int AS cron_job,
    (SELECT md5(string_agg(id::text||status, ',' ORDER BY id)) FROM public.visit) AS visit_status,
    (SELECT md5(string_agg(id::text||status, ',' ORDER BY id)) FROM public.tiket_antrean) AS tiket_status`);
  return r.rows[0];
}

// ---------- fase PASCA migrasi ----------
async function fasePasca(mvSebelum, vSebelum) {
  await seksi('0. Estimasi setara: mv_estimasi_layanan dari tiket_antrean = versi visit (data historis)', async () => {
    const r = await pgq(`REFRESH MATERIALIZED VIEW public.mv_estimasi_layanan`);
    cek('REFRESH MV baru berhasil', r.ok, sebut(r));
    const sesudah = await mvBaris();
    cek(`isi MV identik dengan versi visit (${mvSebelum.length} baris)`, JSON.stringify(sesudah) === JSON.stringify(mvSebelum),
      `sebelum=${mvSebelum.length} sesudah=${sesudah.length}`);
    const v = await run(ANON, `SELECT * FROM public.v_antrian_loket ORDER BY layanan_id`);
    cek('anon membaca v_antrian_loket; kolom & jumlah baris sama', v.ok && JSON.stringify(Object.keys(v.rows[0] ?? {})) === JSON.stringify(vSebelum.kolom)
      && v.rows.length === vSebelum.n, `${sebut(v)} kolom=${JSON.stringify(Object.keys(v.rows?.[0] ?? {}))}`);
    cek('refresh_estimasi_layanan() (job 5 menit, CONCURRENTLY) berhasil', (await pgq(`SELECT public.refresh_estimasi_layanan()`)).ok);
  });

  await seksi('1. visit menjadi arsip', async () => {
    const tg = (await pgq(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='public.visit'::regclass AND NOT tgisinternal`)).rows;
    const peta = Object.fromEntries(tg.map((t) => [t.tgname, t.tgenabled]));
    const mati = ['trg_visit_dual_write', 'trg_notify_visit_selesai', 'trg_notify_reservasi_confirmed', 'trg_visit_selesai_rr',
      'trg_audit_visit_status', 'trg_log_visit_insert', 'trg_guard_visit_layanan_buka', 'trg_visit_qr_hangus'];
    cek('8 trigger efek visit nonaktif (D)', mati.every((t) => peta[t] === 'D'), JSON.stringify(peta));
    cek('trg_visit_arsip aktif, penjaga A3 terhapus', peta.trg_visit_arsip === 'O' && !('trg_guard_visit_transisi_layanan' in peta));
    await sp(async () => {
      cek('pengunjung INSERT visit (reservasi lama): 42501', ditolak(await run(F.act.visitor, `INSERT INTO public.visit (asal, pengunjung_id, nama, tujuan, tanggal_rencana, status, layanan_id)
        VALUES ('reservasi',$1,'x','loket',current_date,'terjadwal',$2)`, [F.p_visitor, F.A])));
      cek('anon INSERT visit (walk-in lama): 42501', ditolak(await run(ANON, `INSERT INTO public.visit (asal, nama, tujuan, status, layanan_id) VALUES ('walk_in','x','loket','menunggu',$1)`, [F.A])));
      cek('petugas UPDATE visit (antrian lama): 42501', ditolak(await run(F.act.petA, `UPDATE public.visit SET status='selesai' WHERE id=$1`, [F.lamaDilayani.visit])));
      cek('admin UPDATE visit (scan lama): 42501', ditolak(await run(F.act.admin, `UPDATE public.visit SET status='menunggu', waktu_scan=now() WHERE id=$1`, [F.resvLoketHariIni.id])));
      cek('pengunjung masih membaca arsip visit miliknya', ((await run(F.act.visitor, `SELECT id FROM public.visit WHERE id=$1`, [F.resvLoketHariIni.id])).rows?.length ?? 0) === 1);
      cek('pemilik tabel/definer UPDATE visit: VISIT_ARSIP', galat(await pgq(`UPDATE public.visit SET keperluan='x' WHERE id=$1`, [F.lamaDilayani.visit]), '42501', /VISIT_ARSIP/));
      cek('pemilik tabel INSERT visit: VISIT_ARSIP', galat(await pgq(`INSERT INTO public.visit (asal, nama, tujuan, status) VALUES ('walk_in','x','bertemu_seseorang','menunggu')`), '42501', /VISIT_ARSIP/));
      cek('pemilik tabel DELETE visit: VISIT_ARSIP', galat(await pgq(`DELETE FROM public.visit WHERE id=$1`, [F.resvTemuKemarin.id]), '42501', /VISIT_ARSIP/));
      await pgq(`SELECT set_config('lmh.visit_arsip','on',true)`);
      const flag = await pgq(`UPDATE public.visit SET keperluan='[flag]' WHERE id=$1`, [F.lamaDilayani.visit]);
      cek('flag lmh.visit_arsip (anonimisasi) mengizinkan', flag.ok && flag.n === 1, sebut(flag));
      await pgq(`SELECT set_config('lmh.visit_arsip','off',true)`);
    });
    await sp(async () => {
      const d = await pgq(`DELETE FROM public.pengunjung WHERE id=$1`, [F.p_visitorFk]);
      cek('hapus pengunjung: FK visit.pengunjung_id SET NULL tetap jalan', d.ok && (await satu(`SELECT pengunjung_id FROM public.visit WHERE id=$1`, [F.resvTemuKemarin.id]))?.pengunjung_id === null, sebut(d));
    });
    const penulis = (await pgq(`SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
        AND prosrc ~* '(update|insert[[:space:]]+into|delete[[:space:]]+from)[[:space:]]+public\\.visit\\M' ORDER BY 1`)).rows.map((r) => r.proname);
    cek('fungsi public yang menulis visit hanya anonymize_inactive_pengunjung', JSON.stringify(penulis) === JSON.stringify(['anonymize_inactive_pengunjung']), JSON.stringify(penulis));
    const flagA3 = (await pgq(`SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ~ 'lmh\\.antrean_rpc|fo_sinkron_visit'`)).rows.map((r) => r.proname);
    cek('tidak ada fungsi memakai lmh.antrean_rpc / fo_sinkron_visit', flagA3.length === 0, JSON.stringify(flagA3));
    const pembaca = (await pgq(`SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ~* 'public\\.visit\\M'
        AND proname NOT IN ('anonymize_inactive_pengunjung') ORDER BY 1`)).rows.map((r) => r.proname);
    info(`fungsi yang masih MEMBACA visit (arsip): ${JSON.stringify(pembaca)}`);
    cek('pembaca visit yang tersisa hanya cadangan SKM arsip + fungsi trigger visit yang nonaktif',
      pembaca.every((p) => ['get_skm_context', 'submit_skm_response', 'sync_visit_dual_write', 'visit_arsip_jaga'].includes(p)), JSON.stringify(pembaca));
    const view = (await pgq(`SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('v','m')
        AND pg_get_viewdef(c.oid) ~* '\\mvisit\\M'`)).rows.map((r) => r.relname);
    cek('tidak ada view/MV public yang membaca visit', view.length === 0, JSON.stringify(view));
  });

  await seksi('2. Reservasi lama saat cutover', async () => {
    const kl = await kunj(F.k_resvLoketHariIni);
    cek('reservasi loket lama: kunjungan dilengkapi (tujuan, layanan saran, keperluan, instansi)',
      kl.tujuan === 'loket' && kl.layanan_saran_id === F.A && kl.keperluan === 'uji lama' && kl.asal_instansi === 'ZZ Instansi Lama', JSON.stringify(kl));
    const kb = await satu(`SELECT * FROM public.kunjungan WHERE legacy_visit_id=$1`, [F.resvTemuBesok.id]);
    cek('reservasi bertemu_seseorang besok: dibuatkan kunjungan terjadwal (qr sama)', kb && kb.status === 'terjadwal' && kb.tujuan === 'bertemu_seseorang'
      && kb.nama_yang_ditemui === 'Bapak Kabid' && kb.qr_token === F.resvTemuBesok.qr_token && kb.pengunjung_id === F.p_visitor2, JSON.stringify(kb));
    cek('reservasi bertemu_seseorang yang sudah lewat: tidak dibuatkan', !(await satu(`SELECT id FROM public.kunjungan WHERE legacy_visit_id=$1`, [F.resvTemuKemarin.id])));
    await sp(async () => {
      const r = await rpc(F.act.fo, 'fo_checkin_reservasi', [F.resvLoketHariIni.qr_token]);
      const h = hasil(r);
      cek('check-in FO reservasi lama: ok, data dari kunjungan', r.ok && h.layanan_saran_id === F.A && h.keperluan === 'uji lama' && h.tujuan === 'loket', sebut(r));
      cek('visit arsip TIDAK ikut berubah (tetap terjadwal)', (await visitStatus(F.resvLoketHariIni.id)) === 'terjadwal');
      cek('notifikasi reservasi dikonfirmasi (push + email) via kunjungan', (await notif(F.k_resvLoketHariIni, 'reservasi_confirmed')) === 1
        && (await notif(F.k_resvLoketHariIni, 'reservasi_confirmed_email')) === 1);
      const s = await foSelesai(F.act.fo, h.penanganan_id, F.topikFo, 'informasi diberikan');
      cek('FO menyelesaikan: kunjungan selesai, SKM diantrekan, visit tetap', s.ok && (await kunj(F.k_resvLoketHariIni)).status === 'selesai'
        && (await notif(F.k_resvLoketHariIni, 'skm_survey')) === 1 && (await visitStatus(F.resvLoketHariIni.id)) === 'terjadwal', sebut(s));
      cek('bertemu_seseorang besok: BUKAN_HARI_INI', galat(await rpc(F.act.fo, 'fo_checkin_reservasi', [F.resvTemuBesok.qr_token]), 'P0001', /BUKAN_HARI_INI/));
      const b = await rpc(F.act.visitor2, 'reservasi_batalkan', [kb.id]);
      cek('pengunjung membatalkan reservasi lama: batal, visit tetap', b.ok && (await kunj(kb.id)).status === 'batal' && (await visitStatus(F.resvTemuBesok.id)) === 'terjadwal', sebut(b));
    });
  });

  await seksi('3. Tiket lama yang masih dilayani saat cutover', async () => {
    await sp(async () => {
      const rr0 = await rr(F.A, 'dilayani');
      const s = await selesai(F.act.petA, F.lamaDilayani.tiket);
      cek('pemilik menyelesaikan tiket lama tanpa visit: ok', s.ok && hasil(s).kunjungan_status === 'selesai', sebut(s));
      cek('tiket selesai, kunjungan selesai, visit arsip tetap dilayani', (await tiket(F.lamaDilayani.tiket)).status === 'selesai'
        && (await kunj(F.k_lamaDilayani)).status === 'selesai' && (await visitStatus(F.lamaDilayani.visit)) === 'dilayani');
      cek('response rate +1 dilayani (layanan A)', (await rr(F.A, 'dilayani')) === rr0 + 1);
      cek('SKM email + push untuk pengunjung via kunjungan', (await notif(F.k_lamaDilayani, 'skm_survey')) === 1 && (await notif(F.k_lamaDilayani, 'skm_survey_push')) === 1);
      const ctx = (await skmKonteks(ANON, F.lamaDilayani.qr)).rows?.[0];
      cek('get_skm_context (token lama = kunjungan.qr_token): eligible, belum diisi, layanan A', ctx?.eligible === true && ctx.already_submitted === false && ctx.layanan_nama === 'ZZ-TES-A', JSON.stringify(ctx));
      const k1 = await skmKirim(ANON, F.lamaDilayani.qr);
      const row = await satu(`SELECT visit_id, kunjungan_id, layanan_id FROM public.skm_respons WHERE kunjungan_id=$1`, [F.k_lamaDilayani]);
      cek('submit: submitted; respons menaut visit_id lama + kunjungan_id + layanan A', hasil(k1) === 'submitted' && row?.visit_id === F.lamaDilayani.visit
        && row?.layanan_id === F.A, `${sebut(k1)} ${JSON.stringify(row)}`);
      cek('submit kedua: duplicate', hasil(await skmKirim(ANON, F.lamaDilayani.qr)) === 'duplicate');
      cek('tiket lama: layanan_kembalikan TIKET_LAMA', galat(await rpc(F.act.petA, 'layanan_kembalikan', [F.lamaDilayani2.tiket, 'bukan ranah', null]), 'P0001', /TIKET_LAMA/));
      cek('tiket lama: admin_alihkan TIKET_LAMA', galat(await rpc(F.act.admin, 'admin_alihkan', [F.lamaDilayani2.tiket, F.B, 'salah layanan']), 'P0001', /TIKET_LAMA/));
      cek('tiket lama: bukan pemilik BUKAN_PEMILIK', ditolak(await selesai(F.act.petA2, F.lamaDilayani2.tiket), /BUKAN_PEMILIK/));
    });
    const ctx = (await skmKonteks(ANON, F.lamaSelesai.qr)).rows?.[0];
    cek('SKM yang diisi sebelum cutover: tetap terdeteksi already_submitted (backfill kunjungan_id)', ctx?.eligible === true && ctx.already_submitted === true, JSON.stringify(ctx));
    cek('backfill skm_respons.kunjungan_id dari visit_id', (await satu(`SELECT kunjungan_id FROM public.skm_respons WHERE visit_id=$1`, [F.lamaSelesai.visit]))?.kunjungan_id === F.k_lamaSelesai);
    cek('SKM lama diisi ulang: duplicate', hasil(await skmKirim(ANON, F.lamaSelesai.qr)) === 'duplicate');
  });

  await seksi('4. Alur baru: SKM, notifikasi, response rate, audit', async () => {
    await sp(async () => {
      const x = await eskalasiBaru({ pengunjung: F.p_visitor });
      cek('tiket terbit -> push "masuk antrean" untuk pengunjung', (await notif(x.kunjungan, 'tiket_menunggu')) === 1);
      const ctx0 = (await skmKonteks(ANON, x.qr)).rows?.[0];
      cek('SKM sebelum selesai: eligible false', ctx0?.eligible === false, JSON.stringify(ctx0));
      cek('submit sebelum selesai: not_completed', hasil(await skmKirim(ANON, x.qr)) === 'not_completed');
      await mulai(F.act.petA, x.tiket);
      cek('mulai -> push "giliran dimulai"', (await notif(x.kunjungan, 'tiket_dilayani')) === 1);
      const rrD = await rr(F.A, 'dilayani');
      const rrM = await rr(F.A, 'mengisi');
      const s = await selesai(F.act.petA, x.tiket, F.topikA, 'NIB terbit');
      cek('layanan_selesai: kunjungan selesai', s.ok && hasil(s).kunjungan_status === 'selesai', sebut(s));
      cek('SKM email + push masing-masing SATU kali', (await notif(x.kunjungan, 'skm_survey')) === 1 && (await notif(x.kunjungan, 'skm_survey_push')) === 1);
      const nb = await satu(`SELECT body, tujuan_email FROM public.notifikasi WHERE payload->>'kunjungan_id'=$1 AND payload->>'type'='skm_survey'`, [x.kunjungan]);
      cek('email SKM ke email profil, tautan /skm?token=<qr>', nb?.tujuan_email === 'zz-visitor@example.invalid' && nb.body.includes(`/skm?token=${x.qr}`), JSON.stringify(nb));
      cek('response rate +1 dilayani (A)', (await rr(F.A, 'dilayani')) === rrD + 1);
      const ctx = (await skmKonteks(ANON, x.qr)).rows?.[0];
      cek('get_skm_context (anon): eligible, layanan A', ctx?.eligible === true && ctx.already_submitted === false && ctx.layanan_nama === 'ZZ-TES-A', JSON.stringify(ctx));
      const k = await skmKirim(ANON, x.qr);
      const row = await satu(`SELECT visit_id, layanan_id FROM public.skm_respons WHERE kunjungan_id=$1`, [x.kunjungan]);
      cek('submit (anon): submitted, visit_id NULL, layanan A, response rate +1 mengisi', hasil(k) === 'submitted' && row?.visit_id === null
        && row?.layanan_id === F.A && (await rr(F.A, 'mengisi')) === rrM + 1, `${sebut(k)} ${JSON.stringify(row)}`);
      cek('submit kedua: duplicate; konteks already_submitted', hasil(await skmKirim(ANON, x.qr)) === 'duplicate'
        && (await skmKonteks(ANON, x.qr)).rows?.[0]?.already_submitted === true);
      const aud = (await pgq(`SELECT entitas, detail->>'status' s, actor_id FROM public.audit_log WHERE aksi='update_status' AND entitas_id IN ($1,$2) ORDER BY id`,
        [x.kunjungan, x.tiket])).rows;
      cek('audit status kunjungan + tiket tercatat (aktor dilayani = petugas A)', aud.some((a) => a.entitas === 'tiket_antrean' && a.s === 'dilayani' && a.actor_id === F.uid.petA)
        && aud.some((a) => a.entitas === 'tiket_antrean' && a.s === 'selesai') && aud.some((a) => a.entitas === 'kunjungan' && a.s === 'selesai'), JSON.stringify(aud));
      const q1 = await satu(`SELECT public.queue_notifikasi(NULL,'zz@example.invalid','email','s','b', jsonb_build_object('kunjungan_id',$1::text,'type','skm_survey')) id`, [x.kunjungan]);
      cek('queue_notifikasi idempoten per kunjungan+type', q1?.id && (await notif(x.kunjungan, 'skm_survey')) === 1);
    });
    await sp(async () => {
      const m = hasil(await mulaiKunjungan(F.act.fo, { email: 'ZZ-Walkin@Example.invalid' }));
      const rrNull = await angka(`SELECT count(*)::int n FROM public.skm_response_rate WHERE layanan_id IS NULL`);
      const s = await foSelesai(F.act.fo, m.penanganan_id, F.topikFo, 'selesai di FO');
      const e = await satu(`SELECT tujuan_email, tujuan_user_id FROM public.notifikasi WHERE payload->>'kunjungan_id'=$1 AND payload->>'type'='skm_survey'`, [m.kunjungan_id]);
      cek('walk-in FO tanpa akun + email: SKM email ke email yang dicatat FO, tanpa push', s.ok && e?.tujuan_email === 'zz-walkin@example.invalid'
        && (await notif(m.kunjungan_id, 'skm_survey_push')) === 0, `${sebut(s)} ${JSON.stringify(e)}`);
      const ctx = (await skmKonteks(ANON, m.qr_token)).rows?.[0];
      cek('SKM walk-in selesai di FO: eligible, layanan_nama NULL', ctx?.eligible === true && ctx.layanan_nama === null, JSON.stringify(ctx));
      const k = await skmKirim(ANON, m.qr_token);
      cek('submit: submitted, layanan_id NULL (tidak masuk IKM per layanan)', hasil(k) === 'submitted'
        && (await satu(`SELECT layanan_id FROM public.skm_respons WHERE kunjungan_id=$1`, [m.kunjungan_id]))?.layanan_id === null
        && (await angka(`SELECT count(*)::int n FROM public.skm_response_rate WHERE layanan_id IS NULL`)) === rrNull, sebut(k));
      const t = hasil(await mulaiKunjungan(F.act.fo));
      await foSelesai(F.act.fo, t.penanganan_id, F.topikFo, 'selesai');
      cek('walk-in FO tanpa akun dan tanpa email: tanpa notifikasi', (await angka(`SELECT count(*)::int n FROM public.notifikasi WHERE payload->>'kunjungan_id'=$1`, [t.kunjungan_id])) === 0);
      cek('token tak dikenal: konteks kosong, submit not_found', ((await skmKonteks(ANON, randomUUID().replace(/-/g, ''))).rows?.length ?? -1) === 0
        && hasil(await skmKirim(ANON, randomUUID().replace(/-/g, ''))) === 'not_found');
      cek('arsip visit tanpa kunjungan (token lama): konteks dari visit, belum selesai', (await skmKonteks(ANON, F.resvTemuKemarin.qr_token)).rows?.[0]?.eligible === false
        && hasil(await skmKirim(ANON, F.resvTemuKemarin.qr_token)) === 'not_completed');
    });
  });

  await seksi('5. Estimasi tunggu dari tiket_antrean', async () => {
    await sp(async () => {
      const x = await eskalasiBaru();
      const y = await eskalasiBaru();
      const v = (await run(ANON, `SELECT antre_count FROM public.v_antrian_loket WHERE layanan_id=$1`, [F.A])).rows?.[0];
      cek('v_antrian_loket (anon): 2 menunggu di layanan A', Number(v?.antre_count) === 2, JSON.stringify(v));
      await mulai(F.act.petA, x.tiket);
      await pgq(`UPDATE public.tiket_antrean SET waktu_mulai_layan = now() - interval '12 minutes' WHERE id=$1`, [x.tiket]);
      const jam = (await satu(`SELECT extract(hour FROM waktu_mulai_layan)::int j FROM public.tiket_antrean WHERE id=$1`, [x.tiket])).j;
      const slot = `SELECT avg_durasi_menit, sample_count FROM public.mv_estimasi_layanan WHERE layanan_id=$1 AND jam_slot=$2`;
      await pgq(`REFRESH MATERIALIZED VIEW public.mv_estimasi_layanan`);
      const e0 = await satu(slot, [F.A, jam]);
      await selesai(F.act.petA, x.tiket, F.topikA, 'selesai');
      const r = await pgq(`REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_estimasi_layanan`);
      const e = await satu(slot, [F.A, jam]);
      const harap = await satu(`SELECT avg(extract(epoch FROM (waktu_selesai - waktu_mulai_layan))/60)::int a, count(*)::int n FROM public.tiket_antrean
        WHERE layanan_id=$1 AND status='selesai' AND waktu_mulai_layan IS NOT NULL AND waktu_selesai IS NOT NULL
          AND extract(hour FROM waktu_mulai_layan)::int=$2 AND waktu_mulai_layan > now() - interval '14 days'`, [F.A, jam]);
      cek('tiket selesai baru masuk estimasi (+1 sampel, rata-rata = agregat tiket_antrean, durasi 12 menit terbaca)', r.ok
        && e?.sample_count === (e0?.sample_count ?? 0) + 1 && e.sample_count === harap.n && e.avg_durasi_menit === harap.a
        && (await angka(`SELECT round(extract(epoch FROM (waktu_selesai - waktu_mulai_layan))/60)::int n FROM public.tiket_antrean WHERE id=$1`, [x.tiket])) === 12,
        `${sebut(r)} ${JSON.stringify(e0)} -> ${JSON.stringify(e)} harap=${JSON.stringify(harap)}`);
      cek('tiket menunggu tersisa 1', Number((await run(ANON, `SELECT antre_count FROM public.v_antrian_loket WHERE layanan_id=$1`, [F.A])).rows?.[0]?.antre_count) === 1);
      void y;
    });
  });

  await seksi('6. Pengingat H-1/H-0 dan metrik kepatuhan', async () => {
    await sp(async () => {
      const awalBesok = await angka(`SELECT public.jumlah_terdaftar($1, $2::date) n`, [F.A, F.besok]);
      await pgq(`INSERT INTO public.kunjungan (pengunjung_id, nama, asal, qr_token, tanggal, status, tujuan, layanan_saran_id)
        VALUES ($1,'ZZ Resv Besok','reservasi',$2,$3::date,'terjadwal','loket',$4)`, [F.p_visitor, randomUUID().replace(/-/g, ''), F.besok, F.A]);
      cek('jumlah_terdaftar(A, besok) menghitung reservasi kunjungan', (await angka(`SELECT public.jumlah_terdaftar($1, $2::date) n`, [F.A, F.besok])) === awalBesok + 1);
      const awalHari = await angka(`SELECT public.jumlah_terdaftar($1, $2::date) n`, [F.A, F.hari_ini]);
      const x = await eskalasiBaru();
      cek('jumlah_terdaftar(A, hari ini) menghitung tiket menunggu', (await angka(`SELECT public.jumlah_terdaftar($1, $2::date) n`, [F.A, F.hari_ini])) === awalHari + 1);
      const m0 = await satu(`SELECT * FROM public.metrik_kepatuhan($1, $2::date - 7, $2::date)`, [F.A, F.hari_ini]);
      await pgq(`UPDATE public.tiket_antrean SET status='tidak_terlayani' WHERE id=$1`, [x.tiket]);
      const m1 = await satu(`SELECT * FROM public.metrik_kepatuhan($1, $2::date - 7, $2::date)`, [F.A, F.hari_ini]);
      cek('metrik_kepatuhan.warga_terdampak dari tiket tidak_terlayani', m1.warga_terdampak === m0.warga_terdampak + 1, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);
      cek('kirim_pengingat_petugas(h1, besok) berjalan', (await pgq(`SELECT public.kirim_pengingat_petugas('h1', $1::date)`, [F.besok])).ok);
    });
  });

  await seksi('7. Penutupan otomatis tahap berjalan (definisi + jadwal)', async () => {
    const j = await satu(`SELECT schedule, command, active FROM cron.job WHERE jobname='penanganan_tutup_otomatis'`);
    cek("job pg_cron 'penanganan_tutup_otomatis' 0 16 * * * (23:00 WIB)", j?.schedule === '0 16 * * *' && /tutup_penanganan_tertinggal\(\)/.test(j.command) && j.active === true, JSON.stringify(j));
    cek('CHECK batal_karena menerima tidak_ditutup', /tidak_ditutup/.test((await satu(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='penanganan_batal_karena_check'`))?.d ?? ''));
    cek('tutup_penanganan_tertinggal tidak bisa dipanggil klien', ditolak(await run(F.act.admin, `SELECT public.tutup_penanganan_tertinggal()`)));
  });

  if (ujiAkhirHari) {
    await seksi('8. Job akhir hari, no-show, penutupan otomatis (menyentuh baris produksi DALAM transaksi)', async () => {
      await sp(async () => {
        const x = await eskalasiBaru();                       // menunggu -> tidak_terlayani
        const fo = hasil(await mulaiKunjungan(F.act.fo, { email: 'zz-lupa@example.invalid' }));  // FO berjalan, lupa ditutup
        const y = await eskalasiBaru({ pengunjung: F.p_visitor });  // layanan berjalan, lupa ditutup
        await mulai(F.act.petA, y.tiket);
        const a = await pgq(`SELECT public.tandai_tidak_terlayani_akhir_hari()`);
        cek('job 16:00: tiket menunggu -> tidak_terlayani, tahap batal, kunjungan tidak_terlayani', a.ok && (await tiket(x.tiket)).status === 'tidak_terlayani'
          && (await tahap(x.plyn)).batal_karena === 'tidak_terlayani' && (await kunj(x.kunjungan)).status === 'tidak_terlayani', sebut(a));
        cek('job 16:00 tidak menyentuh tahap berjalan', (await tahap(fo.penanganan_id)).status === 'berjalan' && (await tahap(y.plyn)).status === 'berjalan');
        const ns = await pgq(`SELECT public.tandai_reservasi_no_show() AS n`);
        cek('no-show: reservasi lama (kunjungan ber-legacy) kemarin -> no_show; visit arsip tetap', ns.ok && (await kunj(F.k_resvLoketKemarin)).status === 'no_show'
          && (await visitStatus(F.resvLoketKemarin.id)) === 'terjadwal', sebut(ns));
        const audit0 = await angka(`SELECT count(*)::int n FROM public.audit_log WHERE aksi='tutup_otomatis_penanganan'`);
        const t = await pgq(`SELECT public.tutup_penanganan_tertinggal() AS n`);
        cek('tutup_penanganan_tertinggal berjalan', t.ok && Number(t.rows[0].n) >= 3, sebut(t));
        const pf = await tahap(fo.penanganan_id);
        cek('tahap FO berjalan -> batal/tidak_ditutup + catatan sistem; kunjungan selesai; SKM email', pf.status === 'batal' && pf.batal_karena === 'tidak_ditutup'
          && /otomatis/.test(pf.catatan) && (await kunj(fo.kunjungan_id)).status === 'selesai' && (await notif(fo.kunjungan_id, 'skm_survey')) === 1, JSON.stringify(pf));
        const ty = await tiket(y.tiket);
        cek('tahap layanan berjalan -> batal; tiket selesai TANPA waktu_selesai; kunjungan selesai', (await tahap(y.plyn)).batal_karena === 'tidak_ditutup'
          && ty.status === 'selesai' && ty.waktu_selesai === null && (await kunj(y.kunjungan)).status === 'selesai', JSON.stringify(ty));
        cek('tiket lama dilayani tertinggal -> selesai, kunjungan selesai', (await tiket(F.lamaDilayani2.tiket)).status === 'selesai'
          && (await kunj(F.k_lamaDilayani2)).status === 'selesai');
        cek('audit tutup_otomatis_penanganan: 2 tahap fixture tercatat', (await angka(`SELECT count(*)::int n FROM public.audit_log WHERE aksi='tutup_otomatis_penanganan'`)) - audit0 >= 2);
        await pgq(`REFRESH MATERIALIZED VIEW public.mv_estimasi_layanan`);
        cek('tiket tutup otomatis tidak masuk estimasi (waktu_selesai NULL)', (await angka(`SELECT count(*)::int n FROM public.tiket_antrean WHERE id=$1 AND waktu_selesai IS NOT NULL`, [y.tiket])) === 0);
        cek('dijalankan ulang: idempoten (tidak ada tahap fixture tersisa)', (await pgq(`SELECT public.tutup_penanganan_tertinggal()`)).ok
          && (await tahap(fo.penanganan_id)).status === 'batal');
      });
    });
  } else {
    info('seksi 8 (job akhir hari/no-show/penutupan otomatis dijalankan) dilewati; tambahkan --akhir-hari');
  }

  await seksi('9. Retensi PII 730 hari (anonymize_inactive_pengunjung)', async () => {
    await sp(async () => {
      const lama = await satu(`INSERT INTO public.kunjungan (nama, kontak_hp, email, asal_instansi, keperluan, nama_yang_ditemui, asal, qr_token, tanggal, status)
        VALUES ('ZZ Kunjungan Tua','081200000000','tua@example.invalid','ZZ PT Tua','urusan pribadi','Bu Ani','walk_in',$1,$2::date,'selesai') RETURNING id`,
        [randomUUID().replace(/-/g, ''), F.dulu]);
      await pgq(`INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, penangan_id, topik, hasil, catatan, status, mulai_at, selesai_at)
        VALUES ($1,1,'fo','walk_in',$2,'ZZ','selesai','cerita pribadi pengunjung','selesai', now() - interval '1100 days', now() - interval '1100 days')`, [lama.id, F.fo]);
      const baru = hasil(await mulaiKunjungan(F.act.fo, { hp: '081299999999', email: 'baru@example.invalid' }));
      const nyata = await satu(`SELECT (SELECT count(*) FROM public.kunjungan WHERE tanggal < (now() AT TIME ZONE 'Asia/Jakarta')::date - 730 AND id <> $1)::int k,
        (SELECT count(*) FROM public.pengunjung WHERE updated_at < now() - interval '730 days' AND email IS NOT NULL AND id <> $2)::int p`, [lama.id, F.p_tua]);
      info(`baris produksi yang ikut teranonimkan di dalam transaksi uji: kunjungan=${nyata.k}, pengunjung=${nyata.p}`);
      const r = await pgq(`SELECT public.anonymize_inactive_pengunjung()`);
      cek('job anonimisasi berjalan sebagai pg_cron (tanpa auth.uid())', r.ok, sebut(r));
      const k = await kunj(lama.id);
      cek('kunjungan > 730 hari: nama [anonim], HP/email/instansi/keperluan/yang ditemui NULL', k.nama === '[anonim]' && k.kontak_hp === null && k.email === null
        && k.asal_instansi === null && k.keperluan === null && k.nama_yang_ditemui === null, JSON.stringify(k));
      cek('penanganan.catatan kunjungan tua -> [anonim]', (await satu(`SELECT catatan FROM public.penanganan WHERE kunjungan_id=$1`, [lama.id])).catatan === '[anonim]');
      const v = await satu(`SELECT nama, nama_yang_ditemui, asal_instansi, keperluan FROM public.visit WHERE id=$1`, [F.visitDulu.id]);
      cek('arsip visit > 730 hari teranonimkan (lewat flag)', v.nama === '[anonim]' && v.nama_yang_ditemui === null && v.asal_instansi === null && v.keperluan === null, JSON.stringify(v));
      const pTua = await satu(`SELECT nama, email FROM public.pengunjung WHERE id=$1`, [F.p_tua]);
      cek('pengunjung tidak aktif > 730 hari (nama terkunci) tetap teranonimkan', pTua.nama === '[anonim]' && pTua.email === null, JSON.stringify(pTua));
      const kb = await kunj(baru.kunjungan_id);
      cek('kunjungan baru tidak tersentuh', kb.nama === 'ZZ Walkin' && kb.kontak_hp === '081299999999');
      cek('visit baru (bukan > 730 hari) tidak tersentuh', (await satu(`SELECT nama FROM public.visit WHERE id=$1`, [F.resvLoketHariIni.id])).nama === 'ZZ Resv Loket');
      cek('flag arsip mati lagi setelah job (tulis visit tetap ditolak)', galat(await pgq(`UPDATE public.visit SET keperluan='x' WHERE id=$1`, [F.resvLoketHariIni.id]), '42501', /VISIT_ARSIP/));
      cek('klien tidak bisa memanggil anonimisasi', ditolak(await run(F.act.admin, `SELECT public.anonymize_inactive_pengunjung()`)));
    });
  });
}

// ---------- main ----------
let kodeKeluar = 0;
const c2 = mkClient();
let sebelumBaris = null;
try {
  await c2.connect();
  const jam = (await c2.query(`SELECT now() AS utc, to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD HH24:MI ID') AS wib,
    extract(hour FROM now() AT TIME ZONE 'Asia/Jakarta')::int AS jam, extract(isodow FROM now() AT TIME ZONE 'Asia/Jakarta')::int AS hari`)).rows[0];
  console.log(`Waktu DB: ${jam.utc.toISOString()} (WIB ${jam.wib})`);
  if (jam.hari <= 5 && jam.jam < 16 && !paksaJam) {
    console.error('DITOLAK: masih jam layanan (hari kerja sebelum 16:00 WIB). Jalankan setelah 16:00 WIB atau pakai --paksa-jam dengan sadar.');
    process.exit(2);
  }
  sebelumBaris = await hitungBaris(c2);
  console.log('Baris SEBELUM:', JSON.stringify(sebelumBaris));

  await c.connect();
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='10s'");
  await c.query("SET LOCAL statement_timeout='120s'");
  await buatFixture();

  for (const f of preFiles) {
    console.log(`\n-- prasyarat (dalam transaksi, tidak di-commit): ${f}`);
    await c.query(readFileSync(join(root, f), 'utf8'));
  }
  await siapkanLama();
  const r0 = await pgq(`REFRESH MATERIALIZED VIEW public.mv_estimasi_layanan`);
  if (!r0.ok) throw new Error(`refresh MV versi visit: ${r0.msg}`);
  const mvSebelum = await mvBaris();
  const vs = await run(ANON, `SELECT * FROM public.v_antrian_loket ORDER BY layanan_id`);
  const vSebelum = { kolom: Object.keys(vs.rows?.[0] ?? {}), n: vs.rows?.length ?? -1 };
  const hakSebelum = await satu(`SELECT (SELECT relacl::text FROM pg_class WHERE oid='public.v_antrian_loket'::regclass) v,
    (SELECT relacl::text FROM pg_class WHERE oid='public.mv_estimasi_layanan'::regclass) m`);
  let snapAwal = null;
  if (applyFiles.length) {
    snapAwal = await snapshot();
    for (const f of applyFiles) {
      console.log(`\n-- menerapkan (dalam transaksi, tidak di-commit): ${f}`);
      await c.query(readFileSync(join(root, f), 'utf8'));
    }
    await seksi('A. Idempoten + hak view/MV tidak berubah', async () => {
      for (const f of applyFiles) cek(`ulang ${f}`, (await pgq(readFileSync(join(root, f), 'utf8'))).ok);
      const hak = await satu(`SELECT (SELECT relacl::text FROM pg_class WHERE oid='public.v_antrian_loket'::regclass) v,
        (SELECT relacl::text FROM pg_class WHERE oid='public.mv_estimasi_layanan'::regclass) m`);
      cek('hak v_antrian_loket dan mv_estimasi_layanan sama dengan sebelum migrasi', JSON.stringify(hak) === JSON.stringify(hakSebelum), `${JSON.stringify(hakSebelum)} -> ${JSON.stringify(hak)}`);
    });
  } else {
    info('tanpa --apply: menguji state DB saat ini; uji rollback dilewati');
  }
  await siapkanTopik();
  await fasePasca(mvSebelum, vSebelum);
  if (applyFiles.length) {
    await seksi('B2. Penjaga antrean kosong (setelah topik ada)', async () => {
      await sp(async () => {
        await eskalasiBaru();
        const r = await pgq(readFileSync(join(root, applyFiles[0]), 'utf8'));
        cek('menerapkan ulang 0007 saat ada tiket menunggu hari ini: CUTOVER_DITOLAK', !r.ok && /CUTOVER_DITOLAK/.test(r.msg), sebut(r));
      });
    });

    await seksi('C. Rollback mengembalikan katalog sebelum migrasi + dual-write hidup lagi', async () => {
      if (rollbackFiles.length !== applyFiles.length) {
        cek('semua berkas --apply punya rollback docs/rollback-*-<versi>.sql', false, `${rollbackFiles.length}/${applyFiles.length}`);
        return;
      }
      await pgq(`DELETE FROM public.topik_penanganan WHERE nama='ZZ topik WP24'`);
      const snapSetelah = await snapshot();
      cek('snapshot setelah apply BERBEDA dari awal (uji tidak vakum)', selisih(snapAwal, snapSetelah).length > 0);
      for (const f of rollbackFiles) {
        const r = await pgq(readFileSync(join(root, f), 'utf8'));
        cek(`rollback ${f} berhasil dieksekusi`, r.ok, `${r.code ?? ''} ${r.msg ?? ''}`);
      }
      const beda = selisih(snapAwal, await snapshot());
      cek('rollback: tidak ada selisih fungsi/policy/trigger(+aktif)/kolom/constraint/indeks/view/hak/komentar/cron', beda.length === 0, beda.join(' | '));
      await sp(async () => {
        const w = await pgq(`INSERT INTO public.visit (asal, nama, keperluan, layanan_id, tujuan, status, waktu_masuk) VALUES ('walk_in','ZZ Pasca Rollback','x',$1,'loket','menunggu',now()) RETURNING id`, [F.A]);
        cek('setelah rollback: INSERT visit walk-in kembali menerbitkan kunjungan + tiket (dual-write)', w.ok
          && !!(await satu(`SELECT id FROM public.tiket_antrean WHERE legacy_visit_id=$1`, [w.rows[0].id])), sebut(w));
        const ctx = (await skmKonteks(ANON, F.lamaSelesai.qr)).rows?.[0];
        cek('setelah rollback: SKM versi visit menjawab token lama', ctx?.eligible === true && ctx.already_submitted === true, JSON.stringify(ctx));
      });
    });
  }
} catch (e) {
  console.error('ERROR tak terduga:', e.stack);
  kodeKeluar = 2;
} finally {
  try { await c.query('RESET ROLE'); } catch { /* abaikan */ }
  try { await c.query('ROLLBACK'); console.log('\n(ROLLBACK dijalankan; tidak ada perubahan permanen)'); } catch { /* abaikan */ }
  try { await c.end(); } catch { /* abaikan */ }
}
try {
  const sesudahBaris = await hitungBaris(c2);
  console.log('Baris SESUDAH :', JSON.stringify(sesudahBaris));
  cek('jumlah/isi baris tabel kunci SEBELUM == SESUDAH ROLLBACK (tidak ada perubahan permanen)',
    JSON.stringify(sebelumBaris) === JSON.stringify(sesudahBaris));
} catch (e) { console.error('hitung baris sesudah gagal:', e.message); kodeKeluar = 2; }
try { await c2.end(); } catch { /* abaikan */ }
console.log(`\nRINGKASAN: ${lulus} lolos, ${gagal.length} gagal`);
if (gagal.length) { for (const g of gagal) console.log(' - ' + g); kodeKeluar = kodeKeluar || 1; }
process.exit(kodeKeluar);
