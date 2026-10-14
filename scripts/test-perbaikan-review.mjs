// Perbaikan review (migrasi 202610140012_perbaikan_review + batas spam/backfill 202610140009): tes PERILAKU (SET LOCAL
// ROLE + request.jwt.claims, SATU transaksi yang SELALU di-ROLLBACK). Tidak pernah COMMIT. Data uji sintetis (ZZ-TES-*).
// Menyentuh DB produksi lewat DIRECT_URL di .env.local walau semuanya di-rollback: jalankan di LUAR jam layanan (skrip
// menolak Senin-Jumat 07:00-16:59 WIB kecuali --paksa) dan hanya atas konfirmasi CEO. Migrasi yang diterapkan di dalam
// transaksi mengunci tabel (ALTER TABLE layanan/kunjungan/tiket_antrean/...) sampai ROLLBACK.
// BELUM PERNAH DIJALANKAN oleh penulisnya (ditulis 2026-10-14 pada jam layanan).
//
// Pakai (DB produksi saat ini: 202610140001 sudah ada, 0002..0012 belum):
//   node scripts/test-perbaikan-review.mjs \
//     --pre supabase/migrations/202610140002_tiket_kepemilikan.sql \
//     --pre supabase/migrations/202610140003_fo_model_data.sql \
//     --pre supabase/migrations/202610140004_fo_rpc.sql \
//     --pre supabase/migrations/202610140005_fo_selaras_antrean.sql \
//     --pre supabase/migrations/202610140006_pernyataan_kebenaran.sql \
//     --pre supabase/migrations/202610140007_wp24_akhiri_dual_write.sql \
//     --pre supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql \
//     --pre supabase/migrations/202610140009_chat_online.sql \
//     --pre supabase/migrations/202610140011_pendataan_wajib.sql \
//     --apply supabase/migrations/202610140012_perbaikan_review.sql [--akhir-hari]
//   --pre   = diterapkan dulu di dalam transaksi (tanpa uji rollback). 0007 menolak bila ada tiket menunggu hari ini.
//   --apply = migrasi yang diuji + uji idempoten + penjaga urutan rollback + uji rollback (snapshot katalog).
//   --akhir-hari = juga menjalankan tandai_reservasi_no_show() (mengunci reservasi terjadwal lewat tanggal).
//   tanpa --apply: menguji state DB saat ini (seksi fixture-sebelum-migrasi dan rollback dilewati).
//
// TIDAK tercakup: konkurensi SEJATI (dua koneksi serentak) untuk ON CONFLICT fo_mulai_kunjungan dan kunci advisory
// reservasi_buat; yang diuji hanya jalur berurutan. Harness diturunkan dari scripts/test-fo-eskalasi.mjs.
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
let ujiAkhirHari = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--apply') applyFiles.push(argv[++i]);
  else if (argv[i] === '--pre') preFiles.push(argv[++i]);
  else if (argv[i] === '--paksa') paksa = true;
  else if (argv[i] === '--akhir-hari') ujiAkhirHari = true;
}

const berkasDocs = readdirSync(join(root, 'docs'));
const rollbackUntuk = (versi) => {
  const cocok = berkasDocs.find((d) => d.startsWith('rollback-') && d.endsWith(`-${versi}.sql`));
  return cocok ? `docs/${cocok}` : null;
};
const rollbackFiles = applyFiles
  .map((f) => { const m = basename(f).match(/^(\d{12})_/); return m ? rollbackUntuk(m[1]) : null; })
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

const galat = (r, code, re) => !r.ok && r.code === code && (!re || re.test(r.msg));
const kode = (r, re) => !r.ok && re.test(r.msg);
const sebut = (r) => (r.ok ? `ok n=${r.n} ${JSON.stringify(r.rows?.[0] ?? null)}` : `${r.code} ${r.msg}`);
const hasil = (r) => r.rows?.[0]?.r;

const rpc = (a, nama, args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return run(a, `SELECT public.${nama}(${ph}) AS r`, args);
};
const mulaiKunjungan = (a, o = {}) => rpc(a, 'fo_mulai_kunjungan', [
  o.nama ?? 'ZZ Walkin', o.instansi ?? 'ZZ Instansi', null, null, null, 'uji', null, o.pengunjung ?? null, o.crid ?? null]);
const foEskalasi = (a, pid, layanan, topik, catatan) => rpc(a, 'fo_eskalasi', [pid, layanan, topik, catatan]);
const mulai = (a, t) => rpc(a, 'layanan_mulai', [t]);
const selesai = (a, t, form = null, payload = null, topik = null, catatan = null) =>
  run(a, `SELECT public.layanan_selesai($1, $2, $3::jsonb, $4, $5) AS r`, [t, form, payload ? JSON.stringify(payload) : null, topik, catatan]);

const PAYLOAD_OSS = {
  nama_pemohon: 'ZZ Pemohon', alamat_pemohon: 'ZZ Jalan', no_hp: '081234567890', email: 'zz@example.invalid',
  keperluan_awal: 'ZZ urus NIB', nama_usaha: 'ZZ Usaha', tipe_pelaku_usaha: 'perseorangan', status_penanaman_modal: 'PMDN',
  lokasi_usaha: 'ZZ Lampung', skala_usaha: 'Mikro', sektor_usaha_kbli: '47111', tindak_lanjut: 'NIB terbit',
  uraian_solusi: 'ZZ dibantu', catatan_internal: '-',
};

// ---------- fixture ----------
const F = {};
async function buatFixture() {
  const ids = {};
  for (const k of ['visitor', 'admin', 'fo', 'petA', 'petO', 'petO2']) ids[k] = randomUUID();
  F.uid = ids;
  for (const [k, uid] of Object.entries(ids)) {
    const r = await pgq(`INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES ($1,'authenticated','authenticated',$2,false)`,
      [uid, `zz-r12-${k}@example.invalid`]);
    if (!r.ok) throw new Error(`fixture auth.users ${k}: ${r.msg}`);
  }
  // A: tanpa pendataan; O: nama memuat OSS (nilai awal form_pendataan 'oss'); P: "Non OSS" (perizinan); C: tanpa jadwal.
  for (const [kunci, nama, jadwal] of [['A', 'ZZ-TES-R12-A', true], ['O', 'ZZ-TES-R12 OSS', true], ['P', 'ZZ-TES-R12 Non OSS', true], ['C', 'ZZ-TES-R12-C', false]]) {
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
  await pet('petA', 'petugas', F.A);
  await pet('petO', 'petugas', F.O);
  await pet('petO2', 'petugas', F.O);
  const v = await pgq(`INSERT INTO public.pengunjung (auth_user_id, nama, no_hp, asal_instansi, kategori, email)
    VALUES ($1,'ZZ visitor','081234567890','ZZ Instansi','Umum','zz-r12-visitor@example.invalid') RETURNING id`, [ids.visitor]);
  if (!v.ok) throw new Error(`fixture pengunjung: ${v.msg}`);
  F.p_visitor = v.rows[0].id;
  F.act = Object.fromEntries(Object.entries(ids).map(([k, u]) => [k, asUser(u)]));
  F.hariIni = (await satu(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date,'YYYY-MM-DD') AS d`)).d;
  F.kemarin = (await satu(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date - 1,'YYYY-MM-DD') AS d`)).d;
  await pgq(`SELECT set_config('lmh.izinkan_jam_tutup','on',true)`);
  await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);
}

// Fixture SEBELUM 0012: walk-in lama 'terjadwal' dan sesi chat tertinggal (> 24 jam) / segar.
async function siapkanLama() {
  const ins = async (tgl) => (await satu(`INSERT INTO public.kunjungan (nama, asal, qr_token, tanggal, status)
    VALUES ('ZZ Walkin Lama','walk_in',$1,$2::date,'terjadwal') RETURNING id`, [randomUUID().replace(/-/g, ''), tgl]))?.id;
  F.walkinKemarin = await ins(F.kemarin);
  F.walkinHariIni = await ins(F.hariIni);
  const sesi = async (status) => {
    const r = await pgq(`INSERT INTO public.chat_sesi (layanan_id, pengunjung_id, kontak_pengunjung, status)
      VALUES ($1,$2,'ZZ R12','bot') RETURNING id`, [F.A, F.p_visitor]);
    const sid = r.rows[0].id;
    await pgq(`INSERT INTO public.chat_pesan (sesi_id, pengirim, isi) VALUES ($1,'pengunjung','ZZ halo')`, [sid]);
    if (status !== 'bot') await pgq(`UPDATE public.chat_sesi SET status='eskalasi' WHERE id=$1`, [sid]);
    return sid;
  };
  F.chatTua = await sesi('eskalasi');
  F.chatTuaAktif = await sesi('eskalasi');
  F.chatSegar = await sesi('eskalasi');
  // FO mengambil chatTuaAktif (tahap berjalan), lalu semua aktivitas sesi tua dimundurkan 2 hari.
  const a = await rpc(F.act.fo, 'chat_ambil', [F.chatTuaAktif, null]);
  if (!a.ok) info(`chat_ambil fixture gagal: ${sebut(a)}`);
  for (const sid of [F.chatTua, F.chatTuaAktif]) {
    await pgq(`UPDATE public.chat_pesan SET created_at = now() - interval '2 days' WHERE sesi_id=$1`, [sid]);
    await pgq(`UPDATE public.chat_sesi SET created_at = now() - interval '2 days' WHERE id=$1`, [sid]);
  }
}

async function siapkanTopik() {
  F.topikFo = (await satu(`SELECT id FROM public.topik_penanganan WHERE layanan_id IS NULL AND aktif ORDER BY urut LIMIT 1`))?.id;
  for (const k of ['A', 'O']) {
    const r = await pgq(`INSERT INTO public.topik_penanganan (layanan_id, nama, urut) VALUES ($1,'ZZ topik',1) RETURNING id`, [F[k]]);
    F[`topik${k}`] = r.rows?.[0]?.id;
  }
}

async function eskalasiBaru(layanan) {
  const m = hasil(await mulaiKunjungan(F.act.fo));
  const e = await foEskalasi(F.act.fo, m.penanganan_id, layanan, F.topikFo, 'perlu petugas');
  if (!e.ok) throw new Error(`eskalasiBaru: ${sebut(e)}`);
  return { kunjungan: m.kunjungan_id, pfo: m.penanganan_id, tiket: hasil(e).tiket_id, plyn: hasil(e).penanganan_layanan_id };
}
const kunj = (id) => satu(`SELECT * FROM public.kunjungan WHERE id=$1`, [id]);
const tiket = (id) => satu(`SELECT * FROM public.tiket_antrean WHERE id=$1`, [id]);
const sesiChat = (id) => satu(`SELECT * FROM public.chat_sesi WHERE id=$1`, [id]);

// ---------- snapshot untuk uji rollback ----------
async function snapshot() {
  const m = new Map();
  const f = await pgq(`SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS k,
      md5(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS def,
      coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p.proacl::text[]) x), 'null') AS acl
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'`);
  for (const r of f.rows) m.set(`fn:${r.k}`, `${r.def} ${r.acl}`);
  const tg = await pgq(`SELECT c.relname||'.'||t.tgname AS k, md5(pg_get_triggerdef(t.oid)) AS v FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`);
  for (const r of tg.rows) m.set(`trigger:${r.k}`, r.v);
  const col = await pgq(`SELECT table_name||'.'||column_name AS k, data_type||' '||is_nullable AS v FROM information_schema.columns WHERE table_schema='public'`);
  for (const r of col.rows) m.set(`col:${r.k}`, r.v);
  const con = await pgq(`SELECT conrelid::regclass::text||'.'||conname AS k, md5(pg_get_constraintdef(oid)) AS v FROM pg_constraint WHERE connamespace='public'::regnamespace`);
  for (const r of con.rows) m.set(`con:${r.k}`, r.v);
  const job = await pgq(`SELECT jobname AS k, schedule||' '||command AS v FROM cron.job`);
  for (const r of job.rows ?? []) m.set(`cron:${r.k}`, r.v);
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
    (SELECT count(*) FROM public.tiket_antrean)::int AS tiket_antrean, (SELECT count(*) FROM public.chat_sesi)::int AS chat_sesi,
    (SELECT count(*) FROM public.chat_pesan)::int AS chat_pesan, (SELECT count(*) FROM public.audit_log)::int AS audit_log,
    (SELECT count(*) FROM public.rekap_harian_layanan)::int AS rekap, (SELECT count(*) FROM auth.users)::int AS auth_users,
    (SELECT md5(coalesce(string_agg(id::text||status, ',' ORDER BY id), '')) FROM public.kunjungan) AS kunjungan_md5,
    (SELECT md5(coalesce(string_agg(id::text||status, ',' ORDER BY id), '')) FROM public.chat_sesi) AS sesi_md5`);
  return r.rows[0];
}

// ---------- fase PASCA migrasi ----------
async function fasePasca(adaApply) {
  if (adaApply) {
    await seksi('1. Gerbang 0012: walk-in terjadwal dan chat tertinggal', async () => {
      for (const [nama, id] of [['kemarin', F.walkinKemarin], ['hari ini', F.walkinHariIni]]) {
        const k = await kunj(id);
        const a = await satu(`SELECT count(*)::int AS n FROM public.audit_log WHERE aksi='tutup_walkin_terjadwal' AND entitas_id=$1`, [id]);
        cek(`#5 walk-in terjadwal ${nama} -> batal + audit tutup_walkin_terjadwal`, k?.status === 'batal' && a.n === 1, JSON.stringify({ k: k?.status, a }));
      }
      const t = await sesiChat(F.chatTua);
      const kt = t?.kunjungan_id ? await kunj(t.kunjungan_id) : null;
      const pt = (await pgq(`SELECT status, batal_karena FROM public.penanganan WHERE chat_sesi_id=$1`, [F.chatTua])).rows;
      cek('#11 sesi eskalasi tua (belum diambil) -> selesai; kunjungan tidak_terlayani; tahap batal/tidak_terlayani',
        t?.status === 'selesai' && kt?.status === 'tidak_terlayani' && pt.length === 1 && pt[0].batal_karena === 'tidak_terlayani',
        JSON.stringify({ t: t?.status, kt: kt?.status, pt }));
      const ta = await sesiChat(F.chatTuaAktif);
      const ka = ta?.kunjungan_id ? await kunj(ta.kunjungan_id) : null;
      const pa = (await pgq(`SELECT status, batal_karena FROM public.penanganan WHERE chat_sesi_id=$1 ORDER BY tahap_ke`, [F.chatTuaAktif])).rows;
      cek('#11 sesi aktif tua (FO memegang) -> selesai; kunjungan selesai; tahap batal/tidak_ditutup; penangan dipertahankan',
        ta?.status === 'selesai' && ka?.status === 'selesai' && pa.at(-1)?.batal_karena === 'tidak_ditutup' && ta.ditangani_oleh === F.fo,
        JSON.stringify({ ta: ta?.status, ka: ka?.status, pa }));
      const pesan = await satu(`SELECT isi FROM public.chat_pesan WHERE sesi_id=$1 AND pengirim='bot' ORDER BY created_at DESC LIMIT 1`, [F.chatTua]);
      cek('#11 pesan sistem penutupan otomatis', /ditutup otomatis/.test(pesan?.isi ?? ''), pesan?.isi);
      cek('#11 sesi segar tidak disentuh', (await sesiChat(F.chatSegar))?.status === 'eskalasi');
      const job = await satu(`SELECT schedule, command FROM cron.job WHERE jobname='chat_tutup_otomatis'`);
      cek('#11 job chat_tutup_otomatis 30 16 * * *', job?.schedule === '30 16 * * *' && /tutup_chat_tertinggal/.test(job.command), JSON.stringify(job));
      const ulang = await satu(`SELECT public.tutup_chat_tertinggal() AS n`);
      cek('#11 job dijalankan ulang: tidak ada sesi lain dari fixture yang ditutup', (await sesiChat(F.chatSegar))?.status === 'eskalasi', `n=${ulang?.n}`);
    });
  }

  await seksi('2. #1 Formulir Pendataan wajib per layanan', async () => {
    const f = async (id) => (await satu(`SELECT form_pendataan FROM public.layanan WHERE id=$1`, [id]))?.form_pendataan ?? null;
    if (adaApply) cek('nilai awal dari nama: OSS->oss, Non OSS->perizinan, lain->NULL', (await f(F.O)) === 'oss' && (await f(F.P)) === 'perizinan' && (await f(F.A)) === null);
    await sp(async () => {
      const r = await pgq(`INSERT INTO public.layanan (nama, is_ptsp) VALUES ('ZZ-TES-R12 OSS Baru', false) RETURNING id, form_pendataan`);
      cek('layanan baru diisi trigger dari nama', r.ok && r.rows[0].form_pendataan === 'oss', sebut(r));
      const u = await run(F.act.admin, `UPDATE public.layanan SET form_pendataan='perizinan' WHERE id=$1 RETURNING form_pendataan`, [r.rows?.[0]?.id]);
      info(`Admin mengubah form_pendataan langsung (RLS layanan_admin_all): ${sebut(u)}`);
      const salah = await pgq(`UPDATE public.layanan SET form_pendataan='lain' WHERE id=$1`, [F.O]);
      cek('CHECK menolak nilai di luar oss/perizinan', galat(salah, '23514'), sebut(salah));
    });
    await sp(async () => {
      const x = await eskalasiBaru(F.O);
      cek('petugas O mulai', (await mulai(F.act.petO, x.tiket)).ok);
      cek('tanpa form pada layanan wajib oss: INVALID_PAYLOAD 22023 (tiket tetap dilayani)',
        galat(await selesai(F.act.petO, x.tiket, null, null, F.topikO, 'x'), '22023', /INVALID_PAYLOAD/)
        && (await tiket(x.tiket)).status === 'dilayani');
      cek('form tidak cocok (perizinan): INVALID_PAYLOAD',
        galat(await selesai(F.act.petO, x.tiket, 'perizinan', PAYLOAD_OSS, F.topikO, 'x'), '22023', /INVALID_PAYLOAD/));
      const ok = await selesai(F.act.petO, x.tiket, 'oss', PAYLOAD_OSS, F.topikO, 'NIB terbit');
      cek('form oss lengkap: selesai + data terkunci', ok.ok && hasil(ok).is_locked === true
        && (await satu(`SELECT is_locked FROM public.pelayanan_oss WHERE tiket_id=$1`, [x.tiket]))?.is_locked === true, sebut(ok));
    });
    await sp(async () => {
      const x = await eskalasiBaru(F.A);
      await mulai(F.act.petA, x.tiket);
      cek('layanan tanpa kewajiban: selesai tanpa form tetap boleh', (await selesai(F.act.petA, x.tiket, null, null, F.topikA, 'ok')).ok);
    });
    await sp(async () => {
      const x = await eskalasiBaru(F.O);
      await mulai(F.act.petO, x.tiket);
      const aa = await rpc(F.act.admin, 'admin_ambil_alih', [x.tiket, 'petugas O pulang sakit']);
      cek('Admin mengambil alih tiket O', aa.ok, sebut(aa));
      const s = await selesai(F.act.admin, x.tiket, null, null, F.topikO, 'ditutup Admin');
      cek('Admin pengambil alih menutup TANPA form (pengecualian) + audit layanan_selesai_tanpa_pendataan', s.ok
        && (await satu(`SELECT count(*)::int AS n FROM public.audit_log WHERE aksi='layanan_selesai_tanpa_pendataan' AND entitas_id=$1`, [x.tiket])).n === 1, sebut(s));
      const y = await eskalasiBaru(F.O);
      await mulai(F.act.admin, y.tiket);
      cek('Admin yang memulai sendiri (tanpa ambil alih) tetap wajib form: INVALID_PAYLOAD',
        galat(await selesai(F.act.admin, y.tiket, null, null, F.topikO, 'x'), '22023', /INVALID_PAYLOAD/));
    });
  });

  await seksi('3. #2 get_queue_position dengan qr_token 32 hex (anon)', async () => {
    await sp(async () => {
      const x = await eskalasiBaru(F.A);
      const qr = (await kunj(x.kunjungan)).qr_token;
      cek('qr_token kunjungan baru 32 hex', /^[0-9a-f]{32}$/.test(qr ?? ''), qr);
      const r = await run(ANON, `SELECT * FROM public.get_queue_position($1::uuid)`, [qr]);
      cek('posisi antrean terbaca (sebelumnya selalu kosong)', r.ok && r.rows?.length === 1 && r.rows[0].posisi >= 1, sebut(r));
      const r2 = await run(ANON, `SELECT * FROM public.get_queue_position($1::uuid)`, [randomUUID()]);
      cek('token tak dikenal: kosong', r2.ok && r2.rows.length === 0, sebut(r2));
    });
  });

  await seksi('4. #4/#12 fo_mulai_kunjungan', async () => {
    await sp(async () => {
      const crid = randomUUID();
      const a1 = hasil(await mulaiKunjungan(F.act.fo, { crid }));
      const a2 = hasil(await mulaiKunjungan(F.act.fo, { crid }));
      cek('idempoten berurutan: sudah_ada (jalur ON CONFLICT hanya teruji pada konkurensi sejati)', a2?.sudah_ada === true && a2.kunjungan_id === a1?.kunjungan_id);
      cek('#12 pengunjung tanpa kunjungan hari ini: DATA_TIDAK_VALID',
        galat(await mulaiKunjungan(F.act.fo, { pengunjung: F.p_visitor }), '22023', /DATA_TIDAK_VALID/));
      cek('#12 pengunjung tak ada: NOT_FOUND', galat(await mulaiKunjungan(F.act.fo, { pengunjung: randomUUID() }), 'P0002', /NOT_FOUND/));
      await pgq(`INSERT INTO public.kunjungan (pengunjung_id, nama, asal, qr_token, tanggal, status, tujuan)
        VALUES ($1,'ZZ Resv','reservasi',$2,$3::date,'batal','loket')`, [F.p_visitor, randomUUID().replace(/-/g, ''), F.hariIni]);
      const ok = await mulaiKunjungan(F.act.fo, { pengunjung: F.p_visitor });
      cek('#12 pengunjung dengan kunjungan/reservasi hari ini: tertaut', ok.ok && (await kunj(hasil(ok).kunjungan_id)).pengunjung_id === F.p_visitor, sebut(ok));
    });
  });

  await seksi('5. #7 layanan_mulai BUKAN_HARI_INI, #8 admin_alihkan jadwal/tutup, #9 reservasi', async () => {
    await sp(async () => {
      const x = await eskalasiBaru(F.A);
      const u = await pgq(`UPDATE public.tiket_antrean SET tanggal = $2::date WHERE id=$1`, [x.tiket, F.kemarin]);
      if (!u.ok) { info(`tidak bisa memundurkan tanggal tiket fixture (${sebut(u)}); #7 dilewati`); return; }
      cek('#7 tiket kemarin: BUKAN_HARI_INI (P0001), tiket tetap menunggu',
        galat(await mulai(F.act.petA, x.tiket), 'P0001', /BUKAN_HARI_INI/) && (await tiket(x.tiket)).status === 'menunggu');
    });
    await sp(async () => {
      const x = await eskalasiBaru(F.A);
      cek('#8 alihkan ke layanan tanpa jadwal: LAYANAN_TIDAK_BUKA',
        galat(await rpc(F.act.admin, 'admin_alihkan', [x.tiket, F.C, 'salah layanan']), 'P0001', /LAYANAN_TIDAK_BUKA/));
      await pgq(`UPDATE public.site_settings SET value='00:01' WHERE key='jam_tutup_layanan'`);
      cek('#8 alihkan setelah jam tutup: LAYANAN_TUTUP',
        galat(await rpc(F.act.admin, 'admin_alihkan', [x.tiket, F.O, 'salah layanan']), 'P0001', /LAYANAN_TUTUP/));
      cek('#8 penolakan tidak mengubah tiket', (await tiket(x.tiket)).status === 'menunggu');
    });
    await sp(async () => {
      const tgl = (await satu(`SELECT to_char(d,'YYYY-MM-DD') d FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date,
        (now() AT TIME ZONE 'Asia/Jakarta')::date + 7, interval '1 day') AS g(d) WHERE extract(isodow FROM d) < 6 ORDER BY d LIMIT 1`)).d;
      const r = await rpc(F.act.visitor, 'reservasi_buat', ['bertemu_seseorang', tgl, randomUUID(), 'Bapak Kepala', 'uji', null]);
      cek('#9 bertemu_seseorang dengan p_layanan_id acak: ok, layanan_saran_id NULL (kunci = tujuan efektif)',
        r.ok && (await kunj(hasil(r).kunjungan_id)).layanan_saran_id === null, sebut(r));
    });
  });

  await seksi('6. #10 rollup_rekap_harian: dikembalikan + eskalasi ulang = 1 hadir', async () => {
    await sp(async () => {
      const x = await eskalasiBaru(F.A);
      await mulai(F.act.petA, x.tiket);
      const k = await rpc(F.act.petA, 'layanan_kembalikan', [x.tiket, 'kembali ke FO', null]);
      const pfo = hasil(k)?.penanganan_fo_id;
      await rpc(F.act.fo, 'fo_ambil_dari_kotak_masuk', [pfo]);
      const e2 = await foEskalasi(F.act.fo, pfo, F.A, F.topikFo, 'ulang');
      const t2 = hasil(e2)?.tiket_id;
      await mulai(F.act.petA, t2);
      const s = await selesai(F.act.petA, t2, null, null, F.topikA, 'selesai');
      cek('alur dikembalikan -> eskalasi ulang ke layanan sama -> selesai', k.ok && e2.ok && s.ok, `${sebut(k)} / ${sebut(e2)} / ${sebut(s)}`);
      const r = await pgq(`SELECT public.rollup_rekap_harian((now() AT TIME ZONE 'Asia/Jakarta')::date)`);
      const rek = await satu(`SELECT total_hadir, total_selesai, rata_durasi_menit FROM public.rekap_harian_layanan
        WHERE layanan_id=$1 AND tanggal=(now() AT TIME ZONE 'Asia/Jakarta')::date`, [F.A]);
      cek('total_hadir = 1 kunjungan (bukan 2 tiket), total_selesai = 1', r.ok && rek?.total_hadir === 1 && rek.total_selesai === 1, JSON.stringify(rek));
    });
  });

  if (ujiAkhirHari) {
    await seksi('7. #5 job no-show: walk-in terjadwal tanggal lewat -> batal (mengunci reservasi terjadwal!)', async () => {
      await sp(async () => {
        const w = await satu(`INSERT INTO public.kunjungan (nama, asal, qr_token, tanggal, status)
          VALUES ('ZZ Walkin Job','walk_in',$1,$2::date,'terjadwal') RETURNING id`, [randomUUID().replace(/-/g, ''), F.kemarin]);
        const r = await pgq(`SELECT public.tandai_reservasi_no_show() AS n`);
        cek('job berjalan; walk-in kemarin batal + audit', r.ok && (await kunj(w.id)).status === 'batal'
          && (await satu(`SELECT count(*)::int AS n FROM public.audit_log WHERE aksi='tutup_walkin_terjadwal' AND entitas_id=$1`, [w.id])).n === 1, sebut(r));
      });
    });
  } else {
    info('seksi job no-show dilewati (tambahkan --akhir-hari)');
  }
}

// ---------- main ----------
const jam = await (async () => {
  const cl = mkClient();
  await cl.connect();
  const r = await cl.query(`SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD HH24:MI') AS t,
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
  for (const f of preFiles) {
    console.log(`\n-- prasyarat (dalam transaksi, tidak di-commit): ${f}`);
    await c.query(readFileSync(join(root, f), 'utf8'));
  }
  await buatFixture();
  await siapkanTopik();
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
    info('tanpa --apply: menguji state DB saat ini; gerbang 0012 dan rollback dilewati');
  }
  await fasePasca(applyFiles.length > 0);

  if (applyFiles.length) {
    await seksi('8. #3 Penjaga urutan rollback + rollback 0012 mengembalikan katalog', async () => {
      for (const [versi, re] of [['202610140011', /ROLLBACK DITOLAK: 202610140012/], ['202610140009', /ROLLBACK DITOLAK: 202610140012/], ['202610140007', /ROLLBACK DITOLAK: 202610140012/]]) {
        const f = rollbackUntuk(versi);
        if (!f) { cek(`rollback ${versi} ada`, false); continue; }
        cek(`rollback ${versi} DITOLAK selama 0012 terpasang`, kode(await pgq(readFileSync(join(root, f), 'utf8')), re));
      }
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
      cek('rollback: tidak ada selisih fungsi/trigger/kolom/constraint/cron', beda.length === 0, beda.join(' | '));
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
  cek('jumlah baris + hash status kunjungan/sesi SEBELUM == SESUDAH ROLLBACK (tidak ada perubahan permanen)',
    JSON.stringify(sebelumBaris) === JSON.stringify(sesudahBaris));
} catch (e) { console.error('hitung baris sesudah gagal:', e.message); kodeKeluar = 2; }
try { await c2.end(); } catch { /* abaikan */ }
console.log(`\nRINGKASAN: ${lulus} lolos, ${gagal.length} gagal`);
if (gagal.length) { for (const g of gagal) console.log(' - ' + g); kodeKeluar = kodeKeluar || 1; }
process.exit(kodeKeluar);
