#!/usr/bin/env node
// scripts/check-deps-sync.mjs — pastikan versi paket kunci yang TERPASANG di node_modules sama dengan
// package-lock.json (bagian dari `npm run verify:baseline`).
//
// Latar belakang (audit T10): `node_modules` pernah tertinggal dari lockfile (next 16.2.12 terpasang padahal lockfile
// 16.3.6; sharp 0.35.3 vs 0.35.4). Lint/test/build lalu berjalan terhadap versi yang BERBEDA dari yang akan dideploy,
// dan audit keamanan memeriksa lockfile — bukan apa yang sebenarnya terpasang.
//
// Kode keluar: 0 = semua sama; 1 = ada yang beda/tidak terpasang; 2 = berkas lockfile tidak terbaca (fail-closed).
//
// Logika murni (tanpa I/O) ada di `periksaSinkronDependensi` agar bisa diuji (src/test/check-deps-sync.test.ts;
// berada di src/ karena vitest.config.ts hanya mengambil src/** dan supabase/migrations/**).
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Paket yang wajib sinkron antara node_modules dan package-lock.json. */
export const PAKET_DIPANTAU = ['next', 'sharp', 'eslint-config-next'];

/**
 * Versi sebuah paket di package-lock.json (lockfileVersion 2/3: `packages["node_modules/<nama>"].version`).
 * @param {any} lockJson
 * @param {string} nama
 * @returns {string|null}
 */
export function versiDariLock(lockJson, nama) {
  const v = lockJson?.packages?.[`node_modules/${nama}`]?.version;
  return typeof v === 'string' && v ? v : null;
}

/**
 * Bandingkan versi terpasang vs lockfile.
 *
 * @param {{ terpasang: Record<string, string|null|undefined>, lock: Record<string, string|null|undefined>, paket?: string[] }} masukan
 *   `terpasang[nama]` = versi di node_modules/<nama>/package.json (null/undefined = tidak terpasang);
 *   `lock[nama]` = versi di package-lock.json (null/undefined = tidak ada di lockfile).
 * @returns {{
 *   ok: boolean,
 *   hasil: Array<{ paket: string, terpasang: string|null, lock: string|null, status: 'sama'|'beda'|'tidak_terpasang'|'tidak_di_lockfile' }>,
 *   masalah: string[]
 * }}
 */
export function periksaSinkronDependensi({ terpasang, lock, paket = PAKET_DIPANTAU }) {
  const hasil = [];
  const masalah = [];
  for (const nama of paket) {
    const t = terpasang?.[nama] ?? null;
    const l = lock?.[nama] ?? null;
    /** @type {'sama'|'beda'|'tidak_terpasang'|'tidak_di_lockfile'} */
    let status;
    if (t === null) {
      status = 'tidak_terpasang';
      masalah.push(`${nama}: tidak terpasang di node_modules (lockfile: ${l ?? 'tidak ada'}).`);
    } else if (l === null) {
      status = 'tidak_di_lockfile';
      masalah.push(`${nama}: terpasang ${t} tetapi tidak ada di package-lock.json.`);
    } else if (t !== l) {
      status = 'beda';
      masalah.push(`${nama}: terpasang ${t} != package-lock.json ${l}.`);
    } else {
      status = 'sama';
    }
    hasil.push({ paket: nama, terpasang: t, lock: l, status });
  }
  return { ok: masalah.length === 0, hasil, masalah };
}

/**
 * Susun laporan teks (satu elemen = satu baris).
 * @param {ReturnType<typeof periksaSinkronDependensi>} r
 */
export function formatLaporan(r) {
  const baris = [];
  for (const h of r.hasil) {
    const mark = h.status === 'sama' ? 'OK   ' : 'BEDA ';
    baris.push(`[deps] ${mark}${h.paket}: terpasang ${h.terpasang ?? '(tidak ada)'} | package-lock.json ${h.lock ?? '(tidak ada)'}`);
  }
  if (r.ok) {
    baris.push(`[deps] LOLOS: ${r.hasil.length} paket kunci terpasang sama dengan package-lock.json.`);
  } else {
    for (const m of r.masalah) baris.push(`[deps] GAGAL ${m}`);
    baris.push('[deps] GAGAL: node_modules tidak sinkron dengan package-lock.json. Jalankan `npm ci` (memasang persis sesuai lockfile), lalu ulangi.');
  }
  return baris;
}

// ---------------------------------------------------------------------------------------------------------------
// I/O

const AKAR_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Versi terpasang dari node_modules/<nama>/package.json; null bila tidak ada/rusak. */
function versiTerpasang(nama) {
  const berkas = resolve(AKAR_REPO, 'node_modules', nama, 'package.json');
  if (!existsSync(berkas)) return null;
  try {
    const v = JSON.parse(readFileSync(berkas, 'utf8')).version;
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

/** @returns {number} kode keluar */
function main() {
  let lockJson;
  try {
    lockJson = JSON.parse(readFileSync(resolve(AKAR_REPO, 'package-lock.json'), 'utf8'));
  } catch (e) {
    console.error(`[deps] GAGAL membaca package-lock.json: ${e instanceof Error ? e.message : e}`);
    return 2;
  }
  const terpasang = {};
  const lock = {};
  for (const nama of PAKET_DIPANTAU) {
    terpasang[nama] = versiTerpasang(nama);
    lock[nama] = versiDariLock(lockJson, nama);
  }
  const r = periksaSinkronDependensi({ terpasang, lock });
  for (const baris of formatLaporan(r)) console.log(baris);
  return r.ok ? 0 : 1;
}

// Hanya jalankan saat dipanggil langsung (`node scripts/check-deps-sync.mjs`), bukan saat diimpor oleh test.
if (process.argv[1] && basename(process.argv[1]) === 'check-deps-sync.mjs') {
  process.exitCode = main();
}
