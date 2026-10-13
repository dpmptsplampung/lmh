// Verifikasi LEDGER migrasi (READ ONLY): membuktikan, per file migrasi yang TIDAK tercatat di
// supabase_migrations.schema_migrations, apakah objek hasil migrasi itu benar-benar ada di database.
//
// Latar belakang: ledger produksi hanya memuat entri sampai 202607280005, padahal migrasi sesudahnya diterapkan lewat
// scripts/apply-migration.mjs (yang tidak mencatat ledger). Skrip ini memberi bukti per migrasi, tanpa mengubah apa pun.
//
// Pemakaian:
//   node scripts/verify-migration-ledger.mjs                 # tulis laporan ke docs/analysis/LEDGER-VERIFIKASI-<tanggal WIB>.md
//   node scripts/verify-migration-ledger.mjs --out <berkas>  # laporan ke berkas lain
//   node scripts/verify-migration-ledger.mjs --tanpa-berkas  # hanya cetak ke stdout
//
// KEAMANAN (read-only berlapis):
//  1. Koneksi memakai DIRECT_URL dari .env.local; nilainya TIDAK pernah dicetak/ditulis (pesan galat disaring).
//  2. Sesi: `SET default_transaction_read_only = on`, lalu `BEGIN READ ONLY`, lalu dipastikan `SHOW transaction_read_only = on`.
//  3. Semua perintah ke DB lewat `kueri()` yang hanya mengizinkan SELECT/WITH/SHOW (+ BEGIN READ ONLY/ROLLBACK/SAVEPOINT).
//  4. Selalu diakhiri ROLLBACK.
import pg from 'pg';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analisisRiwayat, nilaiIsiFungsi, normalisasiTipe, pecahPernyataan, tentukanStatus } from './lib/migration-markers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
export const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

/** Tanggal (YYYY-MM-DD) menurut WIB. */
export function tanggalWIB(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Baca .env.local menjadi objek (tidak dicetak). */
export function bacaEnv(root = ROOT) {
  const teks = readFileSync(join(root, '.env.local'), 'utf8');
  return Object.fromEntries(
    teks.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
  );
}

/** Daftar file migrasi `supabase/migrations/*.sql` urut menurut versi. */
export function bacaDaftarMigrasi(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => /^\d{12}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ berkas: f, versi: f.slice(0, 12), nama: f.slice(13, -4), sql: readFileSync(join(dir, f), 'utf8') }));
}

/** Saring pesan galat agar tidak membocorkan URL koneksi/host/kata sandi. */
export function galatAman(err, env = {}) {
  let pesan = String(err?.message ?? err);
  const rahasia = [env.DIRECT_URL, env.DATABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean);
  try { rahasia.push(new URL(env.DIRECT_URL).hostname); } catch { /* abaikan */ }
  for (const r of rahasia) pesan = pesan.split(r).join('[disembunyikan]');
  pesan = pesan.replace(/postgres(?:ql)?:\/\/\S+/gi, '[disembunyikan]').replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[ip]');
  return `${err?.code ? `${err.code}: ` : ''}${pesan}`;
}

// Hanya perintah baca yang boleh dikirim ke database dari skrip ini.
const PERINTAH_DIIZINKAN = /^\s*(?:SELECT|WITH|SHOW)\b|^\s*BEGIN\s+READ\s+ONLY\s*$|^\s*ROLLBACK\s*$|^\s*SET\s+default_transaction_read_only\s*=\s*on\s*$|^\s*SAVEPOINT\s+\w+\s*$|^\s*ROLLBACK\s+TO\s+SAVEPOINT\s+\w+\s*$|^\s*RELEASE\s+SAVEPOINT\s+\w+\s*$/i;

/** Satu-satunya pintu kueri: menolak apa pun selain perintah baca. */
export async function kueri(client, sql, params) {
  if (!PERINTAH_DIIZINKAN.test(sql) || /;\s*\S/.test(sql)) {
    throw new Error(`DITOLAK (read-only): perintah bukan SELECT/WITH/SHOW: ${sql.slice(0, 40)}`);
  }
  return client.query(sql, params);
}

/** Buka koneksi ke DIRECT_URL dalam transaksi READ ONLY. Pemanggil WAJIB memanggil `tutupKoneksi`. */
export async function bukaKoneksiBacaSaja(env) {
  if (!env.DIRECT_URL) throw new Error('DIRECT_URL tidak ada di .env.local');
  const client = new pg.Client({
    connectionString: env.DIRECT_URL,
    ssl: { rejectUnauthorized: false },
    application_name: 'lmh-ledger-readonly',
    statement_timeout: 60_000,
  });
  await client.connect();
  try {
    await kueri(client, 'SET default_transaction_read_only = on');
    await kueri(client, 'BEGIN READ ONLY');
    const { rows } = await kueri(client, 'SHOW transaction_read_only');
    if (rows[0]?.transaction_read_only !== 'on') throw new Error('transaksi bukan READ ONLY; dibatalkan');
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
  return client;
}

export async function tutupKoneksi(client) {
  try { await kueri(client, 'ROLLBACK'); } catch { /* koneksi sudah putus */ }
  await client.end().catch(() => {});
}

/** Jalankan kueri opsional (mis. cron.job, storage.buckets) dalam SAVEPOINT; null bila tidak dapat dibaca. */
async function opsional(client, sql, params) {
  await kueri(client, 'SAVEPOINT opsional_q');
  try {
    const r = await kueri(client, sql, params);
    await kueri(client, 'RELEASE SAVEPOINT opsional_q');
    return r.rows;
  } catch {
    await kueri(client, 'ROLLBACK TO SAVEPOINT opsional_q');
    return null;
  }
}

/** Muat katalog yang dibutuhkan untuk memeriksa penanda (semua SELECT). */
export async function muatKatalog(client, skema) {
  const RELKIND_TABEL = ['r', 'p', 'f'];
  const RELKIND_VIEW = ['v', 'm'];
  const rel = (await kueri(client,
    `SELECT n.nspname AS skema, c.relname AS nama, c.relkind AS jenis
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind = ANY($2)`, [skema, [...RELKIND_TABEL, ...RELKIND_VIEW]])).rows;
  const kol = (await kueri(client,
    `SELECT n.nspname AS skema, c.relname AS tabel, a.attname AS nama, format_type(a.atttypid, a.atttypmod) AS tipe
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind = ANY($2) AND a.attnum > 0 AND NOT a.attisdropped`, [skema, [...RELKIND_TABEL, ...RELKIND_VIEW]])).rows;
  const fn = (await kueri(client,
    `SELECT n.nspname AS skema, p.proname AS nama, p.pronargs AS arity, p.prosrc AS isi
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1)`, [skema])).rows;
  const pol = (await kueri(client,
    'SELECT schemaname AS skema, tablename AS tabel, policyname AS nama FROM pg_policies WHERE schemaname = ANY($1)', [skema])).rows;
  const idx = (await kueri(client,
    'SELECT schemaname AS skema, indexname AS nama FROM pg_indexes WHERE schemaname = ANY($1)', [skema])).rows;
  const trg = (await kueri(client,
    `SELECT n.nspname AS skema, c.relname AS tabel, t.tgname AS nama
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = ANY($1)`, [skema])).rows;
  const con = (await kueri(client,
    `SELECT n.nspname AS skema, c.relname AS tabel, k.conname AS nama
       FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1)`, [skema])).rows;
  const pub = (await kueri(client, 'SELECT pubname AS pub, schemaname AS skema, tablename AS tabel FROM pg_publication_tables')).rows;
  const ext = (await kueri(client, 'SELECT extname AS nama FROM pg_extension')).rows;
  const cron = await opsional(client, 'SELECT jobname AS nama FROM cron.job');
  const bucket = await opsional(client, 'SELECT id AS nama FROM storage.buckets');

  return {
    tabel: new Set(rel.filter((r) => RELKIND_TABEL.includes(r.jenis)).map((r) => `${r.skema}.${r.nama}`)),
    view: new Set(rel.filter((r) => RELKIND_VIEW.includes(r.jenis)).map((r) => `${r.skema}.${r.nama}`)),
    kolom: new Map(kol.map((r) => [`${r.skema}.${r.tabel}.${r.nama}`, r.tipe])),
    fungsi: new Set(fn.map((r) => `${r.skema}.${r.nama}/${r.arity}`)),
    // badan fungsi (pg_proc.prosrc) per kunci skema.nama/arity; beberapa overload berjumlah argumen sama => beberapa badan
    fungsiIsi: fn.reduce((m, r) => { const k = `${r.skema}.${r.nama}/${r.arity}`; (m.get(k) ?? m.set(k, []).get(k)).push(r.isi); return m; }, new Map()),
    policy: new Set(pol.map((r) => `${r.skema}.${r.tabel}:${r.nama}`)),
    indeks: new Set(idx.map((r) => `${r.skema}.${r.nama}`)),
    trigger: new Set(trg.map((r) => `${r.skema}.${r.tabel}:${r.nama}`)),
    constraint: new Set(con.map((r) => `${r.skema}.${r.tabel}:${r.nama}`)),
    publikasi: new Set(pub.map((r) => `${r.pub}:${r.skema}.${r.tabel}`)),
    ekstensi: new Set(ext.map((r) => r.nama)),
    cron: cron ? new Set(cron.map((r) => r.nama)) : null,
    bucket: bucket ? new Set(bucket.map((r) => r.nama)) : null,
  };
}

/** true/false = ada/tidak ada di katalog; null = tidak dapat diperiksa. */
export function periksaPenanda(p, k) {
  switch (p.jenis) {
    case 'tabel': return k.tabel.has(`${p.skema}.${p.nama}`);
    case 'view': return k.view.has(`${p.skema}.${p.nama}`);
    case 'kolom': return k.kolom.has(`${p.skema}.${p.tabel}.${p.nama}`);
    case 'tipe_kolom': {
      const t = k.kolom.get(`${p.skema}.${p.tabel}.${p.nama}`);
      return t === undefined ? false : normalisasiTipe(t) === p.tipe;
    }
    case 'fungsi': return k.fungsi.has(`${p.skema}.${p.nama}/${p.arity}`);
    case 'indeks': return k.indeks.has(`${p.skema}.${p.nama}`);
    case 'policy': return k.policy.has(`${p.skema}.${p.tabel}:${p.nama}`);
    case 'trigger': return k.trigger.has(`${p.skema}.${p.tabel}:${p.nama}`);
    case 'constraint': return k.constraint.has(`${p.skema}.${p.tabel}:${p.nama}`);
    case 'publikasi': return k.publikasi.has(`${p.pub}:${p.skema}.${p.tabel}`);
    case 'ekstensi': return k.ekstensi.has(p.nama);
    case 'cron': return k.cron ? k.cron.has(p.nama) : null;
    case 'bucket': return k.bucket ? k.bucket.has(p.nama) : null;
    default: return null;
  }
}

/**
 * Verifikasi seluruh migrasi terhadap katalog database.
 * @param {pg.Client} client koneksi READ ONLY
 * @param {ReturnType<typeof bacaDaftarMigrasi>} berkas
 */
export async function verifikasiLedger(client, berkas) {
  const ledger = (await kueri(client, 'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version')).rows;
  const tercatat = new Set(ledger.map((r) => r.version));
  const riwayat = analisisRiwayat(berkas.map((b) => ({ versi: b.versi, nama: b.nama, sql: b.sql })));
  const skema = [...new Set(['public', ...riwayat.flatMap((h) => h.penanda.map((p) => p.skema).filter(Boolean))])];
  const katalog = await muatKatalog(client, skema);

  const hasil = riwayat.map((h) => {
    const b = berkas.find((x) => x.versi === h.versi);
    const penanda = h.penanda.map((p) => {
      const ada = p.status === 'aktif' ? periksaPenanda(p, katalog) : null;
      const q = { ...p, ada };
      // Sidik jari isi fungsi (pg_proc.prosrc vs badan di migrasi): bukti lebih tajam untuk fungsi yang didefinisikan ulang.
      if (p.status === 'aktif' && p.aksi === 'buat' && p.jenis === 'fungsi' && ada === true) {
        const isi = nilaiIsiFungsi(p, h.versi, katalog.fungsiIsi.get(`${p.skema}.${p.nama}/${p.arity}`));
        q.isi = isi;
        const catat = (t) => { q.catatan = q.catatan ? `${q.catatan}; ${t}` : t; };
        if (isi === 'sama_unik') {
          if (q.kekuatan === 'lemah') { q.kekuatan = 'kuat'; catat('isi fungsi di DB identik dengan definisi migrasi ini saja (dinaikkan menjadi kuat)'); }
        } else if (isi === 'lebih_lama') {
          q.ada = false;
          catat('isi fungsi di DB masih versi migrasi yang lebih LAMA: versi dari migrasi ini belum diterapkan');
        } else if (isi === 'lebih_baru') catat('isi fungsi di DB sudah versi migrasi lebih baru (menimpa migrasi ini)');
        else if (isi === 'sama_ambigu') catat('isi fungsi identik dengan migrasi ini, tetapi definisi lain berbadan sama');
        else if (isi === 'tidak_cocok') catat('isi fungsi di DB tidak identik dengan definisi mana pun di repo (diubah manual atau beda format)');
      }
      return q;
    });
    const { status, alasan } = tentukanStatus(penanda);
    const noop = pecahPernyataan(b.sql).length === 0;
    return {
      versi: h.versi,
      nama: h.nama,
      tercatat: tercatat.has(h.versi),
      status,
      alasan: noop ? 'berkas no-op (hanya komentar, tanpa pernyataan SQL)' : alasan,
      noop,
      penanda,
      peringatan: h.peringatan,
      pernyataan: pecahPernyataan(b.sql),
    };
  });

  const versiBerkas = new Set(berkas.map((b) => b.versi));
  return {
    ledger,
    hasil,
    yatim: ledger.filter((r) => !versiBerkas.has(r.version)),
    namaBeda: ledger.filter((r) => { const b = berkas.find((x) => x.versi === r.version); return b && b.nama !== r.name; }),
    cronDapatDibaca: katalog.cron !== null,
    bucketDapatDibaca: katalog.bucket !== null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Laporan markdown
// ---------------------------------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/\|/g, '\\|');
const URUT_STATUS = ['terpasang', 'sebagian', 'tidak_ditemukan', 'tidak_dapat_ditentukan'];

function ringkasPenanda(h) {
  const aktif = h.penanda.filter((p) => p.status === 'aktif');
  const buat = aktif.filter((p) => p.aksi === 'buat');
  const ada = buat.filter((p) => p.ada === true).length;
  const kuat = buat.filter((p) => p.kekuatan === 'kuat');
  const kuatAda = kuat.filter((p) => p.ada === true).length;
  return {
    teks: `${ada}/${buat.length}`,
    kuat: `${kuatAda}/${kuat.length}`,
    digantikan: h.penanda.filter((p) => p.status === 'digantikan').length,
    drop: aktif.filter((p) => p.aksi === 'hapus').length,
  };
}

/** Hitungan hasil sidik jari isi fungsi untuk sekumpulan migrasi, mis. "sama_unik 3, lebih_baru 5". */
function ringkasIsi(daftar) {
  const c = {};
  for (const h of daftar) for (const p of h.penanda) if (p.isi) c[p.isi] = (c[p.isi] ?? 0) + 1;
  return Object.entries(c).map(([k, n]) => `${k} ${n}`).join(', ');
}

function barisTabel(h) {
  const r = ringkasPenanda(h);
  return `| ${h.versi} | ${esc(h.nama)} | ${h.status} | ${r.teks} | ${r.kuat} | ${r.drop} | ${r.digantikan} | ${esc(h.alasan)} |`;
}

const KEPALA_TABEL = [
  '| Versi | Nama | Status | Penanda ada/total | Penanda kuat ada/total | Cek DROP | Digantikan | Alasan |',
  '|---|---|---|---|---|---|---|---|',
];

function rincianMigrasi(h) {
  const baris = [`#### ${h.versi} ${h.nama} — ${h.status}`, '', `Alasan: ${h.alasan}`, ''];
  if (h.peringatan.length) baris.push(`Peringatan parser: ${h.peringatan.join('; ')}`, '');
  if (!h.penanda.length) { baris.push('(tidak ada penanda)', ''); return baris; }
  for (const p of h.penanda) {
    let tanda;
    if (p.status === 'digantikan') tanda = `DIGANTIKAN (${p.alasan}${p.digantikanOleh ? `, oleh ${p.digantikanOleh}` : ''})`;
    else if (p.aksi === 'hapus') tanda = p.ada === true ? 'MASIH ADA (seharusnya sudah di-DROP)' : p.ada === false ? 'tidak ada (sesuai DROP; bukan bukti)' : 'tidak dapat diperiksa';
    else tanda = p.ada === true ? `ADA, ${p.kekuatan}` : p.ada === false ? `HILANG, ${p.kekuatan}` : 'tidak dapat diperiksa';
    const bagi = p.status === 'aktif' && p.aksi === 'buat' && p.dibagiDengan.length ? ` [juga dibuat oleh: ${p.dibagiDengan.join(', ')}]` : '';
    baris.push(`- ${p.aksi === 'hapus' ? 'DROP ' : ''}${esc(p.label)} => ${tanda}${bagi}${p.catatan ? ` (${p.catatan})` : ''}`);
  }
  baris.push('');
  return baris;
}

export function buatLaporan(v, { tanggal, jumlahBerkas }) {
  const tak = v.hasil.filter((h) => !h.tercatat);
  const rec = v.hasil.filter((h) => h.tercatat);
  const hitung = (daftar) => Object.fromEntries(URUT_STATUS.map((s) => [s, daftar.filter((h) => h.status === s).length]));
  const c = hitung(tak);

  const ringkas = [
    `# Verifikasi ledger migrasi — ${tanggal}`,
    '',
    `Dibuat oleh \`scripts/verify-migration-ledger.mjs\` (READ ONLY: transaksi \`BEGIN READ ONLY\` + hanya SELECT, diakhiri ROLLBACK).`,
    'Tidak ada nilai rahasia/URL koneksi di laporan ini.',
    '',
    '## Ringkasan',
    '',
    `- File di \`supabase/migrations/*.sql\`: **${jumlahBerkas}**`,
    `- Entri di \`supabase_migrations.schema_migrations\` (produksi): **${v.ledger.length}** (versi terakhir: ${v.ledger.at(-1)?.version ?? '-'})`,
    `- File TIDAK tercatat di ledger: **${tak.length}** (${tak[0]?.versi ?? '-'} s.d. ${tak.at(-1)?.versi ?? '-'})`,
    `- Entri ledger tanpa file: ${v.yatim.length ? v.yatim.map((r) => r.version).join(', ') : 'tidak ada'}; nama berbeda antara ledger dan file: ${v.namaBeda.length ? v.namaBeda.map((r) => r.version).join(', ') : 'tidak ada'}`,
    `- Katalog opsional: pg_cron ${v.cronDapatDibaca ? 'dapat dibaca' : 'TIDAK dapat dibaca'}; storage.buckets ${v.bucketDapatDibaca ? 'dapat dibaca' : 'TIDAK dapat dibaca'}`,
    `- Sidik jari isi fungsi (fungsi yang ada di DB, migrasi tidak tercatat): ${ringkasIsi(tak) || 'tidak ada fungsi yang dibandingkan'}`,
    '',
    '### Hasil per status (migrasi tidak tercatat)',
    '',
    '| Status | Jumlah | Arti |',
    '|---|---|---|',
    `| terpasang | ${c.terpasang} | semua penanda aktif ada dan sedikitnya satu penanda KUAT (hanya dibuat oleh migrasi ini) ditemukan |`,
    `| sebagian | ${c.sebagian} | sebagian penanda ada, sebagian hilang |`,
    `| tidak_ditemukan | ${c.tidak_ditemukan} | objek hasil migrasi tidak ada |`,
    `| tidak_dapat_ditentukan | ${c.tidak_dapat_ditentukan} | tidak ada penanda yang membuktikan migrasi ini (objek bersama / tanpa DDL / digantikan) |`,
    '',
    '### Cara membaca',
    '',
    '- **Penanda**: objek yang dibuat migrasi (tabel, kolom, fungsi+jumlah argumen, indeks, policy, view, trigger, constraint, cron job, publikasi, ekstensi, bucket, tipe kolom).',
    '- **Kuat**: objek hanya dibuat oleh migrasi ini, sehingga keberadaannya membuktikan migrasi ini. **Lemah**: objek juga dibuat/didefinisikan ulang migrasi lain (mis. CREATE OR REPLACE FUNCTION, DROP POLICY + CREATE POLICY); keberadaannya tidak membuktikan migrasi ini, tetapi KETIADAANNYA tetap bukti bahwa migrasi belum terpasang.',
    '- **Digantikan**: objek di-DROP (dan tidak dibuat ulang) oleh migrasi yang lebih baru, atau tipenya diubah; ketiadaannya tidak dihitung.',
    '- **Cek DROP**: objek yang seharusnya sudah di-DROP oleh migrasi ini. Bila masih ada, migrasi dianggap belum terpasang penuh. Objek yang tidak ada bukan bukti (mungkin tidak pernah ada).',
    '- **Sidik jari isi fungsi**: untuk fungsi yang ada, badan di DB (`pg_proc.prosrc`, spasi dinormalkan) dibandingkan dengan badan di tiap migrasi yang mendefinisikannya. Identik hanya dengan migrasi ini => penanda dinaikkan menjadi kuat; identik hanya dengan migrasi LEBIH LAMA => versi migrasi ini belum diterapkan (dianggap hilang); identik dengan migrasi lebih baru / tidak identik dengan mana pun => tidak ada informasi.',
    '- Keterbatasan: yang diperiksa hanya keberadaan objek, tipe kolom, dan isi fungsi; BUKAN ekspresi policy, definisi view/trigger, atau perubahan data (UPDATE/INSERT). Migrasi yang hanya mengubah data, policy, atau view yang didefinisikan ulang berkali-kali tidak dapat dibuktikan lewat katalog.',
    '',
    '## Dampak untuk `supabase db push`',
    '',
    `- Selama ledger belum diisi, \`supabase db push --include-all\` menganggap ${tak.length} migrasi di atas PENDING dan akan mencoba menerapkannya SEMUA berurutan; banyak yang tidak idempoten (mis. CREATE POLICY tanpa DROP) sehingga gagal atau mengubah objek yang sudah ada. Jangan jalankan sebelum ledger diisi.`,
    `- Setelah hanya migrasi berstatus \`terpasang\` dicatat (scripts/fill-migration-ledger.mjs), sisanya (${tak.length - c.terpasang} migrasi: sebagian / tidak_ditemukan / tidak_dapat_ditentukan) tetap PENDING dan akan diterapkan oleh \`db push\`. Tiap-tiap migrasi itu harus diputuskan manual (periksa bagian "BUKAN terpasang" di bawah) SEBELUM \`db push\`.`,
    '',
    '## Migrasi yang tidak tercatat di ledger',
    '',
    ...KEPALA_TABEL,
    ...tak.map(barisTabel),
    '',
  ];

  const bukanTerpasang = tak.filter((h) => h.status !== 'terpasang');
  ringkas.push('## Migrasi tidak tercatat yang BUKAN `terpasang`', '');
  if (!bukanTerpasang.length) ringkas.push('Tidak ada.', '');
  for (const h of bukanTerpasang) {
    ringkas.push(`### ${h.versi} ${h.nama} — ${h.status}`, '', `Alasan: ${h.alasan}`, '');
    const hilang = h.penanda.filter((p) => p.status === 'aktif' && p.aksi === 'buat' && p.ada === false);
    const masih = h.penanda.filter((p) => p.status === 'aktif' && p.aksi === 'hapus' && p.ada === true);
    const tak2 = h.penanda.filter((p) => p.status === 'aktif' && p.ada === null);
    if (hilang.length) ringkas.push('Objek yang HILANG:', ...hilang.map((p) => `- ${esc(p.label)} (${p.kekuatan})`), '');
    if (masih.length) ringkas.push('Objek yang seharusnya sudah di-DROP tetapi MASIH ADA:', ...masih.map((p) => `- ${esc(p.label)}`), '');
    if (tak2.length) ringkas.push('Tidak dapat diperiksa:', ...tak2.map((p) => `- ${esc(p.label)}`), '');
    const dig = h.penanda.filter((p) => p.status === 'digantikan');
    if (dig.length) ringkas.push(`Penanda digantikan (${dig.length}): ${dig.map((p) => esc(p.label)).join('; ')}`, '');
    // Bahaya regresi: menerapkan migrasi ini SEKARANG (setelah migrasi pengganti yang sudah terpasang) membuat ulang objek yang sengaja di-DROP.
    const bahaya = dig.filter((p) => p.aksi === 'buat' && p.digantikanOleh && /di-DROP/.test(p.alasan ?? '')
      && v.hasil.some((x) => x.versi === p.digantikanOleh && (x.tercatat || x.status === 'terpasang')));
    if (bahaya.length) {
      ringkas.push(
        `**PERINGATAN regresi**: bila migrasi ini diterapkan sekarang (mis. oleh \`db push\`), ia akan MEMBUAT ULANG objek yang sengaja sudah di-DROP migrasi lain yang sudah terpasang:`,
        ...bahaya.map((p) => `- ${esc(p.label)} (di-DROP oleh ${p.digantikanOleh})`),
        '',
      );
    }
    if (h.peringatan.length) ringkas.push(`Peringatan parser: ${h.peringatan.join('; ')}`, '');
  }

  ringkas.push(
    '## Kontrol: migrasi yang SUDAH tercatat di ledger',
    '',
    'Pemeriksaan yang sama dijalankan pada migrasi yang pasti sudah diterapkan (tercatat), untuk melihat apakah metode ini wajar. Hasil selain `terpasang`/`tidak_dapat_ditentukan` di sini menunjukkan perubahan di luar migrasi atau keterbatasan metode.',
    '',
    ...KEPALA_TABEL,
    ...rec.map(barisTabel),
    '',
  );

  const lampiran = ['## Lampiran: rincian penanda per migrasi (tidak tercatat)', '', ...tak.flatMap(rincianMigrasi)];
  const lampiranKontrol = ['## Lampiran: rincian penanda migrasi tercatat (kontrol)', '', ...rec.flatMap(rincianMigrasi)];
  return { ringkas: ringkas.join('\n'), lengkap: [...ringkas, ...lampiran, ...lampiranKontrol].join('\n') + '\n', hitung: c };
}

async function main() {
  const args = process.argv.slice(2);
  const tanpaBerkas = args.includes('--tanpa-berkas');
  const iOut = args.indexOf('--out');
  const tanggal = tanggalWIB();
  const keluar = iOut >= 0 ? resolve(args[iOut + 1]) : join(ROOT, 'docs', 'analysis', `LEDGER-VERIFIKASI-${tanggal}.md`);

  const env = bacaEnv();
  const berkas = bacaDaftarMigrasi();
  let client;
  try {
    client = await bukaKoneksiBacaSaja(env);
    const v = await verifikasiLedger(client, berkas);
    const lap = buatLaporan(v, { tanggal, jumlahBerkas: berkas.length });
    console.log(lap.ringkas);
    if (!tanpaBerkas) {
      if (!existsSync(dirname(keluar))) mkdirSync(dirname(keluar), { recursive: true });
      writeFileSync(keluar, lap.lengkap, 'utf8');
      console.log(`\nLaporan lengkap ditulis ke: ${keluar}`);
    }
  } catch (err) {
    console.error(`GAGAL: ${galatAman(err, env)}`);
    process.exitCode = 1;
  } finally {
    if (client) await tutupKoneksi(client);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
