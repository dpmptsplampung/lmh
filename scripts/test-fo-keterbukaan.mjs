// Keterbukaan data antar Front Office (migrasi 202610140013_fo_keterbukaan_data, keputusan CEO 2026-10-14): tes PERILAKU
// (SET LOCAL ROLE + request.jwt.claims, SATU transaksi yang SELALU di-ROLLBACK). Tidak pernah COMMIT. Data uji sintetis
// (ZZ-TES-*). Menyentuh DB produksi lewat DIRECT_URL di .env.local walau semuanya di-rollback: jalankan di LUAR jam
// layanan (skrip menolak Senin-Jumat 07:00-16:59 WIB kecuali --paksa) dan hanya atas konfirmasi CEO. Migrasi yang
// diterapkan di dalam transaksi mengunci tabel sampai ROLLBACK.
// BELUM PERNAH DIJALANKAN oleh penulisnya (ditulis 2026-10-14 pada jam layanan).
//
// Pakai (DB produksi saat ini: 202610140001 sudah ada, 0002..0013 belum):
//   node scripts/test-fo-keterbukaan.mjs \
//     --pre supabase/migrations/202610140002_tiket_kepemilikan.sql \
//     --pre supabase/migrations/202610140003_fo_model_data.sql \
//     --pre supabase/migrations/202610140004_fo_rpc.sql \
//     --pre supabase/migrations/202610140005_fo_selaras_antrean.sql \
//     --pre supabase/migrations/202610140006_pernyataan_kebenaran.sql \
//     --pre supabase/migrations/202610140007_wp24_akhiri_dual_write.sql \
//     --pre supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql \
//     --pre supabase/migrations/202610140009_chat_online.sql \
//     --pre supabase/migrations/202610140011_pendataan_wajib.sql \
//     --pre supabase/migrations/202610140012_perbaikan_review.sql \
//     --apply supabase/migrations/202610140013_fo_keterbukaan_data.sql
//   --pre   = diterapkan dulu di dalam transaksi (tanpa uji rollback). 0007 menolak bila ada tiket menunggu hari ini.
//   --apply = migrasi yang diuji + uji idempoten + keadaan SEBELUM (FO-B tidak melihat milik FO-A) + penjaga rollback 0012
//             + uji rollback (snapshot katalog, FO-B kembali tidak melihat).
//   tanpa --apply: menguji state DB saat ini (0013 harus sudah diterapkan; seksi sebelum/rollback dilewati).
//
// Yang diuji: FO-B (front_office aktif) MEMBACA tahap FO berjalan/selesai milik FO-A, tahap layanan hasil eskalasi FO-A,
// kunjungan, tiket, dan boleh_tiket; FO-B TIDAK dapat menulis penanganan langsung (INSERT/UPDATE/DELETE) dan RPC
// fo_selesai / fo_eskalasi atas tahap FO-A ditolak BUKAN_PEMILIK (data tidak berubah); FO-A tetap dapat menyelesaikan.
// Peran lain tidak berubah: petugas layanan lain 0 baris, petugas layanan tujuan melihat konteks kunjungan eskalasi,
// pengunjung 0 baris, anon ditolak, FO nonaktif 0 baris.
// Harness diturunkan dari scripts/test-perbaikan-review.mjs.
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
const asUser = (uid) => ({ dbRole: 'authenticated', claims: { sub: uid, role: 'authenticated' } });

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
const pgq = (sql, params) => run(POSTGRES, sql, params);
const satu = async (sql, params) => (await pgq(sql, params)).rows?.[0];
const kode = (r, re) => !r.ok && re.test(r.msg);
const sebut = (r) => (r.ok ? `ok n=${r.n} ${JSON.stringify(r.rows?.[0] ?? null)}` : `${r.code} ${r.msg}`);
const hasil = (r) => r.rows?.[0]?.r;
/** Tulis langsung ditolak: galat hak (42501) ATAU 0 baris terpengaruh (RLS). */
const tulisDitolak = (r) => (!r.ok && r.code === '42501') || (r.ok && r.n === 0);

const rpc = (a, nama, args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  return run(a, `SELECT public.${nama}(${ph}) AS r`, args);
};
const mulaiKunjungan = (a, nama) => rpc(a, 'fo_mulai_kunjungan', [nama, 'ZZ Instansi', null, null, null, 'uji', null, null, null]);
const foEskalasi = (a, pid, layanan, topik, catatan) => rpc(a, 'fo_eskalasi', [pid, layanan, topik, catatan]);
const foSelesai = (a, pid, topik, catatan) => rpc(a, 'fo_selesai', [pid, topik, catatan]);

// ---------- fixture ----------
const F = {};
async function buatFixture() {
  const ids = {};
  for (const k of ['visitor', 'foA', 'foB', 'foMati', 'petA', 'petB']) ids[k] = randomUUID();
  F.uid = ids;
  for (const [k, uid] of Object.entries(ids)) {
    const r = await pgq(`INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES ($1,'authenticated','authenticated',$2,false)`,
      [uid, `zz-r13-${k}@example.invalid`]);
    if (!r.ok) throw new Error(`fixture auth.users ${k}: ${r.msg}`);
  }
  for (const [kunci, nama] of [['A', 'ZZ-TES-R13-A'], ['B', 'ZZ-TES-R13-B']]) {
    const r = await pgq(`INSERT INTO public.layanan (nama, is_ptsp) VALUES ($1, false) RETURNING id`, [nama]);
    if (!r.ok) throw new Error(`fixture layanan ${nama}: ${r.msg}`);
    F[kunci] = r.rows[0].id;
    for (let h = 1; h <= 7; h++) await pgq(`INSERT INTO public.jadwal_standby (layanan_id, hari, aktif) VALUES ($1,$2,true)`, [F[kunci], h]);
  }
  const pet = async (k, role, layanan, aktif = true) => {
    const r = await pgq(`INSERT INTO public.petugas (auth_user_id, nama, layanan_id, role, aktif) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [ids[k], `ZZ ${k}`, layanan, role, aktif]);
    if (!r.ok) throw new Error(`fixture petugas ${k}: ${r.msg}`);
    F[k] = r.rows[0].id;
  };
  await pet('foA', 'front_office', null);
  await pet('foB', 'front_office', null);
  await pet('foMati', 'front_office', null, true); // dinonaktifkan setelah data dibuat (lihat buatData)
  await pet('petA', 'petugas', F.A);
  await pet('petB', 'petugas', F.B);
  const v = await pgq(`INSERT INTO public.pengunjung (auth_user_id, nama, no_hp, asal_instansi, kategori, email)
    VALUES ($1,'ZZ visitor','081234567890','ZZ Instansi','Umum','zz-r13-visitor@example.invalid') RETURNING id`, [ids.visitor]);
  if (!v.ok) throw new Error(`fixture pengunjung: ${v.msg}`);
  F.act = Object.fromEntries(Object.entries(ids).map(([k, u]) => [k, asUser(u)]));
  F.topikFo = (await satu(`SELECT id FROM public.topik_penanganan WHERE layanan_id IS NULL AND aktif ORDER BY urut LIMIT 1`))?.id;
  if (!F.topikFo) throw new Error('fixture: topik FO umum tidak ada');
  await pgq(`SELECT set_config('lmh.izinkan_jam_tutup','on',true)`);
  await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);
}

// Data milik FO-A: satu tahap FO berjalan (walk-in), satu kunjungan dieskalasi ke layanan A (tahap FO selesai/dieskalasi
// + tahap layanan menunggu + tiket).
async function buatData() {
  const m1 = await mulaiKunjungan(F.act.foA, 'ZZ R13 Berjalan');
  if (!m1.ok) throw new Error(`fo_mulai_kunjungan (berjalan): ${sebut(m1)}`);
  F.kBerjalan = hasil(m1).kunjungan_id;
  F.pBerjalan = hasil(m1).penanganan_id;
  const m2 = await mulaiKunjungan(F.act.foA, 'ZZ R13 Eskalasi');
  if (!m2.ok) throw new Error(`fo_mulai_kunjungan (eskalasi): ${sebut(m2)}`);
  F.kEskalasi = hasil(m2).kunjungan_id;
  F.pFoEskalasi = hasil(m2).penanganan_id;
  const e = await foEskalasi(F.act.foA, F.pFoEskalasi, F.A, F.topikFo, 'perlu petugas A');
  if (!e.ok) throw new Error(`fo_eskalasi: ${sebut(e)}`);
  F.pLayanan = hasil(e).penanganan_layanan_id;
  F.tiket = hasil(e).tiket_id;
  F.semua = [F.pBerjalan, F.pFoEskalasi, F.pLayanan];
  await pgq(`UPDATE public.petugas SET aktif=false WHERE id=$1`, [F.foMati]);
}

const lihatPenanganan = async (a, ids = F.semua) => {
  const r = await run(a, `SELECT id FROM public.penanganan WHERE id = ANY($1::uuid[])`, [ids]);
  return r.ok ? r.rows.length : -1;
};

// ---------- snapshot untuk uji rollback ----------
async function snapshot() {
  const m = new Map();
  const f = await pgq(`SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS k,
      md5(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS def,
      coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p.proacl::text[]) x), 'null') AS acl,
      coalesce(obj_description(p.oid, 'pg_proc'), '') AS cmt
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'`);
  for (const r of f.rows) m.set(`fn:${r.k}`, `${r.def} ${r.acl} ${r.cmt}`);
  const pol = await pgq(`SELECT tablename||'.'||policyname AS k, md5(coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||cmd) AS v FROM pg_policies WHERE schemaname='public'`);
  for (const r of pol.rows) m.set(`policy:${r.k}`, r.v);
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
    (SELECT count(*) FROM public.tiket_antrean)::int AS tiket_antrean, (SELECT count(*) FROM public.petugas)::int AS petugas,
    (SELECT count(*) FROM public.audit_log)::int AS audit_log, (SELECT count(*) FROM auth.users)::int AS auth_users,
    (SELECT md5(coalesce(string_agg(id::text||status, ',' ORDER BY id), '')) FROM public.kunjungan) AS kunjungan_md5`);
  return r.rows[0];
}

// ---------- fase PASCA migrasi ----------
async function fasePasca() {
  await seksi('1. FO-B MEMBACA data milik FO-A (keterbukaan antar FO)', async () => {
    cek('FO-B melihat tahap FO berjalan, tahap FO dieskalasi, dan tahap layanan milik FO-A (3/3)', (await lihatPenanganan(F.act.foB)) === 3);
    const r = await run(F.act.foB, `SELECT p.id, pt.nama FROM public.penanganan p JOIN public.petugas pt ON pt.id = p.penangan_id WHERE p.id = $1`, [F.pBerjalan]);
    cek('FO-B membaca nama FO yang melayani (penangan = FO-A)', r.ok && r.rows[0]?.nama === 'ZZ foA', sebut(r));
    const k = await run(F.act.foB, `SELECT id FROM public.kunjungan WHERE id = ANY($1::uuid[])`, [[F.kBerjalan, F.kEskalasi]]);
    cek('FO-B membaca kunjungan milik FO-A (tidak berubah: sudah terbuka)', k.ok && k.rows.length === 2, sebut(k));
    const t = await run(F.act.foB, `SELECT id FROM public.tiket_antrean WHERE id = $1`, [F.tiket]);
    cek('FO-B membaca tiket hasil eskalasi FO-A', t.ok && t.rows.length === 1, sebut(t));
    const bt = await run(F.act.foB, `SELECT public.boleh_tiket($1) AS r`, [F.tiket]);
    cek('boleh_tiket untuk FO-B = true (Pendataan tiket terbaca untuk rekap)', bt.ok && bt.rows[0].r === true, sebut(bt));
  });

  await seksi('2. FO-B TIDAK dapat menulis / menutup pekerjaan FO-A', async () => {
    cek('UPDATE langsung penanganan milik FO-A ditolak',
      tulisDitolak(await run(F.act.foB, `UPDATE public.penanganan SET catatan='ZZ dibajak' WHERE id=$1`, [F.pBerjalan])));
    cek('DELETE langsung penanganan milik FO-A ditolak',
      tulisDitolak(await run(F.act.foB, `DELETE FROM public.penanganan WHERE id=$1`, [F.pBerjalan])));
    const ins = await run(F.act.foB, `INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status)
      VALUES ($1, 9, 'fo', 'walk_in', 'menunggu')`, [F.kBerjalan]);
    cek('INSERT langsung penanganan ditolak', !ins.ok, sebut(ins));
    const s = await foSelesai(F.act.foB, F.pBerjalan, F.topikFo, 'ZZ coba tutup milik FO-A');
    cek('fo_selesai oleh FO-B atas tahap FO-A: BUKAN_PEMILIK', kode(s, /BUKAN_PEMILIK/), sebut(s));
    const e = await foEskalasi(F.act.foB, F.pBerjalan, F.A, F.topikFo, 'ZZ coba eskalasi milik FO-A');
    cek('fo_eskalasi oleh FO-B atas tahap FO-A: BUKAN_PEMILIK', kode(e, /BUKAN_PEMILIK/), sebut(e));
    const p = await satu(`SELECT status, penangan_id, catatan FROM public.penanganan WHERE id=$1`, [F.pBerjalan]);
    cek('tahap FO-A tidak berubah (berjalan, penangan FO-A, catatan kosong)',
      p?.status === 'berjalan' && p?.penangan_id === F.foA && !p?.catatan, JSON.stringify(p));
    const ok = await foSelesai(F.act.foA, F.pBerjalan, F.topikFo, 'ZZ selesai oleh pemilik');
    cek('FO-A (pemilik) tetap dapat menyelesaikan', ok.ok, sebut(ok));
    cek('setelah selesai, FO-B tetap membaca tahap itu (riwayat semua FO)', (await lihatPenanganan(F.act.foB, [F.pBerjalan])) === 1);
  });

  await seksi('3. Peran lain TIDAK berubah', async () => {
    cek('petugas layanan B (tak terkait) melihat 0 tahap', (await lihatPenanganan(F.act.petB)) === 0);
    cek('petugas layanan A melihat konteks kunjungan eskalasi (tahap FO + layanan), bukan walk-in FO lain',
      (await lihatPenanganan(F.act.petA)) === 2);
    cek('pengunjung login melihat 0 tahap', (await lihatPenanganan(F.act.visitor)) === 0);
    const anon = await run(ANON, `SELECT id FROM public.penanganan WHERE id = ANY($1::uuid[])`, [F.semua]);
    cek('anon ditolak / 0 baris', !anon.ok || anon.rows.length === 0, sebut(anon));
    cek('FO NONAKTIF melihat 0 tahap', (await lihatPenanganan(F.act.foMati)) === 0);
  });
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
  await buatData();
  let snapAwal = null;
  if (applyFiles.length) {
    await seksi('0a. SEBELUM 0013: FO-B tidak melihat tahap FO berjalan milik FO-A (uji tidak vakum)', async () => {
      cek('FO-B melihat 0 dari tahap FO berjalan FO-A', (await lihatPenanganan(F.act.foB, [F.pBerjalan])) === 0);
    });
    snapAwal = await snapshot();
    for (const f of applyFiles) {
      console.log(`\n-- menerapkan (dalam transaksi, tidak di-commit): ${f}`);
      await c.query(readFileSync(join(root, f), 'utf8'));
    }
    await seksi('0b. Idempoten: menerapkan ulang migrasi tanpa galat', async () => {
      for (const f of applyFiles) cek(`ulang ${f}`, (await pgq(readFileSync(join(root, f), 'utf8'))).ok);
    });
  } else {
    info('tanpa --apply: menguji state DB saat ini; seksi sebelum/rollback dilewati');
  }
  await fasePasca();

  if (applyFiles.length) {
    await seksi('4. Penjaga rollback 0012 + rollback 0013 mengembalikan katalog dan perilaku lama', async () => {
      const f12 = rollbackUntuk('202610140012');
      if (f12) {
        cek('rollback 0012 DITOLAK selama 0013 terpasang',
          kode(await pgq(readFileSync(join(root, f12), 'utf8')), /ROLLBACK DITOLAK: 202610140013/));
      } else cek('rollback 0012 ada', false);
      if (rollbackFiles.length !== applyFiles.length) {
        cek('semua berkas --apply punya rollback docs/rollback-*-<versi>.sql', false, `${rollbackFiles.length}/${applyFiles.length}`);
        return;
      }
      cek('snapshot setelah apply BERBEDA dari awal (uji tidak vakum)', selisih(snapAwal, await snapshot()).length > 0);
      for (const f of rollbackFiles) {
        const r = await pgq(readFileSync(join(root, f), 'utf8'));
        cek(`rollback ${f} berhasil dieksekusi`, r.ok, `${r.code ?? ''} ${r.msg ?? ''}`);
      }
      const beda = selisih(snapAwal, await snapshot());
      cek('rollback: tidak ada selisih fungsi (def/hak/komentar)/policy', beda.length === 0, beda.join(' | '));
      // Tahap FO-A yang sudah selesai: versi 0009 tidak memberi FO-B akses (bukan miliknya, bukan kotak masuk).
      cek('setelah rollback: FO-B kembali tidak melihat tahap FO milik FO-A', (await lihatPenanganan(F.act.foB, [F.pBerjalan])) === 0);
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
  cek('jumlah baris + hash status kunjungan SEBELUM == SESUDAH ROLLBACK (tidak ada perubahan permanen)',
    JSON.stringify(sebelumBaris) === JSON.stringify(sesudahBaris));
} catch (e) { console.error('hitung baris sesudah gagal:', e.message); kodeKeluar = 2; }
try { await c2.end(); } catch { /* abaikan */ }
console.log(`\nRINGKASAN: ${lulus} lolos, ${gagal.length} gagal`);
if (gagal.length) { for (const g of gagal) console.log(' - ' + g); kodeKeluar = kodeKeluar || 1; }
process.exit(kodeKeluar);
