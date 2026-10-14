#!/usr/bin/env node
// scripts/check-audit.mjs — gerbang audit dependensi LOKAL (bagian dari `npm run verify:baseline`).
//
// Kebijakan (keputusan CEO, temuan audit T10):
//  - MEMBLOK advisory tingkat `high` dan `critical`. (CI GitHub lama hanya memblok `critical`; klaim "high+" keliru.)
//  - Advisory yang belum punya perbaikan layak boleh dikecualikan di `audit-allow.json` dengan ALASAN tertulis
//    dan TENGGAT kaji-ulang. Pengecualian yang sudah lewat tenggat membuat gerbang gagal lagi.
//  - Tidak ada CI GitHub yang menjalankan ini: gerbangnya lokal (`npm run verify:baseline` + hook pre-push).
//
// Cara kerja: `npm audit --json` -> semua paket ber-severity high/critical -> telusuri `via` sampai advisory AKAR
// (objek ber-`url`; ID = bagian GHSA dari url) -> cocokkan dengan allowlist.
//
// Kode keluar: 0 = lolos; 1 = pelanggaran kebijakan; 2 = audit tidak dapat dijalankan/dibaca (fail-closed:
// tanpa hasil audit yang sah, gerbang TIDAK boleh lolos).
//
// Logika murni (tanpa I/O) ada di `evaluasiAudit`/`validasiAllowlist`/dll. agar bisa diuji tanpa npm
// (lihat src/test/check-audit.test.ts; berada di src/ karena vitest.config.ts hanya mengambil src/** dan supabase/migrations/**).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Urutan tingkat keparahan versi npm audit. */
const TINGKAT = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
/** Tingkat minimum yang memblok gerbang. */
const AMBANG_BLOK = TINGKAT.high;

/** @param {unknown} severity */
const bobot = (severity) => TINGKAT[String(severity ?? '').toLowerCase()] ?? -1;

/** Kunci pembanding ID (tanpa peduli huruf besar/kecil & spasi). @param {string} id */
const kunci = (id) => String(id).trim().toLowerCase();

// ---------------------------------------------------------------------------------------------------------------
// Tanggal

// Tanggal 'YYYY-MM-DD' menurut kalender Asia/Jakarta (WIB), BUKAN UTC. Setara `todayWIB()` di src/lib/time.ts;
// diduplikasi di sini karena skrip .mjs tidak bisa mengimpor .ts di Node 22 tanpa flag. Kesetaraannya dijaga
// oleh test (src/test/check-audit.test.ts membandingkan dengan toWIBDateString).
const formatTanggalWIB = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** @param {Date} [sekarang] */
export function hariIniWIB(sekarang = new Date()) {
  return formatTanggalWIB.format(sekarang);
}

/** True bila `s` adalah tanggal kalender nyata berformat YYYY-MM-DD (mis. 2027-02-30 ditolak). */
export function tanggalValid(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// ---------------------------------------------------------------------------------------------------------------
// Advisory

const POLA_GHSA = /GHSA(?:-[a-z0-9]{4}){3}/i;

/**
 * ID advisory dari objek `via` npm audit: bagian GHSA dari `url` (mis. "GHSA-vfj7-8cjw-p6xm");
 * bila url tak memuat GHSA, pakai url utuh; bila tak ada url, `npm-advisory-<source>`.
 * @param {{ url?: string, source?: number|string }} via
 * @returns {string|null}
 */
export function idAdvisory(via) {
  const url = typeof via?.url === 'string' ? via.url : '';
  const m = url.match(POLA_GHSA);
  if (m) return `GHSA${m[0].slice(4).toLowerCase()}`;
  if (url) return url;
  if (via?.source !== undefined && via?.source !== null) return `npm-advisory-${via.source}`;
  return null;
}

/**
 * Telusuri `via` dari satu paket sampai advisory akar (elemen `via` berupa objek).
 * Elemen string menunjuk paket lain yang rentan; ditelusuri rekursif (dengan penjaga siklus).
 * @returns {Array<{ id: string|null, nama: string, judul: string, url: string, severity: string }>}
 */
function akarDari(nama, vulns, dikunjungi = new Set()) {
  if (dikunjungi.has(nama)) return [];
  dikunjungi.add(nama);
  const node = vulns[nama];
  if (!node || !Array.isArray(node.via)) return [];
  const hasil = [];
  for (const via of node.via) {
    if (typeof via === 'string') {
      hasil.push(...akarDari(via, vulns, dikunjungi));
    } else if (via && typeof via === 'object') {
      hasil.push({
        id: idAdvisory(via),
        nama: String(via.name ?? nama),
        judul: String(via.title ?? ''),
        url: String(via.url ?? ''),
        severity: String(via.severity ?? node.severity ?? '').toLowerCase(),
      });
    }
  }
  return hasil;
}

// ---------------------------------------------------------------------------------------------------------------
// Allowlist

/**
 * Validasi isi `audit-allow.json` ({"pengecualian":[{id, alasan, tenggat}]}).
 * Berkas yang salah bentuk TIDAK boleh diam-diam dianggap kosong/lolos: setiap masalah dikembalikan sebagai galat.
 * @param {unknown} mentah
 * @returns {{ entri: Array<{id: string, alasan: string, tenggat: string}>, galat: string[] }}
 */
export function validasiAllowlist(mentah) {
  const galat = [];
  const entri = [];
  if (mentah === undefined || mentah === null) return { entri, galat };
  if (typeof mentah !== 'object' || Array.isArray(mentah) || !Array.isArray(mentah.pengecualian)) {
    galat.push('audit-allow.json harus berupa objek {"pengecualian": [ ... ]}.');
    return { entri, galat };
  }
  const terlihat = new Set();
  mentah.pengecualian.forEach((e, i) => {
    const label = `pengecualian[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      galat.push(`${label}: harus berupa objek {id, alasan, tenggat}.`);
      return;
    }
    const id = typeof e.id === 'string' ? e.id.trim() : '';
    const alasan = typeof e.alasan === 'string' ? e.alasan.trim() : '';
    const tenggat = e.tenggat;
    let sah = true;
    if (!id) {
      galat.push(`${label}: "id" wajib diisi (mis. GHSA-xxxx-xxxx-xxxx).`);
      sah = false;
    } else if (terlihat.has(kunci(id))) {
      galat.push(`${label}: id ${id} duplikat.`);
      sah = false;
    }
    if (!alasan) {
      galat.push(`${label}${id ? ` (${id})` : ''}: "alasan" wajib diisi (pengecualian tanpa alasan tertulis tidak diterima).`);
      sah = false;
    }
    if (!tanggalValid(tenggat)) {
      galat.push(`${label}${id ? ` (${id})` : ''}: "tenggat" wajib berupa tanggal valid YYYY-MM-DD (didapat: ${JSON.stringify(tenggat)}).`);
      sah = false;
    }
    if (id) terlihat.add(kunci(id));
    if (sah) entri.push({ id, alasan, tenggat });
  });
  return { entri, galat };
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluasi (murni)

/**
 * Evaluasi hasil `npm audit --json` terhadap allowlist.
 *
 * @param {{ vulnerabilities?: Record<string, any>, [kunci: string]: any }} auditJson  keluaran `npm audit --json` (auditReportVersion 2)
 * @param {unknown} allowlist  isi audit-allow.json ({pengecualian:[...]}), atau undefined bila berkas tak ada
 * @param {string} hariIni  tanggal WIB 'YYYY-MM-DD' (jangan dari toISOString — itu UTC)
 *
 * Pengecualian berlaku SAMPAI DENGAN tanggal tenggat (inklusif); mulai sehari sesudahnya dianggap kedaluwarsa.
 *
 * @returns {{
 *   ok: boolean,
 *   ringkasan: { totalPaket: number, perTingkat: Record<string, number>, paketHighPlus: number, akarHighPlus: number },
 *   diizinkan: any[], kedaluwarsa: any[], tidakDiizinkan: any[], tanpaAkar: any[],
 *   basi: any[], galatAllowlist: string[], hariIni: string
 * }}
 */
export function evaluasiAudit(auditJson, allowlist, hariIni) {
  if (!tanggalValid(hariIni)) throw new Error(`hariIni harus berformat YYYY-MM-DD yang valid (didapat: ${JSON.stringify(hariIni)}).`);
  const vulns = auditJson?.vulnerabilities;
  if (!vulns || typeof vulns !== 'object' || Array.isArray(vulns)) {
    throw new Error('Keluaran npm audit tidak memuat objek "vulnerabilities".');
  }

  const { entri, galat: galatAllowlist } = validasiAllowlist(allowlist);
  const petaAllow = new Map(entri.map((e) => [kunci(e.id), e]));

  /** @type {Record<string, number>} */
  const perTingkat = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  let paketHighPlus = 0;
  /** @type {Map<string, any>} */
  const akar = new Map();
  /** @type {any[]} */
  const tanpaAkar = [];

  for (const [nama, node] of Object.entries(vulns)) {
    const sev = String(node?.severity ?? '').toLowerCase();
    if (sev in perTingkat) perTingkat[sev] += 1;
    if (bobot(sev) < AMBANG_BLOK) continue;
    paketHighPlus += 1;

    const penentu = akarDari(nama, vulns).filter((a) => bobot(a.severity) >= AMBANG_BLOK);
    if (penentu.length === 0) {
      // Paket high+ tanpa advisory akar high+ yang bisa ditelusuri: jangan lolos diam-diam.
      tanpaAkar.push({ paket: nama, severity: sev });
      continue;
    }
    for (const a of penentu) {
      const id = a.id ?? `tanpa-id:${nama}`;
      const k = kunci(id);
      let rekaman = akar.get(k);
      if (!rekaman) {
        rekaman = { id, nama: a.nama, judul: a.judul, url: a.url, severity: a.severity, paketTerdampak: new Set() };
        akar.set(k, rekaman);
      }
      rekaman.paketTerdampak.add(nama);
    }
  }

  const diizinkan = [];
  const kedaluwarsa = [];
  const tidakDiizinkan = [];
  const urut = (a, b) => a.id.localeCompare(b.id);
  for (const a of akar.values()) {
    const rekaman = { ...a, paketTerdampak: [...a.paketTerdampak].sort() };
    const izin = petaAllow.get(kunci(a.id));
    if (!izin) {
      tidakDiizinkan.push(rekaman);
    } else if (izin.tenggat < hariIni) {
      kedaluwarsa.push({ ...rekaman, alasan: izin.alasan, tenggat: izin.tenggat });
    } else {
      diizinkan.push({ ...rekaman, alasan: izin.alasan, tenggat: izin.tenggat });
    }
  }
  diizinkan.sort(urut);
  kedaluwarsa.sort(urut);
  tidakDiizinkan.sort(urut);

  const basi = entri.filter((e) => !akar.has(kunci(e.id)));

  return {
    ok:
      tidakDiizinkan.length === 0 &&
      kedaluwarsa.length === 0 &&
      tanpaAkar.length === 0 &&
      galatAllowlist.length === 0,
    ringkasan: {
      totalPaket: Object.keys(vulns).length,
      perTingkat,
      paketHighPlus,
      akarHighPlus: akar.size,
    },
    diizinkan,
    kedaluwarsa,
    tidakDiizinkan,
    tanpaAkar,
    basi,
    galatAllowlist,
    hariIni,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pembacaan keluaran & format laporan (murni)

/**
 * Urai stdout `npm audit --json`. Melempar Error bila bukan hasil audit yang sah
 * (JSON rusak, atau npm melaporkan galat jaringan/registry): gerbang harus gagal, bukan lolos.
 * @param {string} stdout
 */
export function bacaKeluaranAudit(stdout) {
  let json;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw new Error('Keluaran `npm audit --json` bukan JSON yang valid (periksa koneksi internet/registry npm, lalu ulangi).');
  }
  if (json && typeof json === 'object' && json.error) {
    // npm bisa mengisi `summary` kosong dan menaruh sebabnya di `message` tingkat atas (mis. ECONNREFUSED).
    const e = json.error;
    const sebab = [json.message, e.summary, e.code, e.detail].find((x) => typeof x === 'string' && x.trim()) ?? JSON.stringify(e);
    throw new Error(`npm audit gagal: ${sebab}`);
  }
  if (!json || typeof json !== 'object' || typeof json.vulnerabilities !== 'object' || json.vulnerabilities === null) {
    throw new Error('Keluaran `npm audit --json` tidak memuat "vulnerabilities" (format tidak dikenali).');
  }
  return json;
}

/**
 * Susun laporan teks (satu elemen = satu baris).
 * @param {ReturnType<typeof evaluasiAudit>} h
 */
export function formatLaporan(h) {
  const { ringkasan: r } = h;
  const t = r.perTingkat;
  const baris = [];
  baris.push(`[audit] npm audit: ${r.totalPaket} paket rentan (critical ${t.critical}, high ${t.high}, moderate ${t.moderate}, low ${t.low}, info ${t.info}); tanggal acuan WIB ${h.hariIni}.`);
  baris.push(`[audit] Ambang pemblokiran: high ke atas. Paket high+: ${r.paketHighPlus}; advisory akar high+: ${r.akarHighPlus} (diizinkan ${h.diizinkan.length}, kedaluwarsa ${h.kedaluwarsa.length}, tidak diizinkan ${h.tidakDiizinkan.length}).`);

  for (const a of h.diizinkan) {
    baris.push(`[audit] DIIZINKAN ${a.id} (${a.severity}, ${a.nama}) s.d. ${a.tenggat} — terdampak: ${a.paketTerdampak.join(', ')}`);
    baris.push(`[audit]   alasan: ${a.alasan}`);
  }
  for (const a of h.kedaluwarsa) {
    baris.push(`[audit] GAGAL kedaluwarsa ${a.id} (${a.severity}, ${a.nama}): tenggat ${a.tenggat} sudah lewat (hari ini ${h.hariIni}). Kaji ulang: perbarui paket, atau perpanjang tenggat di audit-allow.json beserta alasan baru.`);
    baris.push(`[audit]   judul: ${a.judul}; terdampak: ${a.paketTerdampak.join(', ')}`);
  }
  for (const a of h.tidakDiizinkan) {
    baris.push(`[audit] GAGAL ${a.id} (${a.severity}, ${a.nama}) tidak ada di audit-allow.json — ${a.judul || 'tanpa judul'}`);
    baris.push(`[audit]   terdampak: ${a.paketTerdampak.join(', ')}${a.url ? `; ${a.url}` : ''}`);
    baris.push('[audit]   perbaiki dependensinya, atau (bila belum ada perbaikan layak) tambahkan pengecualian beralasan + tenggat di audit-allow.json.');
  }
  for (const p of h.tanpaAkar) {
    baris.push(`[audit] GAGAL paket ${p.paket} bertingkat ${p.severity} tetapi advisory akarnya tidak dapat ditelusuri dari keluaran npm audit; periksa manual dengan \`npm audit\`.`);
  }
  for (const g of h.galatAllowlist) {
    baris.push(`[audit] GAGAL audit-allow.json tidak valid — ${g}`);
  }
  for (const e of h.basi) {
    baris.push(`[audit] PERINGATAN pengecualian basi: ${e.id} (tenggat ${e.tenggat}) tidak lagi dipakai oleh advisory high+ mana pun; hapus dari audit-allow.json.`);
  }

  baris.push(h.ok ? '[audit] LOLOS: tidak ada advisory high+ di luar pengecualian yang masih berlaku.' : '[audit] GAGAL: lihat pelanggaran di atas.');
  return baris;
}

// ---------------------------------------------------------------------------------------------------------------
// I/O

const AKAR_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Jalankan `npm audit --json` dan kembalikan stdout (exit code non-zero itu NORMAL saat ada temuan). */
function jalankanNpmAudit() {
  // Satu string perintah konstan + shell: portabel (npm.cmd di Windows butuh shell; tanpa masukan eksternal).
  const r = spawnSync('npm audit --json', {
    cwd: AKAR_REPO,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  if (r.error) throw new Error(`Tidak dapat menjalankan npm audit: ${r.error.message}`);
  return r.stdout ?? '';
}

/** Baca audit-allow.json; berkas tidak ada = tanpa pengecualian. */
function bacaAllowlist() {
  const berkas = resolve(AKAR_REPO, 'audit-allow.json');
  if (!existsSync(berkas)) return undefined;
  try {
    return JSON.parse(readFileSync(berkas, 'utf8'));
  } catch (e) {
    throw new Error(`audit-allow.json bukan JSON yang valid: ${e instanceof Error ? e.message : e}`);
  }
}

/** @returns {number} kode keluar */
function main() {
  let hasil;
  try {
    const auditJson = bacaKeluaranAudit(jalankanNpmAudit());
    hasil = evaluasiAudit(auditJson, bacaAllowlist(), hariIniWIB());
  } catch (e) {
    console.error(`[audit] GAGAL menjalankan gerbang audit: ${e instanceof Error ? e.message : e}`);
    return 2;
  }
  // Satu aliran (stdout) agar urutan baris tetap utuh di terminal maupun log.
  for (const baris of formatLaporan(hasil)) console.log(baris);
  return hasil.ok ? 0 : 1;
}

// Hanya jalankan saat dipanggil langsung (`node scripts/check-audit.mjs`), bukan saat diimpor oleh test.
if (process.argv[1] && basename(process.argv[1]) === 'check-audit.mjs') {
  process.exitCode = main();
}
