// Harness verifikasi lokal: Postgres dalam-proses (PGlite, WASM) berisi stub skema produksi.
// Tanpa koneksi ke DB mana pun, tanpa membaca .env. Panduan: scripts/lokal/README.md.
//
// PGlite TIDAK ada di package.json (aturan R5): pasang dengan `npm i --no-save @electric-sql/pglite`
// di root worktree. Bila belum terpasang, bukaDb() gagal dengan pesan yang menjelaskannya.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const BERKAS_STUB = join(DIR, 'pglite-stub.sql');

const ROLE_SAH = new Set(['anon', 'authenticated', 'service_role', 'postgres']);

const PESAN_TIDAK_TERPASANG =
  'PGlite belum terpasang. Jalankan `npm i --no-save @electric-sql/pglite` di root worktree ' +
  '(JANGAN menambahkannya ke package.json atau package-lock.json; ulangi setelah setiap `npm ci`). ' +
  'Lihat scripts/lokal/README.md.';

async function impor(spesifier) {
  try {
    return await import(spesifier);
  } catch (galat) {
    if (galat?.code === 'ERR_MODULE_NOT_FOUND' && String(galat.message).includes('@electric-sql/pglite')) {
      throw new Error(PESAN_TIDAK_TERPASANG, { cause: galat });
    }
    throw galat;
  }
}

/**
 * Buka DB PGlite kosong (dalam memori) lalu terapkan scripts/lokal/pglite-stub.sql.
 * Setiap panggilan = DB baru yang terpisah. Tutup dengan `await db.close()` bila skenario selesai.
 * @returns {Promise<import('@electric-sql/pglite').PGlite>}
 */
export async function bukaDb() {
  const { PGlite } = await impor('@electric-sql/pglite');
  const { pgcrypto } = await impor('@electric-sql/pglite/contrib/pgcrypto');
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await terapkanBerkas(db, BERKAS_STUB);
  return db;
}

/**
 * Jalankan SQL sebagai role tertentu dengan auth.uid() = uid.
 * Urutan: RESET ROLE -> set_config('app.uid') -> SET ROLE -> jalankan -> RESET ROLE dan kosongkan app.uid.
 * `postgres` = superuser lokal (tanpa SET ROLE), setara pemilik migrasi.
 * Tanpa `params`, `sql` boleh berisi beberapa pernyataan (hasil = baris pernyataan terakhir);
 * dengan `params`, hanya satu pernyataan (protokol berparameter).
 * Galat SQL tidak dilempar: dikembalikan sebagai { ok: false, pesan, kode } (kode = SQLSTATE bila ada).
 * @param {import('@electric-sql/pglite').PGlite} db
 * @param {'anon'|'authenticated'|'service_role'|'postgres'} role
 * @param {string|null} uid UUID pengguna untuk auth.uid(); null = tidak login
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<{ ok: true, rows: any[] } | { ok: false, pesan: string, kode?: string }>}
 */
export async function sebagai(db, role, uid, sql, params) {
  if (!ROLE_SAH.has(role)) {
    throw new Error(`sebagai(): role tidak dikenal "${role}" (sah: ${[...ROLE_SAH].join(', ')})`);
  }
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('app.uid', $1, false)", [uid ?? '']);
  try {
    if (role !== 'postgres') await db.exec(`SET ROLE ${role}`);
    if (params === undefined) {
      const hasil = await db.exec(sql);
      return { ok: true, rows: hasil.length > 0 ? hasil[hasil.length - 1].rows : [] };
    }
    const hasil = await db.query(sql, params);
    return { ok: true, rows: hasil.rows };
  } catch (galat) {
    return { ok: false, pesan: String(galat?.message ?? galat), kode: galat?.code };
  } finally {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('app.uid', '', false)");
  }
}

/**
 * Terapkan satu berkas SQL (mis. migrasi) sebagai `postgres`. Melempar Error berisi nama berkas
 * bila ada pernyataan yang gagal. Jalur relatif dihitung dari direktori kerja saat ini.
 * @param {import('@electric-sql/pglite').PGlite} db
 * @param {string} path
 */
export async function terapkanBerkas(db, path) {
  const mutlak = resolve(path);
  const isi = readFileSync(mutlak, 'utf8');
  await db.exec('RESET ROLE');
  try {
    await db.exec(isi);
  } catch (galat) {
    throw new Error(`Gagal menerapkan ${mutlak}: ${galat?.message ?? galat}`, { cause: galat });
  }
}

// --- Pencatat hasil cek ---------------------------------------------------------------------
let lolos = 0;
const gagal = [];
let pengaitTerpasang = false;

function pasangPengait() {
  if (pengaitTerpasang) return;
  pengaitTerpasang = true;
  process.on('exit', () => {
    console.log(`\n${lolos} lolos, ${gagal.length} gagal`);
    if (gagal.length > 0) {
      for (const g of gagal) console.log(`  GAGAL: ${g}`);
      process.exitCode = 1;
    }
  });
}

/**
 * Catat satu pemeriksaan. `kondisi` harus tepat `true` (nilai lain, termasuk truthy, dihitung gagal
 * agar cek tidak lolos karena salah ketik, mis. mengirim jumlah baris alih-alih perbandingan).
 * Proses berakhir dengan kode 1 bila ada cek gagal (ringkasan dicetak saat proses keluar), jadi
 * skenario cukup memanggil cek() berkali-kali lalu selesai.
 * @param {string} nama
 * @param {boolean} kondisi
 * @param {string} [detail] keterangan tambahan, ditampilkan saat gagal
 */
export function cek(nama, kondisi, detail) {
  pasangPengait();
  if (kondisi === true) {
    lolos += 1;
    console.log(`  LOLOS  ${nama}`);
    return;
  }
  const keterangan = kondisi === false ? detail : `kondisi bukan boolean true (${String(kondisi)})${detail ? `; ${detail}` : ''}`;
  gagal.push(keterangan ? `${nama} (${keterangan})` : nama);
  console.log(`  GAGAL  ${nama}${keterangan ? ` -- ${keterangan}` : ''}`);
}
