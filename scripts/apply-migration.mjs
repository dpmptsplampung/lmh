// Menerapkan SATU file migrasi ke DB produksi (WP-02) secara terkontrol.
// Izin pemilik: boleh mengubah DB produksi asalkan dicatat & bisa dikembalikan.
// exec_sql (plpgsql EXECUTE) hanya bisa menjalankan satu statement sekaligus.
// Skrip ini memecah file SQL menjadi statement individual dan mengeksekusi satu per satu,
// melewati BEGIN/COMMIT/ROLLBACK yang tidak bisa dijalankan di dalam fungsi plpgsql.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const envText = readFileSync(join(root, '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Kredensial Supabase tidak lengkap di .env.local'); process.exit(1); }

const sqlFile = process.argv[2];
if (!sqlFile) { console.error('Pemakaian: node scripts/apply-migration.mjs <file.sql>'); process.exit(1); }
const rawSql = readFileSync(join(root, sqlFile), 'utf8');

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
