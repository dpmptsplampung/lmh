// Manifest hash migrasi (T11): melindungi file `supabase/migrations/*.sql` dari edit in-place.
//
// Latar belakang: insiden produksi 23–24 Sep 2026 diperbaiki dengan MENGEDIT migrasi yang sudah
// ada (bukan migrasi forward baru). Aturan baru: migrasi yang sudah ada TIDAK BOLEH diubah.
// Manifest mencatat SHA-256 tiap file; `supabase/migrations/manifest.test.ts` gagal bila ada
// file yang berubah / hilang / belum terdaftar.
//
// Pemakaian:
//   node scripts/gen-migration-manifest.mjs            # buat manifest / TAMBAHKAN berkas baru
//   node scripts/gen-migration-manifest.mjs --check    # hanya periksa (tidak menulis); exit 1 bila beda
//   node scripts/gen-migration-manifest.mjs --dir <folder>   # folder lain (dipakai test)
//
// Mode tulis bersifat TAMBAH-SAJA: bila berkas yang sudah ada di manifest berubah isinya, atau
// hilang, skrip menolak (exit 1) dan TIDAK menulis apa pun. Jadi menjalankan ulang skrip tidak bisa
// dipakai untuk "mencuci" hasil edit in-place. Mengubah hash berkas lama hanya mungkin dengan
// mengedit MANIFEST.json secara manual — terlihat jelas pada diff/review dan melanggar aturan.
//
// Normalisasi: CRLF diganti LF sebelum di-hash, sehingga hash sama di Windows/Linux dan tidak
// terganggu `core.autocrlf`. Hash dihitung atas byte mentah (bukan string UTF-8), jadi tidak ada
// perubahan byte yang lolos karena dekode.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSI_MANIFEST = 1;
export const POLA_NAMA = /^\d{12}_[a-z0-9_]+\.sql$/;
const POLA_HASH = /^[0-9a-f]{64}$/;

/**
 * @typedef {{ versi: number, berkas: Record<string, string> }} Manifest
 * @typedef {{
 *   jenis: 'manifest_rusak' | 'nama_tidak_valid' | 'versi_ganda' | 'berubah' | 'belum_terdaftar' | 'hilang',
 *   nama: string,
 *   pesan: string,
 * }} Masalah
 */

/** Ganti CRLF -> LF pada byte mentah (lossless lewat latin1). */
export function normalisasiAkhirBaris(isi) {
  const buf = Buffer.isBuffer(isi) ? isi : Buffer.from(isi, 'utf8');
  return Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

/** SHA-256 (hex) isi file setelah normalisasi akhir baris. */
export function hashIsi(isi) {
  return createHash('sha256').update(normalisasiAkhirBaris(isi)).digest('hex');
}

function urut(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Nama semua berkas `.sql` (tanpa subfolder) di folder, terurut. */
export function daftarBerkasSql(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.sql$/i.test(e.name))
    .map((e) => e.name)
    .sort(urut);
}

/** @returns {Record<string, string>} nama berkas -> hash, terurut menurut nama. */
export function hitungHashFolder(dir) {
  /** @type {Record<string, string>} */
  const hasil = {};
  for (const nama of daftarBerkasSql(dir)) {
    hasil[nama] = hashIsi(readFileSync(join(dir, nama)));
  }
  return hasil;
}

/** @param {Record<string, string>} berkas @returns {Manifest} */
export function buatManifest(berkas) {
  /** @type {Record<string, string>} */
  const terurut = {};
  for (const nama of Object.keys(berkas).sort(urut)) terurut[nama] = berkas[nama];
  return { versi: VERSI_MANIFEST, berkas: terurut };
}

/** Teks MANIFEST.json (LF, satu entri per baris agar diff git mudah dibaca). */
export function serialisasiManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + '\n';
}

/**
 * Periksa pola nama dan keunikan versi (12 digit pertama).
 * @param {string[]} daftarNama
 * @returns {Masalah[]}
 */
export function periksaNama(daftarNama) {
  /** @type {Masalah[]} */
  const masalah = [];
  /** @type {Map<string, string[]>} */
  const perVersi = new Map();
  for (const nama of daftarNama) {
    if (!POLA_NAMA.test(nama)) {
      masalah.push({
        jenis: 'nama_tidak_valid',
        nama,
        pesan: `nama migrasi tidak valid: ${nama} — wajib mengikuti pola YYYYMMDDNNNN_nama_snake_case.sql (${POLA_NAMA})`,
      });
      continue;
    }
    const versi = nama.slice(0, 12);
    perVersi.set(versi, [...(perVersi.get(versi) ?? []), nama]);
  }
  for (const [versi, nama] of perVersi) {
    if (nama.length > 1) {
      masalah.push({
        jenis: 'versi_ganda',
        nama: nama.join(', '),
        pesan: `versi migrasi ganda: ${versi} dipakai oleh ${nama.join(', ')} — versi 12 digit harus unik`,
      });
    }
  }
  return masalah;
}

/**
 * Bandingkan manifest dengan keadaan folder. FUNGSI MURNI (tanpa I/O) agar mudah diuji.
 * @param {unknown} manifest isi MANIFEST.json hasil JSON.parse
 * @param {Record<string, string>} aktual nama berkas -> hash keadaan sekarang di folder
 * @returns {Masalah[]} kosong = semua aman
 */
export function periksaManifest(manifest, aktual) {
  const m = /** @type {any} */ (manifest);
  const bentukValid =
    m !== null &&
    typeof m === 'object' &&
    m.versi === VERSI_MANIFEST &&
    m.berkas !== null &&
    typeof m.berkas === 'object' &&
    !Array.isArray(m.berkas);
  if (!bentukValid) {
    return [
      {
        jenis: 'manifest_rusak',
        nama: 'MANIFEST.json',
        pesan: `MANIFEST.json rusak: harus berbentuk {"versi":${VERSI_MANIFEST},"berkas":{...}} — jalankan \`node scripts/gen-migration-manifest.mjs\``,
      },
    ];
  }
  /** @type {Record<string, unknown>} */
  const tercatat = m.berkas;
  /** @type {Masalah[]} */
  const masalah = [];

  for (const [nama, hash] of Object.entries(tercatat)) {
    if (typeof hash !== 'string' || !POLA_HASH.test(hash)) {
      masalah.push({
        jenis: 'manifest_rusak',
        nama,
        pesan: `MANIFEST.json rusak: hash ${nama} bukan SHA-256 heksadesimal 64 karakter`,
      });
    }
  }

  masalah.push(...periksaNama(Object.keys(aktual)));

  for (const nama of Object.keys(tercatat).sort(urut)) {
    if (!Object.hasOwn(aktual, nama)) {
      masalah.push({
        jenis: 'hilang',
        nama,
        pesan: `migrasi hilang dari folder: ${nama} — migrasi tidak boleh dihapus atau diganti nama; kembalikan file aslinya`,
      });
    } else if (aktual[nama] !== tercatat[nama]) {
      masalah.push({
        jenis: 'berubah',
        nama,
        pesan: `migrasi lama diubah: ${nama} — buat migrasi forward baru, jangan edit in-place`,
      });
    }
  }
  for (const nama of Object.keys(aktual).sort(urut)) {
    if (!Object.hasOwn(tercatat, nama)) {
      masalah.push({
        jenis: 'belum_terdaftar',
        nama,
        pesan: `file migrasi baru belum masuk manifest — jalankan \`node scripts/gen-migration-manifest.mjs\` (berkas: ${nama})`,
      });
    }
  }
  return masalah;
}

/** Folder migrasi bawaan: <root>/supabase/migrations (relatif terhadap lokasi skrip ini). */
export function folderMigrasiBawaan() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
}

function cetakMasalah(masalah) {
  for (const x of masalah) console.error(`  - ${x.pesan}`);
}

/**
 * Jalankan CLI. Dipisah dari top-level agar bisa diimpor test tanpa efek samping.
 * @param {string[]} argv argumen setelah nama skrip
 * @returns {number} exit code
 */
export function jalankan(argv) {
  let periksaSaja = false;
  let dir = folderMigrasiBawaan();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') periksaSaja = true;
    else if (a === '--dir' && argv[i + 1]) dir = resolve(argv[++i]);
    else {
      console.error('Pemakaian: node scripts/gen-migration-manifest.mjs [--check] [--dir <folder>]');
      return 2;
    }
  }

  const fileManifest = join(dir, 'MANIFEST.json');
  const aktual = hitungHashFolder(dir);
  const ada = existsSync(fileManifest);
  let lama = null;
  if (ada) {
    try {
      lama = JSON.parse(readFileSync(fileManifest, 'utf8'));
    } catch {
      console.error('MANIFEST.json tidak dapat dibaca sebagai JSON. Tidak ada yang ditulis.');
      return 1;
    }
  }

  if (periksaSaja) {
    if (!ada) {
      console.error('MANIFEST.json tidak ada — jalankan `node scripts/gen-migration-manifest.mjs`.');
      return 1;
    }
    const masalah = periksaManifest(lama, aktual);
    if (masalah.length > 0) {
      console.error(`Manifest migrasi TIDAK cocok (${masalah.length} masalah):`);
      cetakMasalah(masalah);
      return 1;
    }
    console.log(`Manifest migrasi cocok (${Object.keys(aktual).length} berkas).`);
    return 0;
  }

  // Mode tulis: tambah-saja. Berkas lama yang berubah/hilang/rusak = tolak, jangan menulis apa pun.
  const masalahNama = periksaNama(Object.keys(aktual));
  const masalahLama = ada
    ? periksaManifest(lama, aktual).filter((x) => x.jenis !== 'belum_terdaftar' && x.jenis !== 'nama_tidak_valid' && x.jenis !== 'versi_ganda')
    : [];
  const blokir = [...masalahNama, ...masalahLama];
  if (blokir.length > 0) {
    console.error('Ditolak — manifest TIDAK ditulis:');
    cetakMasalah(blokir);
    return 1;
  }

  const baru = buatManifest(aktual);
  if (ada && JSON.stringify(lama) === JSON.stringify(baru)) {
    console.log(`MANIFEST.json sudah mutakhir (${Object.keys(aktual).length} berkas).`);
    return 0;
  }
  const tercatatSebelumnya = ada ? new Set(Object.keys(lama.berkas)) : new Set();
  const ditambah = Object.keys(aktual).filter((n) => !tercatatSebelumnya.has(n));
  writeFileSync(fileManifest, serialisasiManifest(baru), 'utf8');
  console.log(`MANIFEST.json ditulis: ${Object.keys(aktual).length} berkas (${ditambah.length} ditambahkan).`);
  for (const n of ditambah) console.log(`  + ${n}`);
  return 0;
}

// Hanya jalan bila dieksekusi langsung (bukan saat diimpor test).
function dijalankanLangsung() {
  if (!process.argv[1]) return false;
  const a = resolve(fileURLToPath(import.meta.url));
  const b = resolve(process.argv[1]);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (dijalankanLangsung()) {
  process.exitCode = jalankan(process.argv.slice(2));
}
