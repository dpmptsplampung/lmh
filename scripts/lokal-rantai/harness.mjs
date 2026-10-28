// Harness: terapkan SELURUH rantai migrasi (supabase/migrations/*.sql, kecuali baseline ekstensi) ke PGlite
// di atas stub infrastruktur Supabase (stub-supabase.sql). Tanpa jaringan, tanpa .env, tanpa DB produksi.
// Panduan dan batas: scripts/lokal-rantai/README.md. PGlite dipasang dengan `npm i --no-save @electric-sql/pglite`.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const MIGRASI = join(DIR, '..', '..', 'supabase', 'migrations');
const ROLE_SAH = new Set(['anon', 'authenticated', 'service_role', 'postgres']);

async function impor(spesifier) {
  try {
    return await import(spesifier);
  } catch (galat) {
    if (galat?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('PGlite belum terpasang: `npm i --no-save @electric-sql/pglite` (jangan masuk package.json).', { cause: galat });
    }
    throw galat;
  }
}

/** pgvector tidak ada di PGlite: tipe vector -> domain float8[], indeks hnsw/ivfflat dibuang (fungsi RAG tidak diuji). */
export function sesuaikan(sql) {
  return sql
    .replace(/CREATE EXTENSION[^;]*vector[^;]*;/gi, '')
    .replace(/extensions\.vector\((\d+)\)/g, 'extensions.vector')
    .replace(/\bvector\((\d+)\)/g, 'extensions.vector')
    .replace(/CREATE INDEX[^;]*USING\s+(hnsw|ivfflat)[^;]*;/gi, '');
}

/**
 * Buka DB kosong lalu terapkan seluruh migrasi berurutan. Galat satu migrasi dilempar (rantai harus bersih).
 * @param {{ sampai?: string }} [opsi] sampai = nomor depan terakhir yang diterapkan (mis. '202610290002')
 */
export async function bukaDbPenuh(opsi = {}) {
  const { PGlite } = await impor('@electric-sql/pglite');
  const { pgcrypto } = await impor('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await impor('@electric-sql/pglite/contrib/pg_trgm');
  const { unaccent } = await impor('@electric-sql/pglite/contrib/unaccent');
  const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm, unaccent } });
  await db.exec(readFileSync(join(DIR, 'stub-supabase.sql'), 'utf8'));
  await db.exec('SET search_path TO public, extensions');
  const berkas = readdirSync(MIGRASI).filter((f) => f.endsWith('.sql')).sort();
  for (const f of berkas) {
    if (f.startsWith('202607140001')) continue; // ekstensi + preflight: disediakan stub
    if (opsi.sampai && f.slice(0, 12) > opsi.sampai) break;
    let sql = sesuaikan(readFileSync(join(MIGRASI, f), 'utf8'));
    // 202609020001 membuat ulang policy yang sudah dibuat 202607290007 tanpa DROP (produksi sudah punya jalur sendiri).
    if (f.startsWith('202609020001')) sql = 'DROP POLICY IF EXISTS hari_libur_public_read ON public.hari_libur;\n' + sql;
    try {
      await db.exec('SET check_function_bodies = off;\n' + sql);
    } catch (galat) {
      try { await db.exec('ROLLBACK'); } catch { /* sudah tidak dalam transaksi */ }
      throw new Error(`Migrasi ${f} gagal: ${galat?.message ?? galat}`, { cause: galat });
    }
  }
  return db;
}

/** Jalankan SQL sebagai role dengan auth.uid() = uid dan klaim JWT tambahan (jwt = objek, mis. {app_metadata:{role:'admin'}}). */
export async function sebagai(db, role, uid, sql, params, jwt) {
  if (!ROLE_SAH.has(role)) throw new Error(`role tidak dikenal: ${role}`);
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('app.uid', $1, false), set_config('app.jwt', $2, false)", [uid ?? '', jwt ? JSON.stringify(jwt) : '']);
  try {
    if (role !== 'postgres') await db.exec(`SET ROLE ${role}`);
    if (params === undefined) {
      const hasil = await db.exec(sql);
      return { ok: true, rows: hasil.length > 0 ? hasil[hasil.length - 1].rows : [] };
    }
    return { ok: true, rows: (await db.query(sql, params)).rows };
  } catch (galat) {
    return { ok: false, pesan: String(galat?.message ?? galat), kode: galat?.code };
  } finally {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('app.uid', '', false), set_config('app.jwt', '', false)");
  }
}

let gagal = 0;
let lolos = 0;
export function cek(nama, kondisi, detail = '') {
  if (kondisi === true) { lolos++; console.log(`  ok   ${nama}`); }
  else { gagal++; console.log(`  GAGAL ${nama}${detail ? ' :: ' + detail : ''}`); }
}
export function ringkas() {
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  process.exitCode = gagal > 0 ? 1 : 0;
}
