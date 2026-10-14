// Data walk-in lengkap (migrasi 202610140014_walkin_data_lengkap, permintaan CEO 2026-10-14): tes PERILAKU
// fo_mulai_kunjungan (SET LOCAL ROLE + request.jwt.claims, SATU transaksi yang SELALU di-ROLLBACK). Tidak pernah COMMIT.
// Data uji sintetis (ZZ-TES-R14 / zz-r14-*). Menyentuh DB produksi lewat DIRECT_URL di .env.local walau semuanya
// di-rollback: jalankan di LUAR jam layanan (skrip menolak Senin-Jumat 07:00-16:59 WIB kecuali --paksa) dan hanya atas
// konfirmasi CEO. Migrasi yang diterapkan di dalam transaksi mengunci fungsi sampai ROLLBACK.
// Dijalankan 2026-10-14 ±21:29 WIB (di luar jam layanan, ROLLBACK) dengan --apply 0014 pada DB yang memuat 0013:
// 96 lolos, 0 gagal; snapshot katalog setelah rollback identik; baris SEBELUM == SESUDAH (datctype en_US.UTF-8).
//
// Pakai (DB produksi: 202610140001..0013 sudah diterapkan):
//   node scripts/test-walkin-data.mjs --apply supabase/migrations/202610140014_walkin_data_lengkap.sql
//   --pre   = diterapkan dulu di dalam transaksi (tanpa uji rollback); TIDAK diperlukan bila DB sudah memuat 0013.
//   --apply = migrasi yang diuji + uji idempoten + keadaan SEBELUM (versi 0012 menerima HP kosong) + uji rollback
//             (snapshot katalog fungsi/hak/komentar/policy identik; perilaku 0012 kembali).
//   tanpa --apply: menguji state DB saat ini (0014 harus sudah diterapkan; seksi sebelum/rollback dilewati).
//
// Jam tutup: fixture menimpa site_settings.jam_tutup_layanan = '23:59' DI DALAM transaksi (bypass trigger lewat
// set_config('lmh.izinkan_jam_tutup','on',true), pola test-fo-eskalasi.mjs), sehingga validasi dapat diuji malam hari
// tanpa melonggarkan fungsi produksi. Seksi LAYANAN_TUTUP menyetel '00:01' (juga di-rollback).
// Harness diturunkan dari scripts/test-fo-keterbukaan.mjs.
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
const sebut = (r) => (r.ok ? `ok ${JSON.stringify(r.rows?.[0]?.r ?? r.rows?.[0] ?? null)}` : `${r.code} ${r.msg} [detail=${r.detail ?? ''}]`);
const hasil = (r) => r.rows?.[0]?.r;

// ---------- fo_mulai_kunjungan ----------
const SAH = {
  nama: 'ZZ Tes Walkin',
  asal: 'ZZ Dinas Uji',
  hp: '081234567890',
  kat: 'Umum',
  email: 'zz-r14-pengunjung@example.invalid',
  kep: 'ZZ uji pendaftaran walk-in',
  saran: null,
  pid: null,
  crid: null,
};
function mulai(a, ubah = {}) {
  const d = { ...SAH, ...ubah };
  return run(a, 'SELECT public.fo_mulai_kunjungan($1,$2,$3,$4,$5,$6,$7,$8,$9) AS r',
    [d.nama, d.asal, d.hp, d.kat, d.email, d.kep, d.saran, d.pid, d.crid]);
}
/** DATA_TIDAK_VALID (22023) dengan DETAIL = field. */
const tolakField = (r, field) => !r.ok && r.code === '22023' && /^DATA_TIDAK_VALID:/.test(r.msg) && r.detail === field;
const kunjungan = (id) => satu(`SELECT nama, asal_instansi, kontak_hp, kategori, email, keperluan, layanan_saran_id, status, asal
  FROM public.kunjungan WHERE id=$1`, [id]);

// ---------- fixture ----------
const F = {};
async function buatFixture() {
  const ids = { fo: randomUUID(), fo2: randomUUID(), pet: randomUUID() };
  for (const [k, uid] of Object.entries(ids)) {
    const r = await pgq(`INSERT INTO auth.users (id, aud, role, email, is_anonymous) VALUES ($1,'authenticated','authenticated',$2,false)`,
      [uid, `zz-r14-${k}@example.invalid`]);
    if (!r.ok) throw new Error(`fixture auth.users ${k}: ${r.msg}`);
  }
  for (const [kunci, nama, aktif] of [['A', 'ZZ-TES-R14-A', true], ['Mati', 'ZZ-TES-R14-MATI', false]]) {
    const r = await pgq(`INSERT INTO public.layanan (nama, is_ptsp, aktif) VALUES ($1, false, $2) RETURNING id`, [nama, aktif]);
    if (!r.ok) throw new Error(`fixture layanan ${nama}: ${r.msg}`);
    F[kunci] = r.rows[0].id;
  }
  const pet = async (k, role, layanan) => {
    const r = await pgq(`INSERT INTO public.petugas (auth_user_id, nama, layanan_id, role, aktif) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids[k], `ZZ ${k}`, layanan, role]);
    if (!r.ok) throw new Error(`fixture petugas ${k}: ${r.msg}`);
    F[k] = r.rows[0].id;
  };
  await pet('fo', 'front_office', null);
  await pet('fo2', 'front_office', null);
  await pet('pet', 'petugas', F.A);
  F.act = Object.fromEntries(Object.entries(ids).map(([k, u]) => [k, asUser(u)]));
  await pgq(`SELECT set_config('lmh.izinkan_jam_tutup','on',true)`);
  const j = await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);
  if (!j.ok || j.n !== 1) throw new Error(`fixture jam tutup 23:59: ${sebut(j)}`);
}

// ---------- snapshot untuk uji rollback ----------
// Catatan bug lama: JANGAN cast kolom bertipe "char" (prokind, relkind, polcmd) ke ::text di sini; bandingkan dengan
// literal saja (p.prokind='f'). proacl (aclitem[]) di-cast ke text[] (aman).
async function snapshot() {
  const m = new Map();
  const f = await pgq(`SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS k,
      md5(regexp_replace(pg_get_functiondef(p.oid),'[[:space:]]+','','g')) AS def,
      coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p.proacl::text[]) x), 'null') AS acl,
      coalesce(obj_description(p.oid, 'pg_proc'), '') AS cmt
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind='f'`);
  if (!f.ok) throw new Error(`snapshot fungsi: ${f.msg}`);
  for (const r of f.rows) m.set(`fn:${r.k}`, `${r.def} ${r.acl} ${r.cmt}`);
  const pol = await pgq(`SELECT tablename||'.'||policyname AS k, md5(coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||cmd) AS v FROM pg_policies WHERE schemaname='public'`);
  if (!pol.ok) throw new Error(`snapshot policy: ${pol.msg}`);
  for (const r of pol.rows) m.set(`policy:${r.k}`, r.v);
  return m;
}
function selisih(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((k) => a.get(k) !== b.get(k)).sort();
}
const FN = `'public.fo_mulai_kunjungan(text,text,text,text,text,text,uuid,uuid,uuid)'::regprocedure`;
const aclFungsi = async () => (await satu(`SELECT coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(p.proacl::text[]) x), 'null') AS a
  FROM pg_proc p WHERE p.oid = ${FN}`))?.a;
const komentarFungsi = async () => (await satu(`SELECT coalesce(obj_description(${FN}, 'pg_proc'), '') AS c`))?.c;
/** Hash kontak/nama/email kunjungan yang SUDAH ada sebelum transaksi (created_at < now() = awal transaksi). */
const hashDataLama = async () => (await satu(`SELECT count(*)::int AS n, md5(coalesce(string_agg(
    id::text||'|'||nama||'|'||coalesce(kontak_hp,'')||'|'||coalesce(email,'')||'|'||coalesce(kategori,'')||'|'||coalesce(keperluan,''),
    ',' ORDER BY id), '')) AS h FROM public.kunjungan WHERE created_at < now()`));

async function seksi(judul, fn) {
  console.log(`\n== ${judul} ==`);
  try { await fn(); } catch (e) { cek(`${judul}: seksi berhenti karena galat tak terduga`, false, e.message); }
}
async function hitungBaris(cl) {
  const r = await cl.query(`SELECT
    (SELECT count(*) FROM public.layanan)::int AS layanan, (SELECT count(*) FROM public.kunjungan)::int AS kunjungan,
    (SELECT count(*) FROM public.penanganan)::int AS penanganan, (SELECT count(*) FROM public.petugas)::int AS petugas,
    (SELECT count(*) FROM public.audit_log)::int AS audit_log, (SELECT count(*) FROM auth.users)::int AS auth_users,
    (SELECT value FROM public.site_settings WHERE key='jam_tutup_layanan') AS jam_tutup,
    (SELECT md5(coalesce(string_agg(id::text||status||coalesce(kontak_hp,''), ',' ORDER BY id), '')) FROM public.kunjungan) AS kunjungan_md5`);
  return r.rows[0];
}

// ---------- fase PASCA migrasi ----------
async function fasePasca() {
  await seksi('0. Lingkungan: kelas [[:alpha:]] pada collation default DB', async () => {
    const l = await satu(`SELECT datcollate AS col, datctype AS ctype FROM pg_database WHERE datname = current_database()`);
    info(`datcollate=${l?.col} datctype=${l?.ctype}`);
    const a = await satu(`SELECT 'José Ramírez' ~ '^[[:alpha:] ]+$' AS aksen, 'Nur’aini' ~ '^[[:alpha:]’]+$' AS kutip`);
    cek('regex [[:alpha:]] mengenali huruf beraksen (é, í) pada DB ini', a?.aksen === true, JSON.stringify(a));
  });

  await seksi('1. Data lengkap & sah: diterima, disimpan kanonik', async () => {
    const r = await mulai(F.act.fo, {
      nama: '  Siti \t  Nur’aini  ', asal: '  Dinas  Uji Coba ', hp: '+62 812-3456-7890', kat: ' UMKM ',
      email: '  ZZ-R14.Siti+tes@Example.CO.ID ', kep: '  Konsultasi perizinan usaha mikro  ', saran: F.A,
    });
    cek('fo_mulai_kunjungan sah -> ok, sudah_ada=false', r.ok && hasil(r)?.ok === true && hasil(r)?.sudah_ada === false, sebut(r));
    const k = r.ok ? await kunjungan(hasil(r).kunjungan_id) : null;
    cek('nama dirapatkan + trim', k?.nama === 'Siti Nur’aini', JSON.stringify(k?.nama));
    cek('asal/instansi di-trim (spasi dalam dipertahankan)', k?.asal_instansi === 'Dinas  Uji Coba', JSON.stringify(k?.asal_instansi));
    cek('HP +62 812-3456-7890 disimpan kanonik 081234567890', k?.kontak_hp === '081234567890', JSON.stringify(k?.kontak_hp));
    cek('kategori di-trim', k?.kategori === 'UMKM', JSON.stringify(k?.kategori));
    cek('email trim + huruf kecil', k?.email === 'zz-r14.siti+tes@example.co.id', JSON.stringify(k?.email));
    cek('keperluan di-trim', k?.keperluan === 'Konsultasi perizinan usaha mikro', JSON.stringify(k?.keperluan));
    cek('layanan saran tersimpan; walk_in dilayani', k?.layanan_saran_id === F.A && k?.status === 'dilayani' && k?.asal === 'walk_in', JSON.stringify(k));
    const p = r.ok ? await satu(`SELECT tahap_ke, peran_tahap, status, penangan_id FROM public.penanganan WHERE id=$1`, [hasil(r).penanganan_id]) : null;
    cek('tahap 1 FO berjalan milik pemanggil (tidak berubah)', p?.tahap_ke === 1 && p?.peran_tahap === 'fo' && p?.status === 'berjalan' && p?.penangan_id === F.fo, JSON.stringify(p));

    for (const [masuk, kanon] of [['6281234567890', '081234567890'], ['0812-3456-789', '08123456789'], ['0812 345 678', '0812345678'], ['0812345678901', '0812345678901']]) {
      const x = await mulai(F.act.fo, { hp: masuk });
      const kk = x.ok ? await kunjungan(hasil(x).kunjungan_id) : null;
      cek(`HP "${masuk}" diterima -> ${kanon}`, kk?.kontak_hp === kanon, sebut(x));
    }
    for (const nama of ['José Ramírez', "Ni Luh Putu Ayu D'Angelo", 'Andi B. Saputra, S.T.', 'Abdul-Rahman', 'Lê Văn Thành']) {
      cek(`nama sah diterima: ${nama}`, (await mulai(F.act.fo, { nama })).ok);
    }
    for (const kat of ['Umum', 'UMKM', 'Investor', 'Instansi']) cek(`kategori ${kat} diterima`, (await mulai(F.act.fo, { kat })).ok);
    cek('keperluan tepat 10 karakter diterima', (await mulai(F.act.fo, { kep: 'abcdefghij' })).ok);
    cek('keperluan 500 karakter diterima', (await mulai(F.act.fo, { kep: 'k'.repeat(500) })).ok);
    cek('nama 100 karakter diterima', (await mulai(F.act.fo, { nama: 'A'.repeat(100) })).ok);
    cek('asal 120 karakter diterima', (await mulai(F.act.fo, { asal: 'a'.repeat(120) })).ok);
    const sa = await mulai(F.act.fo, { saran: null });
    cek('layanan saran NULL ("Belum tahu") diterima', sa.ok, sebut(sa));
    const ad = await mulai(F.act.fo, { email: 'A@B.CO' });
    cek('email huruf besar diterima lalu disimpan huruf kecil', ad.ok && (await kunjungan(hasil(ad).kunjungan_id))?.email === 'a@b.co', sebut(ad));
  });

  await seksi('2. Field kosong / tidak sah: DATA_TIDAK_VALID (22023) + DETAIL field', async () => {
    const kasus = [
      ['nama', [null, '', '   ', 'AB', 'Budi2', '-Budi', '.Ani', 'Budi_S', 'A. B', 'A'.repeat(101), '12345']],
      ['asal', [null, '', '  ', 'AB', ' a  b ', 'a'.repeat(121)]],
      ['hp', [null, '', '0712345678', '081234567', '08123456789012', '0802345678', '021555666', '62', 'abc']],
      ['kat', [null, '', 'umum', 'Lainnya', 'UMKM ;']],
      ['email', [null, '', 'a@b', 'a@@b.co', 'a b@c.id', '@b.co', 'a@b.c', 'a@b..co', `${'a'.repeat(250)}@b.co`]],
      ['kep', [null, '', 'pendek', '  a b c d e f g h i  ', 'k'.repeat(501)]],
    ];
    const kolom = { nama: 'nama', asal: 'asal_instansi', hp: 'kontak_hp', kat: 'kategori', email: 'email', kep: 'keperluan' };
    for (const [f, nilai] of kasus) {
      for (const v of nilai) {
        const r = await mulai(F.act.fo, { [f]: v });
        const tampil = typeof v === 'string' && v.length > 30 ? `${v.slice(0, 12)}…(${v.length})` : JSON.stringify(v);
        cek(`${kolom[f]}=${tampil} ditolak (DETAIL ${kolom[f]})`, tolakField(r, kolom[f]), sebut(r));
      }
    }
    const nonaktif = await mulai(F.act.fo, { saran: F.Mati });
    cek('layanan saran nonaktif: LAYANAN_TIDAK_VALID (tidak berubah)', !nonaktif.ok && /^LAYANAN_TIDAK_VALID:/.test(nonaktif.msg), sebut(nonaktif));
    const nf = await mulai(F.act.fo, { pid: randomUUID() });
    cek('p_pengunjung_id tak dikenal: NOT_FOUND (tidak berubah)', !nf.ok && /^NOT_FOUND:/.test(nf.msg), sebut(nf));
    const urut = await mulai(F.act.fo, { nama: '', hp: '' });
    cek('beberapa field salah: yang pertama (urutan form) dilaporkan = nama', tolakField(urut, 'nama'), sebut(urut));
  });

  await seksi('3. Idempotensi, peran, jam tutup TIDAK berubah', async () => {
    const crid = randomUUID();
    const a = await mulai(F.act.fo, { crid });
    cek('pertama dengan client_request_id: ok', a.ok && hasil(a)?.sudah_ada === false, sebut(a));
    const b = await mulai(F.act.fo, { crid, hp: '', email: '' });
    cek('ulang id sama (data lama tak sah) -> sudah_ada=true (jalur idempotensi sebelum validasi)',
      b.ok && hasil(b)?.sudah_ada === true && hasil(b)?.kunjungan_id === hasil(a)?.kunjungan_id, sebut(b));
    const c2 = await mulai(F.act.fo2, { crid });
    cek('id sama oleh FO lain: IDEMPOTENSI_BENTROK', !c2.ok && /^IDEMPOTENSI_BENTROK:/.test(c2.msg), sebut(c2));
    const crid2 = randomUUID();
    const d = await mulai(F.act.fo, { crid: crid2, hp: '' });
    cek('id baru + data tak sah: DATA_TIDAK_VALID dan TIDAK tercatat',
      tolakField(d, 'kontak_hp') && !(await satu(`SELECT 1 AS x FROM public.kunjungan WHERE client_request_id=$1`, [crid2])), sebut(d));
    const pet = await mulai(F.act.pet);
    cek('petugas layanan: FORBIDDEN (tidak berubah)', !pet.ok && /^FORBIDDEN:/.test(pet.msg), sebut(pet));
    await pgq(`UPDATE public.site_settings SET value='00:01' WHERE key='jam_tutup_layanan'`);
    const t = await mulai(F.act.fo);
    cek('data sah setelah jam tutup: LAYANAN_TUTUP (tidak berubah)', !t.ok && /^LAYANAN_TUTUP:/.test(t.msg), sebut(t));
    const tv = await mulai(F.act.fo, { email: 'salah' });
    cek('data tak sah setelah jam tutup: DATA_TIDAK_VALID lebih dulu (urutan 0012)', tolakField(tv, 'email'), sebut(tv));
    await pgq(`UPDATE public.site_settings SET value='23:59' WHERE key='jam_tutup_layanan'`);
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
  let snapAwal = null;
  let aclAwal = null;
  let dataLamaAwal = null;
  if (applyFiles.length) {
    await seksi('0a. SEBELUM 0014: versi 0012 menerima HP/email/kategori/keperluan kosong (uji tidak vakum)', async () => {
      const r = await mulai(F.act.fo, { hp: null, email: null, kat: null, kep: null });
      cek('versi terpasang menerima walk-in tanpa HP/email/kategori/keperluan', r.ok, sebut(r));
      cek('versi terpasang tidak berkomentar (penanda 0014 belum ada)', (await komentarFungsi()) === '');
    });
    snapAwal = await snapshot();
    aclAwal = await aclFungsi();
    dataLamaAwal = await hashDataLama();
    info(`ACL fo_mulai_kunjungan sebelum: ${aclAwal}; kunjungan lama: ${dataLamaAwal?.n}`);
    for (const f of applyFiles) {
      console.log(`\n-- menerapkan (dalam transaksi, tidak di-commit): ${f}`);
      await c.query(readFileSync(join(root, f), 'utf8'));
    }
    await seksi('0b. Idempoten + hak + penanda + data lama', async () => {
      for (const f of applyFiles) cek(`ulang ${f}`, (await pgq(readFileSync(join(root, f), 'utf8'))).ok);
      cek('ACL fo_mulai_kunjungan TIDAK berubah', (await aclFungsi()) === aclAwal, `${await aclFungsi()} vs ${aclAwal}`);
      cek('komentar penanda 202610140014 terpasang', (await komentarFungsi()).startsWith('202610140014:'));
      const d = await hashDataLama();
      cek('data kunjungan lama (nama/HP/email/kategori/keperluan) TIDAK diubah migrasi',
        d?.n === dataLamaAwal?.n && d?.h === dataLamaAwal?.h, `${JSON.stringify(d)} vs ${JSON.stringify(dataLamaAwal)}`);
    });
  } else {
    info('tanpa --apply: menguji state DB saat ini; seksi sebelum/rollback dilewati');
  }
  await fasePasca();

  if (applyFiles.length) {
    await seksi('4. Rollback 0014 mengembalikan katalog dan perilaku 0012', async () => {
      if (rollbackFiles.length !== applyFiles.length) {
        cek('semua berkas --apply punya rollback docs/rollback-*-<versi>.sql', false, `${rollbackFiles.length}/${applyFiles.length}`);
        return;
      }
      const sesudahApply = selisih(snapAwal, await snapshot());
      cek('snapshot setelah apply BERBEDA dari awal hanya pada fo_mulai_kunjungan (uji tidak vakum)',
        sesudahApply.length === 1 && sesudahApply[0].startsWith('fn:fo_mulai_kunjungan('), sesudahApply.join(' | '));
      for (const f of rollbackFiles) {
        const r = await pgq(readFileSync(join(root, f), 'utf8'));
        cek(`rollback ${f} berhasil dieksekusi`, r.ok, `${r.code ?? ''} ${r.msg ?? ''}`);
        const r2 = await pgq(readFileSync(join(root, f), 'utf8'));
        cek(`rollback ${f} idempoten (dijalankan ulang)`, r2.ok, `${r2.code ?? ''} ${r2.msg ?? ''}`);
      }
      const beda = selisih(snapAwal, await snapshot());
      cek('rollback: tidak ada selisih fungsi (def/hak/komentar)/policy', beda.length === 0, beda.join(' | '));
      const r = await mulai(F.act.fo, { hp: null, email: null, kat: null, kep: null });
      cek('setelah rollback: walk-in tanpa HP/email/kategori/keperluan kembali diterima (perilaku 0012)', r.ok, sebut(r));
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
  cek('jumlah baris + jam tutup + hash kunjungan SEBELUM == SESUDAH ROLLBACK (tidak ada perubahan permanen)',
    JSON.stringify(sebelumBaris) === JSON.stringify(sesudahBaris));
} catch (e) { console.error('hitung baris sesudah gagal:', e.message); kodeKeluar = 2; }
try { await c2.end(); } catch { /* abaikan */ }
console.log(`\nRINGKASAN: ${lulus} lolos, ${gagal.length} gagal`);
if (gagal.length) { for (const g of gagal) console.log(' - ' + g); kodeKeluar = kodeKeluar || 1; }
process.exit(kodeKeluar);
