// Menerapkan SATU file migrasi ke DB produksi (WP-02) secara terkontrol.
// Izin pemilik: boleh mengubah DB produksi asalkan dicatat & bisa dikembalikan.
// exec_sql (plpgsql EXECUTE) hanya bisa menjalankan satu statement sekaligus.
// Skrip ini memecah file SQL menjadi statement individual dan mengeksekusi satu per satu,
// melewati BEGIN/COMMIT/ROLLBACK yang tidak bisa dijalankan di dalam fungsi plpgsql.
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { createInterface } from 'node:readline/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from './lib/sql-txn.mjs';

// Pemakaian:
//   node scripts/apply-migration.mjs <file.sql> --non-atomic          # LAMA: per-statement, TIDAK atomik (WAJIB eksplisit bila file mengubah policy/fungsi)
//   node scripts/apply-migration.mjs <file.sql>                       # LAMA: per-statement; DITOLAK bila file memuat CREATE/DROP POLICY / CREATE [OR REPLACE]/DROP FUNCTION
//   node scripts/apply-migration.mjs <file.sql> --atomic              # SATU transaksi (BEGIN..COMMIT), minta konfirmasi
//   node scripts/apply-migration.mjs <file.sql> --atomic --yes        # tanpa prompt (CI/otomasi, tetap eksplisit)
//   node scripts/apply-migration.mjs <file.sql> --atomic --dry-run    # jalankan lalu ROLLBACK (tidak mengubah apa pun)
// Mode --atomic memakai DIRECT_URL dari .env.local (nilai tidak pernah dicetak). Bila ada galat:
// ROLLBACK + exit non-zero. File TIDAK boleh berisi BEGIN/COMMIT/ROLLBACK/SAVEPOINT sendiri.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const sqlFile = args.find((a) => !a.startsWith('--'));
const atomic = args.includes('--atomic');
const yes = args.includes('--yes');
const dryRun = args.includes('--dry-run');
const nonAtomic = args.includes('--non-atomic');
if (!sqlFile) { console.error('Pemakaian: node scripts/apply-migration.mjs <file.sql> [--atomic [--yes] [--dry-run]]'); process.exit(1); }
if ((yes || dryRun) && !atomic) { console.error('--yes/--dry-run hanya berlaku bersama --atomic'); process.exit(1); }
if (atomic && nonAtomic) { console.error('--atomic dan --non-atomic saling bertentangan'); process.exit(1); }

const rawSql = readFileSync(resolve(root, sqlFile), 'utf8');

// N6: mode lama (per-statement, tanpa transaksi) berbahaya untuk perubahan policy/fungsi: galat di tengah
// meninggalkan DB setengah-terapan (mis. fungsi lama sudah di-DROP tetapi yang baru belum ada). Pilihan
// paling kecil dan aman: TOLAK secara default; hanya jalan bila operator menulis --non-atomic secara sadar.
// Pemeriksaan ini terjadi SEBELUM membaca kredensial / menyambung ke DB.
if (!atomic && mengubahPolicyAtauFungsi(rawSql) && !nonAtomic) {
  console.error('DITOLAK: berkas ini mengubah POLICY atau FUNCTION (CREATE/DROP POLICY, CREATE [OR REPLACE]/DROP FUNCTION).');
  console.error('Mode lama menjalankan per-statement TANPA transaksi: galat di tengah = database setengah-terapan.');
  console.error('Gunakan:  node scripts/apply-migration.mjs ' + sqlFile + ' --atomic');
  console.error('Hanya bila benar-benar disengaja:  ... --non-atomic');
  process.exit(1);
}
if (!atomic && nonAtomic) {
  console.error('PERINGATAN: --non-atomic = TIDAK ATOMIK. Galat di tengah tidak di-rollback.');
}

const envText = readFileSync(join(root, '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
async function mainAtomic() {
  if (mengandungKontrolTransaksi(rawSql)) {
    console.error('Ditolak: file berisi BEGIN/COMMIT/END/ROLLBACK/SAVEPOINT/RELEASE; mode --atomic membungkus sendiri.');
    process.exit(1);
  }
  if (!env.DIRECT_URL) { console.error('DIRECT_URL tidak ada di .env.local'); process.exit(1); }
  let host = '(tidak dikenali)';
  try { host = new URL(env.DIRECT_URL).hostname; } catch { /* abaikan */ }

  if (!dryRun && !yes) {
    if (!process.stdin.isTTY) {
      console.error('Tanpa terminal interaktif: tambahkan --yes secara eksplisit untuk menerapkan.');
      process.exit(1);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const jawab = await rl.question(`TERAPKAN ${sqlFile} ke DATABASE PRODUKSI (${host}) dalam satu transaksi? Ketik TERAPKAN untuk lanjut: `);
    rl.close();
    if (jawab.trim() !== 'TERAPKAN') { console.error('Dibatalkan.'); process.exit(1); }
  }

  const c = new pg.Client({ connectionString: env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
  c.on('notice', (n) => console.log(`${n.severity ?? 'NOTICE'}: ${n.message}`));
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL lock_timeout = '5s'");
    await c.query("SET LOCAL statement_timeout = '120s'");
    await c.query(rawSql); // simple query protocol: banyak statement dalam satu kiriman
    if (dryRun) {
      await c.query('ROLLBACK');
      console.log(`DRY-RUN ${sqlFile}: seluruh file berhasil dieksekusi lalu di-ROLLBACK (tidak ada perubahan).`);
    } else {
      await c.query('COMMIT');
      console.log(`Migrasi ${sqlFile} berhasil diterapkan secara ATOMIK (COMMIT).`);
    }
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* koneksi sudah putus */ }
    console.error(`GAGAL, di-ROLLBACK (tidak ada perubahan): ${err.message}`);
    if (err.where) console.error(`  di: ${String(err.where).split(/\r?\n/)[0]}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

if (atomic) {
  await mainAtomic();
  process.exit(process.exitCode ?? 0);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Kredensial Supabase tidak lengkap di .env.local'); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Split SQL into individual statements, handling dollar-quoting ($$...$$),
// line comments (--), block comments (/* */), and string literals ('...'').
// Skips empty statements and transaction control commands (BEGIN/COMMIT/ROLLBACK).
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    // Dollar-quoted string: $$...$$ or $tag$...$tag$
    if (sql[i] === '$') {
      const closeOfTag = sql.indexOf('$', i + 1);
      if (closeOfTag > i) {
        const tag = sql.slice(i, closeOfTag + 1); // e.g. '$$' or '$body$'
        const closeIndex = sql.indexOf(tag, closeOfTag + 1);
        if (closeIndex >= 0) {
          current += sql.slice(i, closeIndex + tag.length);
          i = closeIndex + tag.length;
          continue;
        }
      }
    }

    // Line comment: -- ... \n
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      if (nl >= 0) { current += sql.slice(i, nl + 1); i = nl + 1; }
      else { current += sql.slice(i); i = sql.length; }
      continue;
    }

    // Block comment: /* ... */
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end >= 0) { current += sql.slice(i, end + 2); i = end + 2; }
      else { current += sql.slice(i); i = sql.length; }
      continue;
    }

    // String literal: '...' (with '' escape)
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; }
        else if (sql[j] === "'") { j++; break; }
        else { j++; }
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // Statement separator
    if (sql[i] === ';') {
      const stmt = current.trim();
      // Strip line comments then check if the remaining content is a TCL command
      const stmtNoComments = stmt.replace(/--[^\n]*/g, '').trim();
      if (stmtNoComments && !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(stmtNoComments)) {
        statements.push(stmt);
      }
      current = '';
      i++;
      continue;
    }

    current += sql[i];
    i++;
  }

  const stmt = current.trim();
  const stmtNoComments = stmt.replace(/--[^\n]*/g, '').trim();
  if (stmtNoComments && !/^(BEGIN|COMMIT|ROLLBACK)$/i.test(stmtNoComments)) {
    statements.push(stmt);
  }

  return statements;
}

async function execStatement(stmt) {
  const { error } = await supabase.rpc('exec_sql', { q: stmt });
  if (error) {
    if (/exec_sql/.test(error.message ?? '')) {
      console.error('RPC exec_sql tidak tersedia. Jalankan SQL berikut MANUAL di Supabase SQL Editor:');
      console.error('--- MULAI SQL ---');
      console.error(stmt);
      console.error('--- SELESAI SQL ---');
      process.exit(2);
    }
    throw new Error(error.message);
  }
}

async function main() {
  const statements = splitStatements(rawSql);
  console.log(`Memproses ${statements.length} statement dari ${sqlFile} ...`);

  for (let n = 0; n < statements.length; n++) {
    const stmt = statements[n];
    const preview = stmt.slice(0, 80).replace(/\s+/g, ' ');
    process.stdout.write(`  [${n + 1}/${statements.length}] ${preview}${stmt.length > 80 ? '...' : ''} `);
    try {
      await execStatement(stmt);
      console.log('✓');
    } catch (err) {
      console.log('✗');
      console.error(`\nGagal pada statement ${n + 1}:\n${stmt}\n\nError: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`\nMigrasi ${sqlFile} berhasil diterapkan (${statements.length} statement).`);
}

main();
