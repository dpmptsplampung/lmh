// Menerapkan beberapa berkas migrasi BERURUTAN ke database (DIRECT_URL), dengan dry-run bawaan.
//
// Pemakaian (kredensial dari Doppler, tanpa berkas .env.local):
//   doppler run --project lmh --config prd -- node scripts/terapkan-migrasi-berurutan.mjs --dry-run
//   doppler run --project lmh --config prd -- node scripts/terapkan-migrasi-berurutan.mjs --terapkan
//   ... --batch 1            # hanya batch 1 (1..4, lihat BATCH di bawah)
//   ... --berkas a.sql b.sql # daftar berkas sendiri (di supabase/migrations)
//
// --dry-run : SEMUA berkas dijalankan berurutan di SATU transaksi lalu di-ROLLBACK (berkas berikutnya melihat hasil
//             berkas sebelumnya, jadi prasyarat antar-migrasi ikut teruji). Tidak mengubah apa pun.
// --terapkan: tiap berkas = SATU transaksi tersendiri (COMMIT per berkas); berhenti di galat pertama. Berkas yang
//             sudah COMMIT tidak dibatalkan otomatis (rollback manual: docs/rollback-*.sql, urutan terbalik).
// Backfill 202611010004 sengaja TIDAK ada di batch mana pun (jalankan terpisah sesudah aplikasi di-deploy).
// DIRECT_URL tidak pernah dicetak (hanya nama host).
import pg from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mengandungKontrolTransaksi } from './lib/sql-txn.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(root, 'supabase', 'migrations');

export const BATCH = {
  1: ['202610270001_instansi_layanan_konten.sql', '202610270002_jadwal_tunggal_layanan.sql', '202610280001_homepage_etalase.sql'],
  2: ['202610290001_koordinator_akses_data.sql', '202610290002_rekap_terpadu.sql'],
  3: [
    '202610300001_pendataan_khusus.sql',
    '202610300002_selesai_dengan_pendataan.sql',
    '202610310001_chat_lingkup_percakapan.sql',
    '202610310002_chat_luar_jam.sql',
    '202610310003_chat_perbaikan_review.sql',
  ],
  4: [
    '202611010001_fo_cari_pengunjung.sql',
    '202611010002_tiket_antrean_lingkup.sql',
    '202611010003_identitas_satu_kesatuan.sql',
    '202611010005_rekap_data_tanpa_form.sql',
  ],
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const terapkan = args.includes('--terapkan');
if (dryRun === terapkan) { console.error('Pilih tepat satu: --dry-run atau --terapkan'); process.exit(1); }

let berkas;
const iBerkas = args.indexOf('--berkas');
const iBatch = args.indexOf('--batch');
if (iBerkas >= 0) berkas = args.slice(iBerkas + 1).filter((a) => !a.startsWith('--'));
else if (iBatch >= 0) berkas = BATCH[Number(args[iBatch + 1])];
else berkas = Object.values(BATCH).flat();
if (!berkas?.length) { console.error('Tidak ada berkas yang dipilih.'); process.exit(1); }

const sqlPer = new Map();
for (const f of berkas) {
  const p = join(DIR, f);
  if (!existsSync(p)) { console.error(`Berkas tidak ada: ${f}`); process.exit(1); }
  const sql = readFileSync(p, 'utf8');
  if (mengandungKontrolTransaksi(sql)) { console.error(`Ditolak: ${f} berisi BEGIN/COMMIT/ROLLBACK sendiri.`); process.exit(1); }
  sqlPer.set(f, sql);
}

function dapatkanUrl() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  const p = join(root, '.env.local');
  if (!existsSync(p)) return undefined;
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = l.trim();
    if (t.startsWith('DIRECT_URL=')) return t.slice('DIRECT_URL='.length).replace(/^["']|["']$/g, '');
  }
  return undefined;
}
const url = dapatkanUrl();
if (!url) { console.error('DIRECT_URL tidak ada (jalankan lewat `doppler run` atau isi .env.local).'); process.exit(1); }
let host = '(tidak dikenali)';
try { host = new URL(url).hostname; } catch { /* abaikan */ }
console.log(`Mode: ${dryRun ? 'DRY-RUN (semua di-ROLLBACK)' : 'TERAPKAN (COMMIT per berkas)'} | host: ${host} | ${berkas.length} berkas`);

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
c.on('notice', (n) => console.log(`    ${n.severity ?? 'NOTICE'}: ${n.message}`));
await c.connect();

async function jalankan(f) {
  await c.query("SET LOCAL lock_timeout = '5s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  const t0 = Date.now();
  await c.query(sqlPer.get(f));
  console.log(`  OK  ${f} (${Date.now() - t0} ms)`);
}

let gagal = false;
try {
  if (dryRun) {
    await c.query('BEGIN');
    for (const f of berkas) await jalankan(f);
    await c.query('ROLLBACK');
    console.log('DRY-RUN BERSIH: semua berkas berhasil berurutan lalu di-ROLLBACK (tidak ada perubahan).');
  } else {
    for (const f of berkas) {
      await c.query('BEGIN');
      await jalankan(f);
      await c.query('COMMIT');
    }
    console.log('SELESAI: semua berkas di-COMMIT.');
  }
} catch (err) {
  gagal = true;
  try { await c.query('ROLLBACK'); } catch { /* koneksi putus */ }
  console.error(`GAGAL (berkas terakhir di-ROLLBACK): ${err.message}`);
  if (err.where) console.error(`  di: ${String(err.where).split(/\r?\n/)[0]}`);
} finally {
  await c.end();
}
process.exit(gagal ? 1 : 0);
