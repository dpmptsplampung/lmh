// Parser "objek penanda" (marker) untuk file migrasi SQL + penentu status terpasang/tidak.
//
// Dipakai scripts/verify-migration-ledger.mjs dan scripts/fill-migration-ledger.mjs untuk membuktikan, PER migrasi,
// apakah migrasi yang tidak tercatat di supabase_migrations.schema_migrations benar-benar sudah terpasang di database.
// Modul ini MURNI (tanpa I/O, tanpa koneksi DB) sehingga bisa diuji tanpa database
// (lihat scripts/lib/migration-markers.test.ts).
//
// Penanda yang dikenali: CREATE/DROP TABLE, ADD/DROP COLUMN, ALTER COLUMN TYPE, CREATE/DROP FUNCTION|PROCEDURE
// (kunci memuat jumlah argumen = pembeda overload), CREATE/DROP INDEX, CREATE/DROP POLICY, CREATE/DROP VIEW,
// CREATE/DROP TRIGGER, ADD/DROP CONSTRAINT, cron.schedule/unschedule, ALTER PUBLICATION ADD/DROP TABLE,
// CREATE/DROP EXTENSION, dan INSERT INTO storage.buckets (id pertama).
//
// Prinsip kejujuran (jangan menebak):
//  - Penanda yang di-DROP oleh migrasi LEBIH BARU (dan tidak dibuat ulang) berstatus `digantikan`: ketiadaannya
//    di database tidak dianggap bukti apa pun.
//  - Keberadaan objek yang JUGA dibuat/didefinisikan ulang migrasi lain (mis. CREATE OR REPLACE FUNCTION, atau
//    DROP POLICY + CREATE POLICY di beberapa migrasi) TIDAK membuktikan migrasi ini: kekuatannya `lemah`.
//    Hanya penanda `kuat` (hanya dibuat oleh migrasi ini) yang dapat membuat status `terpasang`.
//  - Migrasi tanpa penanda sama sekali (mis. hanya UPDATE data) => `tidak_dapat_ditentukan`.

/** Pengenal SQL: "kutip ganda" atau tanpa kutip. */
const ID = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
/** Nama berkualifikasi opsional `skema.nama`, dengan grup bernama `<p>1` (skema atau nama) dan `<p>2` (nama). */
const qn = (p) => String.raw`(?<${p}1>${ID})(?:\s*\.\s*(?<${p}2>${ID}))?`;

/** Lepas kutip ganda (pertahankan huruf) atau turunkan huruf (pengenal tanpa kutip dilipat ke huruf kecil oleh PG). */
function buka(id) {
  if (id.startsWith('"')) return id.slice(1, -1).replace(/""/g, '"');
  return id.toLowerCase();
}

/** Ambil {skema, nama} dari grup regex. Tanpa kualifikasi => skema `public`. */
function namaDari(g, p, skemaDefault = 'public') {
  const a = g[`${p}1`];
  const b = g[`${p}2`];
  return b ? { skema: buka(a), nama: buka(b) } : { skema: skemaDefault, nama: buka(a) };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Pembersihan teks SQL
// ---------------------------------------------------------------------------------------------------------------

/**
 * Hapus komentar, ganti isi literal string dengan token `'#<indeks>'` (isi asli di `literal[indeks]`), dan ganti isi
 * dollar-quote ($$..$$ / $tag$..$tag$) dengan `$$` KECUALI badan blok `DO $$ .. $$` yang di-inline (badan blok DO
 * dapat berisi DDL nyata; badan fungsi tidak dipindai karena bukan DDL tingkat atas).
 * Isi dollar-quote non-DO disimpan di `badan` dan diwakili token `$$#<indeks>$$` (dipakai sidik jari isi fungsi).
 * @param {string} sql
 * @param {string[]} [literal]
 * @param {string[]} [badan]
 * @returns {{ teks: string, literal: string[], badan: string[] }}
 */
export function bersihkanSql(sql, literal = [], badan = []) {
  let out = '';
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl; // newline dipertahankan
      continue;
    }
    if (c === '/' && d === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      out += ' ';
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let isi = '';
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { isi += "'"; j += 2; }
        else if (sql[j] === "'") { j++; break; }
        else { isi += sql[j]; j++; }
      }
      literal.push(isi);
      out += `'#${literal.length - 1}'`;
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') { j++; break; }
        else j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$') {
      const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const akhir = sql.indexOf(tag, i + tag.length);
        if (akhir !== -1) {
          const isi = sql.slice(i + tag.length, akhir);
          if (/\bDO\s+(?:LANGUAGE\s+[A-Za-z_]+\s+)?$/i.test(out.slice(-80))) {
            out += ` ${bersihkanSql(isi, literal, badan).teks} `;
          } else {
            badan.push(isi);
            out += `$$#${badan.length - 1}$$`;
          }
          i = akhir + tag.length;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return { teks: out, literal, badan };
}

/**
 * Pecah file SQL menjadi pernyataan tingkat atas (pemisah `;` di luar komentar/string/dollar-quote). Komentar di awal
 * menempel ke pernyataan berikutnya dan `;` penutup dibuang, mengikuti cara Supabase CLI mengisi kolom `statements`
 * di supabase_migrations.schema_migrations. Pernyataan yang hanya berisi komentar dibuang.
 * @param {string} sql
 * @returns {string[]}
 */
export function pecahPernyataan(sql) {
  const hasil = [];
  let cur = '';
  const n = sql.length;
  let i = 0;
  const simpan = () => {
    const s = cur.trim();
    if (s && bersihkanSql(s).teks.trim()) hasil.push(s);
    cur = '';
  };
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') {
      const nl = sql.indexOf('\n', i);
      const j = nl === -1 ? n : nl;
      cur += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      cur += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) { j++; break; }
        else j++;
      }
      cur += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$') {
      const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const akhir = sql.indexOf(tag, i + tag.length);
        if (akhir !== -1) {
          cur += sql.slice(i, akhir + tag.length);
          i = akhir + tag.length;
          continue;
        }
      }
    }
    if (c === ';') {
      simpan();
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  simpan();
  return hasil;
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Utilitas pemindai
// ---------------------------------------------------------------------------------------------------------------

/** Indeks `)` pasangan dari `(` di posisi `mulai` (atau -1). Isi kutip ganda dilewati; string sudah dimasking. */
function kurungSeimbang(teks, mulai) {
  let depth = 0;
  for (let i = mulai; i < teks.length; i++) {
    const ch = teks[i];
    if (ch === '"') {
      const j = teks.indexOf('"', i + 1);
      if (j === -1) return -1;
      i = j;
    } else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Pecah `teks` pada koma tingkat atas (di luar tanda kurung). */
function pecahKoma(teks) {
  const hasil = [];
  let depth = 0;
  let awal = 0;
  for (let i = 0; i < teks.length; i++) {
    const ch = teks[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      hasil.push(teks.slice(awal, i));
      awal = i + 1;
    }
  }
  hasil.push(teks.slice(awal));
  return hasil.map((s) => s.trim()).filter(Boolean);
}

/** Jumlah argumen MASUK dari isi daftar argumen fungsi (parameter OUT tidak dihitung, sama seperti pg_proc.pronargs). */
function hitungArgumen(isi) {
  return pecahKoma(isi).filter((p) => !/^OUT\s/i.test(p)).length;
}

const ALIAS_TIPE = [
  [/\bbigserial\b/g, 'bigint'],
  [/\bsmallserial\b/g, 'smallint'],
  [/\bserial\b/g, 'integer'],
  [/\bint8\b/g, 'bigint'],
  [/\bint4\b/g, 'integer'],
  [/\bint2\b/g, 'smallint'],
  [/\bint\b/g, 'integer'],
  [/\bbool\b/g, 'boolean'],
  [/\bfloat8\b/g, 'double precision'],
  [/\bfloat4\b/g, 'real'],
  [/\bdecimal\b/g, 'numeric'],
  [/\btimestamptz\b/g, 'timestamp with time zone'],
  [/\btimetz\b/g, 'time with time zone'],
  [/\bvarchar\b/g, 'character varying'],
  [/\bchar\b/g, 'character'],
  // "timestamp"/"time" polos = tanpa zona waktu (format_type PG selalu menuliskannya eksplisit)
  [/\btimestamp\b(?!\s*(?:\(\d+\)\s*)?(?:with|without)\b)/g, 'timestamp without time zone'],
  [/(?<!(?:with|without) )\btime\b(?!\s*(?:\(\d+\)\s*)?(?:with|without|zone)\b)/g, 'time without time zone'],
];

/**
 * Normalisasi nama tipe agar tulisan di SQL dan keluaran format_type() PG sebanding: huruf kecil, tanpa awalan skema
 * (extensions./public./pg_catalog.), spasi dirapikan, alias umum (int, varchar, timestamptz, ...) diseragamkan.
 * @param {string} tipe
 * @returns {string}
 */
export function normalisasiTipe(tipe) {
  let t = String(tipe).toLowerCase().replace(/\s+/g, ' ').trim();
  t = t.replace(/\b(?:extensions|public|pg_catalog)\./g, '');
  t = t.replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')').replace(/\s*,\s*/g, ',');
  for (const [re, ganti] of ALIAS_TIPE) t = t.replace(re, ganti);
  return t.trim();
}

/**
 * Normalisasi badan fungsi agar sebanding dengan pg_proc.prosrc (yang menyimpan badan apa adanya): buang CR, ratakan
 * spasi/baris baru. Dipakai sebagai sidik jari isi fungsi.
 * @param {string} badan
 * @returns {string}
 */
export function normalisasiBadan(badan) {
  return hapusKomentar(String(badan ?? '')).replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

// Buang komentar baris (dua tanda minus) dan komentar blok, tetapi pertahankan isi string/identifier/dollar-quote apa adanya.
function hapusKomentar(sql) {
  let out = '';
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (c === '/' && d === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) { j++; break; }
        else j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$') {
      const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (m) {
        const akhir = sql.indexOf(m[0], i + m[0].length);
        if (akhir !== -1) {
          out += sql.slice(i, akhir + m[0].length);
          i = akhir + m[0].length;
          continue;
        }
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Ambil teks tipe dari sisa definisi kolom: berhenti pada koma/`;`/kurung tutup tingkat atas atau kata kunci batasan. */
function ambilTipe(sisa) {
  let depth = 0;
  let akhir = sisa.length;
  for (let i = 0; i < sisa.length; i++) {
    const ch = sisa[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) { akhir = i; break; }
      depth--;
    } else if (depth === 0 && (ch === ',' || ch === ';')) { akhir = i; break; }
  }
  let t = sisa.slice(0, akhir);
  const m = /\b(?:NOT\s+NULL|NULL|DEFAULT|PRIMARY|REFERENCES|CHECK|UNIQUE|GENERATED|CONSTRAINT|COLLATE|USING)\b/i.exec(t);
  if (m) t = t.slice(0, m.index);
  return normalisasiTipe(t);
}

// ---------------------------------------------------------------------------------------------------------------
// 3. Peristiwa (penanda) per berkas
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {'tabel'|'kolom'|'tipe_kolom'|'fungsi'|'indeks'|'policy'|'view'|'trigger'|'cron'|'constraint'|'publikasi'|'ekstensi'|'bucket'} JenisPenanda
 * @typedef {object} Peristiwa
 * @property {'buat'|'hapus'} aksi
 * @property {JenisPenanda} jenis
 * @property {string} kunci Identitas objek (stabil lintas migrasi).
 * @property {string} label Teks ringkas untuk laporan.
 * @property {number} pos Posisi kemunculan di teks bersih (urutan eksekusi dalam berkas).
 * @property {string} [skema]
 * @property {string} [nama]
 * @property {string} [tabel]
 * @property {number} [arity]
 * @property {string} [tipe]
 * @property {string} [pub]
 * @property {string} [induk] Kunci tabel induk (objek ikut hilang bila tabel di-DROP).
 * @property {boolean} [implisit] Berasal dari badan CREATE TABLE / ADD COLUMN: hanya untuk lini masa, tidak dilaporkan sebagai penanda.
 */

function kunciDari(e) {
  switch (e.jenis) {
    case 'tabel': return `tabel:${e.skema}.${e.nama}`;
    case 'kolom': return `kolom:${e.skema}.${e.tabel}.${e.nama}`;
    case 'tipe_kolom': return `tipe:${e.skema}.${e.tabel}.${e.nama}`;
    case 'fungsi': return `fungsi:${e.skema}.${e.nama}/${e.arity}`;
    case 'indeks': return `indeks:${e.skema}.${e.nama}`;
    case 'policy': return `policy:${e.skema}.${e.tabel}:${e.nama}`;
    case 'view': return `view:${e.skema}.${e.nama}`;
    case 'trigger': return `trigger:${e.skema}.${e.tabel}:${e.nama}`;
    case 'cron': return `cron:${e.nama}`;
    case 'constraint': return `constraint:${e.skema}.${e.tabel}:${e.nama}`;
    case 'publikasi': return `publikasi:${e.pub}:${e.skema}.${e.tabel}`;
    case 'ekstensi': return `ekstensi:${e.nama}`;
    case 'bucket': return `bucket:${e.nama}`;
    default: throw new Error(`jenis penanda tidak dikenal: ${e.jenis}`);
  }
}

function labelDari(e) {
  switch (e.jenis) {
    case 'tabel': return `tabel ${e.skema}.${e.nama}`;
    case 'kolom': return `kolom ${e.skema}.${e.tabel}.${e.nama}`;
    case 'tipe_kolom': return `tipe kolom ${e.skema}.${e.tabel}.${e.nama} = ${e.tipe}`;
    case 'fungsi': return `fungsi ${e.skema}.${e.nama}(${e.arity} arg)`;
    case 'indeks': return `indeks ${e.skema}.${e.nama}`;
    case 'policy': return `policy "${e.nama}" ON ${e.skema}.${e.tabel}`;
    case 'view': return `view ${e.skema}.${e.nama}`;
    case 'trigger': return `trigger ${e.nama} ON ${e.skema}.${e.tabel}`;
    case 'cron': return `cron job ${e.nama}`;
    case 'constraint': return `constraint ${e.nama} ON ${e.skema}.${e.tabel}`;
    case 'publikasi': return `publikasi ${e.pub} memuat ${e.skema}.${e.tabel}`;
    case 'ekstensi': return `ekstensi ${e.nama}`;
    case 'bucket': return `storage bucket ${e.nama}`;
    default: return e.kunci;
  }
}

/** @returns {Peristiwa} */
function peristiwa(aksi, jenis, f, pos, ekstra = {}) {
  const e = { aksi, jenis, pos, ...f, ...ekstra };
  if (['kolom', 'tipe_kolom', 'policy', 'trigger', 'constraint', 'indeks', 'publikasi'].includes(jenis) && f.skema && f.tabel) {
    e.induk = `tabel:${f.skema}.${f.tabel}`;
  }
  e.kunci = kunciDari(e);
  e.label = labelDari(e);
  return e;
}

const RE = {
  buatTabel: new RegExp(String.raw`\bCREATE\s+(?<opt>(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+)|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${qn('t')}`, 'gi'),
  hapusTabel: new RegExp(String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?<lst>[^;]*)`, 'gi'),
  ubahTabel: new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${qn('t')}\s+(?<klausa>[^;]*)`, 'gi'),
  tambahKolom: new RegExp(String.raw`\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<c>${ID})\s+`, 'gi'),
  hapusKolom: new RegExp(String.raw`\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?<c>${ID})`, 'gi'),
  tambahConstraint: new RegExp(String.raw`\bADD\s+CONSTRAINT\s+(?<c>${ID})`, 'gi'),
  hapusConstraint: new RegExp(String.raw`\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(?<c>${ID})`, 'gi'),
  ubahTipe: new RegExp(String.raw`\bALTER\s+(?:COLUMN\s+)?(?<c>${ID})\s+(?:SET\s+DATA\s+)?TYPE\s+`, 'gi'),
  buatFungsi: new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+${qn('f')}\s*\(`, 'gi'),
  hapusFungsi: new RegExp(String.raw`\bDROP\s+(?:FUNCTION|PROCEDURE)\s+(?:IF\s+EXISTS\s+)?${qn('f')}\s*(?<par>\()?`, 'gi'),
  buatIndeks: new RegExp(String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?!ON\b)(?<i>${ID})\s+ON\s+(?:ONLY\s+)?${qn('t')}`, 'gi'),
  hapusIndeks: new RegExp(String.raw`\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?${qn('i')}`, 'gi'),
  buatPolicy: new RegExp(String.raw`\bCREATE\s+POLICY\s+(?<p>${ID})\s+ON\s+${qn('t')}`, 'gi'),
  hapusPolicy: new RegExp(String.raw`\bDROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(?<p>${ID})\s+ON\s+${qn('t')}`, 'gi'),
  buatView: new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?<temp>(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+))?(?<mat>MATERIALIZED\s+)?(?:RECURSIVE\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?${qn('v')}`, 'gi'),
  hapusView: new RegExp(String.raw`\bDROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?${qn('v')}`, 'gi'),
  buatTrigger: new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+(?<g>${ID})\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\b[^;]*?\bON\s+${qn('t')}`, 'gi'),
  hapusTrigger: new RegExp(String.raw`\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(?<g>${ID})\s+ON\s+${qn('t')}`, 'gi'),
  cronJadwal: /\bcron\s*\.\s*schedule\s*\(\s*'#(?<n>\d+)'/gi,
  cronBatal: /\bcron\s*\.\s*unschedule\s*\(\s*'#(?<n>\d+)'/gi,
  publikasi: new RegExp(String.raw`\bALTER\s+PUBLICATION\s+(?<pub>${ID})\s+(?<op>ADD|DROP)\s+TABLE\s+(?<lst>[^;]*)`, 'gi'),
  buatEkstensi: new RegExp(String.raw`\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(?<e>${ID})`, 'gi'),
  hapusEkstensi: new RegExp(String.raw`\bDROP\s+EXTENSION\s+(?:IF\s+EXISTS\s+)?(?<e>${ID})`, 'gi'),
  bucket: /\bINSERT\s+INTO\s+storage\s*\.\s*buckets\s*\([^)]*\)\s*VALUES\s*\(\s*'#(?<n>\d+)'/gi,
  rename: /\bALTER\s+(?:TABLE|VIEW|INDEX|FUNCTION|MATERIALIZED\s+VIEW)\b[^;]*\bRENAME\b/gi,
};

/** Jalankan regex global dan panggil `fn(match)` untuk tiap kecocokan (lastIndex dijaga). */
function setiap(re, teks, fn) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(teks)) !== null) {
    fn(m);
    if (m[0].length === 0) re.lastIndex++;
  }
}

/** Daftar nama berkualifikasi dipisah koma, mis. "public.a, b" => [{skema,nama}]. */
function daftarNama(lst) {
  const re = new RegExp(String.raw`^\s*(?:ONLY\s+)?${qn('x')}`, 'i');
  const hasil = [];
  for (const bagian of pecahKoma(lst)) {
    const m = re.exec(bagian);
    if (m?.groups) hasil.push(namaDari(m.groups, 'x'));
  }
  return hasil;
}

/**
 * Ekstrak semua peristiwa penanda dari satu file SQL, berurutan menurut posisi di berkas.
 * @param {string} sql
 * @returns {{ peristiwa: Peristiwa[], peringatan: string[] }}
 */
export function ekstrakPenanda(sql) {
  const { teks, literal, badan } = bersihkanSql(sql);
  /** @type {Peristiwa[]} */
  const ev = [];
  /** @type {string[]} */
  const peringatan = [];

  // CREATE TABLE (+ kolom & constraint bernama di badan tabel sebagai peristiwa implisit untuk lini masa)
  setiap(RE.buatTabel, teks, (m) => {
    if (m.groups.opt && /TEMP|TEMPORARY/i.test(m.groups.opt)) return;
    const t = namaDari(m.groups, 't');
    ev.push(peristiwa('buat', 'tabel', t, m.index));
    let j = m.index + m[0].length;
    while (j < teks.length && /\s/.test(teks[j])) j++;
    if (teks[j] !== '(') return; // PARTITION OF / AS SELECT / dst: tanpa daftar kolom
    const tutup = kurungSeimbang(teks, j);
    if (tutup === -1) return;
    let seq = 0;
    for (const butir of pecahKoma(teks.slice(j + 1, tutup))) {
      seq++;
      const pos = m.index + seq / 1000;
      const mc = new RegExp(String.raw`^CONSTRAINT\s+(?<c>${ID})`, 'i').exec(butir);
      if (mc?.groups) {
        ev.push(peristiwa('buat', 'constraint', { skema: t.skema, tabel: t.nama, nama: buka(mc.groups.c) }, pos, { implisit: true }));
        continue;
      }
      if (/^(?:PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|LIKE|EXCLUDE)\b/i.test(butir)) continue;
      const mk = new RegExp(String.raw`^(?<c>${ID})\s+(?<sisa>[\s\S]*)$`).exec(butir);
      if (!mk?.groups) continue;
      const kolom = buka(mk.groups.c);
      ev.push(peristiwa('buat', 'kolom', { skema: t.skema, tabel: t.nama, nama: kolom }, pos, { implisit: true }));
      const tipe = ambilTipe(mk.groups.sisa);
      if (tipe) ev.push(peristiwa('buat', 'tipe_kolom', { skema: t.skema, tabel: t.nama, nama: kolom, tipe }, pos + 0.0001, { implisit: true }));
    }
  });

  // DROP TABLE
  setiap(RE.hapusTabel, teks, (m) => {
    // "ALTER PUBLICATION p DROP TABLE x" bukan DROP TABLE (ditangani sebagai peristiwa publikasi)
    if (/\bALTER\s+PUBLICATION\s+\S+\s+$/i.test(teks.slice(Math.max(0, m.index - 120), m.index))) return;
    for (const t of daftarNama(m.groups.lst)) ev.push(peristiwa('hapus', 'tabel', t, m.index));
  });

  // ALTER TABLE ... (ADD/DROP COLUMN, ADD/DROP CONSTRAINT, ALTER COLUMN TYPE)
  setiap(RE.ubahTabel, teks, (m) => {
    const t = namaDari(m.groups, 't');
    const klausa = m.groups.klausa;
    const dasar = m.index + m[0].length - klausa.length;
    setiap(RE.tambahKolom, klausa, (k) => {
      const kolom = buka(k.groups.c);
      const pos = dasar + k.index;
      ev.push(peristiwa('buat', 'kolom', { skema: t.skema, tabel: t.nama, nama: kolom }, pos));
      const tipe = ambilTipe(klausa.slice(k.index + k[0].length));
      if (tipe) ev.push(peristiwa('buat', 'tipe_kolom', { skema: t.skema, tabel: t.nama, nama: kolom, tipe }, pos + 0.0001, { implisit: true }));
    });
    setiap(RE.hapusKolom, klausa, (k) => {
      ev.push(peristiwa('hapus', 'kolom', { skema: t.skema, tabel: t.nama, nama: buka(k.groups.c) }, dasar + k.index));
    });
    setiap(RE.tambahConstraint, klausa, (k) => {
      ev.push(peristiwa('buat', 'constraint', { skema: t.skema, tabel: t.nama, nama: buka(k.groups.c) }, dasar + k.index));
    });
    setiap(RE.hapusConstraint, klausa, (k) => {
      ev.push(peristiwa('hapus', 'constraint', { skema: t.skema, tabel: t.nama, nama: buka(k.groups.c) }, dasar + k.index));
    });
    setiap(RE.ubahTipe, klausa, (k) => {
      const tipe = ambilTipe(klausa.slice(k.index + k[0].length));
      if (tipe) ev.push(peristiwa('buat', 'tipe_kolom', { skema: t.skema, tabel: t.nama, nama: buka(k.groups.c), tipe }, dasar + k.index));
    });
  });

  // FUNCTION / PROCEDURE (kunci = nama + jumlah argumen masuk)
  setiap(RE.buatFungsi, teks, (m) => {
    const f = namaDari(m.groups, 'f');
    const buka0 = m.index + m[0].length - 1;
    const tutup = kurungSeimbang(teks, buka0);
    if (tutup === -1) { peringatan.push(`CREATE FUNCTION ${f.nama}: kurung argumen tidak seimbang`); return; }
    // Sidik jari isi: badan `AS $$...$$` / `AS '...'` (sampai `;` penutup pernyataan; isi sudah dimasking jadi aman).
    const akhirStmt = teks.indexOf(';', tutup);
    const sisa = teks.slice(tutup + 1, akhirStmt === -1 ? undefined : akhirStmt);
    let sidik;
    const mb = /\bAS\s+\$\$#(\d+)\$\$/i.exec(sisa);
    const ms = /\bAS\s+'#(\d+)'/i.exec(sisa);
    if (mb) sidik = normalisasiBadan(badan[Number(mb[1])]);
    else if (ms) sidik = normalisasiBadan(literal[Number(ms[1])]);
    ev.push(peristiwa('buat', 'fungsi', { ...f, arity: hitungArgumen(teks.slice(buka0 + 1, tutup)) }, m.index, { sidik }));
  });
  setiap(RE.hapusFungsi, teks, (m) => {
    const f = namaDari(m.groups, 'f');
    if (!m.groups.par) { peringatan.push(`DROP FUNCTION ${f.nama} tanpa daftar argumen: jumlah argumen tidak diketahui, diabaikan`); return; }
    const buka0 = m.index + m[0].length - 1;
    const tutup = kurungSeimbang(teks, buka0);
    if (tutup === -1) { peringatan.push(`DROP FUNCTION ${f.nama}: kurung argumen tidak seimbang`); return; }
    ev.push(peristiwa('hapus', 'fungsi', { ...f, arity: hitungArgumen(teks.slice(buka0 + 1, tutup)) }, m.index));
  });

  // INDEX
  setiap(RE.buatIndeks, teks, (m) => {
    const t = namaDari(m.groups, 't');
    ev.push(peristiwa('buat', 'indeks', { skema: t.skema, nama: buka(m.groups.i), tabel: t.nama }, m.index));
  });
  setiap(RE.hapusIndeks, teks, (m) => {
    const i = namaDari(m.groups, 'i');
    ev.push(peristiwa('hapus', 'indeks', i, m.index));
  });

  // POLICY
  setiap(RE.buatPolicy, teks, (m) => {
    const t = namaDari(m.groups, 't');
    ev.push(peristiwa('buat', 'policy', { skema: t.skema, tabel: t.nama, nama: buka(m.groups.p) }, m.index));
  });
  setiap(RE.hapusPolicy, teks, (m) => {
    const t = namaDari(m.groups, 't');
    ev.push(peristiwa('hapus', 'policy', { skema: t.skema, tabel: t.nama, nama: buka(m.groups.p) }, m.index));
  });

  // VIEW
  setiap(RE.buatView, teks, (m) => {
    if (m.groups.temp) return;
    ev.push(peristiwa('buat', 'view', namaDari(m.groups, 'v'), m.index));
  });
  setiap(RE.hapusView, teks, (m) => {
    ev.push(peristiwa('hapus', 'view', namaDari(m.groups, 'v'), m.index));
  });

  // TRIGGER
  setiap(RE.buatTrigger, teks, (m) => {
    const t = namaDari(m.groups, 't');
    ev.push(peristiwa('buat', 'trigger', { skema: t.skema, tabel: t.nama, nama: buka(m.groups.g) }, m.index));
  });
  setiap(RE.hapusTrigger, teks, (m) => {
    const t = namaDari(m.groups, 't');
    ev.push(peristiwa('hapus', 'trigger', { skema: t.skema, tabel: t.nama, nama: buka(m.groups.g) }, m.index));
  });

  // pg_cron (schedule bernama; bentuk 2-argumen "cron.schedule('<ekspresi>', cmd)" diabaikan)
  setiap(RE.cronJadwal, teks, (m) => {
    const nama = literal[Number(m.groups.n)];
    if (/^[\d*/,\-\s]+$/.test(nama) || /^\d+\s+seconds?$/i.test(nama)) return;
    ev.push(peristiwa('buat', 'cron', { nama }, m.index));
  });
  setiap(RE.cronBatal, teks, (m) => {
    ev.push(peristiwa('hapus', 'cron', { nama: literal[Number(m.groups.n)] }, m.index));
  });

  // ALTER PUBLICATION ... ADD/DROP TABLE
  setiap(RE.publikasi, teks, (m) => {
    const aksi = m.groups.op.toUpperCase() === 'ADD' ? 'buat' : 'hapus';
    for (const t of daftarNama(m.groups.lst)) {
      ev.push(peristiwa(aksi, 'publikasi', { pub: buka(m.groups.pub), skema: t.skema, tabel: t.nama }, m.index));
    }
  });

  // EXTENSION
  setiap(RE.buatEkstensi, teks, (m) => ev.push(peristiwa('buat', 'ekstensi', { nama: buka(m.groups.e) }, m.index)));
  setiap(RE.hapusEkstensi, teks, (m) => ev.push(peristiwa('hapus', 'ekstensi', { nama: buka(m.groups.e) }, m.index)));

  // storage.buckets (kolom pertama = id)
  setiap(RE.bucket, teks, (m) => {
    ev.push(peristiwa('buat', 'bucket', { nama: literal[Number(m.groups.n)] }, m.index));
  });

  // RENAME tidak dimodelkan: beri peringatan agar tidak ditebak
  setiap(RE.rename, teks, (m) => {
    peringatan.push(`ada ALTER ... RENAME (${m[0].replace(/\s+/g, ' ').slice(0, 60)}...): perubahan nama tidak dimodelkan`);
  });

  ev.sort((a, b) => a.pos - b.pos);
  return { peristiwa: ev, peringatan };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Analisis lini masa seluruh migrasi
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {object} Penanda
 * @property {'buat'|'hapus'} aksi `buat` = objek HARUS ada setelah migrasi; `hapus` = objek HARUS tidak ada.
 * @property {JenisPenanda} jenis
 * @property {string} kunci
 * @property {string} label
 * @property {string} [skema]
 * @property {string} [nama]
 * @property {string} [tabel]
 * @property {number} [arity]
 * @property {string} [tipe]
 * @property {string} [pub]
 * @property {'aktif'|'digantikan'} status
 * @property {string} [alasan] Mengapa `digantikan`.
 * @property {string} [digantikanOleh] Versi migrasi yang menggantikan.
 * @property {'kuat'|'lemah'|null} kekuatan Hanya untuk aksi `buat` yang aktif.
 * @property {string[]} dibagiDengan Versi migrasi lain yang juga membuat objek yang sama (alasan `lemah`).
 * @property {string} [catatan]
 * @property {string} [sidik] Sidik jari (badan ternormalisasi) fungsi ini menurut migrasi ini.
 * @property {{ versi: string, sidik: string }[]} [definisi] Semua definisi fungsi yang sama di seluruh migrasi (urut versi).
 */

/**
 * @typedef {object} HasilBerkas
 * @property {string} versi
 * @property {string} nama
 * @property {Penanda[]} penanda
 * @property {string[]} peringatan
 */

/**
 * Analisis lini masa SEMUA migrasi (termasuk yang sudah tercatat) agar tiap penanda tahu apakah digantikan migrasi
 * lebih baru dan seberapa kuat keberadaannya membuktikan migrasi tersebut.
 * @param {{ versi: string, nama: string, sql: string }[]} berkas
 * @returns {HasilBerkas[]} urut menurut versi
 */
export function analisisRiwayat(berkas) {
  const urut = [...berkas].sort((a, b) => (a.versi < b.versi ? -1 : a.versi > b.versi ? 1 : 0));
  const dasar = urut.map((b) => {
    const { peristiwa: ev, peringatan } = ekstrakPenanda(b.sql);
    /** @type {Map<string, Peristiwa & { hapusSebelum: boolean, buatSebelum: boolean }>} */
    const net = new Map();
    for (const e of ev) {
      const prev = net.get(e.kunci);
      net.set(e.kunci, {
        ...e,
        hapusSebelum: Boolean(prev && (prev.hapusSebelum || prev.aksi === 'hapus')),
        buatSebelum: Boolean(prev && (prev.buatSebelum || prev.aksi === 'buat')),
      });
    }
    return { ...b, net, peringatan };
  });

  /** @type {Map<string, { i: number, e: Peristiwa & { hapusSebelum: boolean, buatSebelum: boolean } }[]>} */
  const perKunci = new Map();
  dasar.forEach((b, i) => {
    for (const [kunci, e] of b.net) {
      const daftar = perKunci.get(kunci) ?? [];
      daftar.push({ i, e });
      perKunci.set(kunci, daftar);
    }
  });

  return dasar.map((b, i) => {
    /** @type {Penanda[]} */
    const penanda = [];
    for (const [kunci, e] of b.net) {
      if (e.implisit) continue; // hanya lini masa
      const riwayat = perKunci.get(kunci) ?? [];
      const akhir = riwayat[riwayat.length - 1];
      const lain = riwayat.filter((r) => r.i !== i);
      /** @type {Penanda} */
      const p = {
        aksi: e.aksi, jenis: e.jenis, kunci, label: e.label,
        skema: e.skema, nama: e.nama, tabel: e.tabel, arity: e.arity, tipe: e.tipe, pub: e.pub,
        status: 'aktif', kekuatan: null, dibagiDengan: [],
      };
      if (e.jenis === 'fungsi' && e.aksi === 'buat' && e.sidik) {
        p.sidik = e.sidik;
        p.definisi = riwayat.filter((r) => r.e.aksi === 'buat' && r.e.sidik).map((r) => ({ versi: dasar[r.i].versi, sidik: r.e.sidik }));
      }
      const gantikan = (alasan, idx) => {
        p.status = 'digantikan';
        p.alasan = alasan;
        if (idx !== undefined && idx !== i) p.digantikanOleh = dasar[idx].versi;
      };

      // tabel induk di-DROP oleh migrasi lebih baru => objek turunannya ikut hilang
      let indukHapusIdx;
      if (e.induk) {
        const rIn = perKunci.get(e.induk);
        const aIn = rIn?.[rIn.length - 1];
        if (aIn && aIn.i > i && aIn.e.aksi === 'hapus') indukHapusIdx = aIn.i;
      }

      if (e.aksi === 'buat') {
        if (e.jenis === 'tipe_kolom') {
          // tipe diubah lagi oleh migrasi lebih baru => nilai yang diharapkan sudah berbeda
          if (akhir.i > i && akhir.e.tipe !== e.tipe) gantikan(`tipe kolom diubah menjadi ${akhir.e.tipe} oleh migrasi lebih baru`, akhir.i);
          else if (indukHapusIdx !== undefined) gantikan('tabel induk di-DROP oleh migrasi lebih baru', indukHapusIdx);
          p.dibagiDengan = lain.filter((r) => r.e.aksi === 'buat' && r.e.tipe === e.tipe).map((r) => dasar[r.i].versi);
        } else if (akhir.i > i && akhir.e.aksi === 'hapus') {
          gantikan('di-DROP oleh migrasi lebih baru', akhir.i);
        } else if (indukHapusIdx !== undefined) {
          gantikan('tabel induk di-DROP oleh migrasi lebih baru', indukHapusIdx);
        }
        if (p.status === 'aktif') {
          if (e.jenis !== 'tipe_kolom') p.dibagiDengan = lain.filter((r) => r.e.aksi === 'buat').map((r) => dasar[r.i].versi);
          // Constraint yang pernah di-DROP tanpa pernah dibuat eksplisit biasanya bernama otomatis (mis. <tabel>_<kolom>_check)
          // dan SUDAH ADA sebelumnya: keberadaannya bukan bukti migrasi ini.
          let ragu = false;
          if (e.jenis === 'constraint') {
            ragu = e.hapusSebelum || lain.some((r) => r.i < i && r.e.aksi === 'hapus');
            if (ragu) p.catatan = 'nama constraint pernah di-DROP sebelum dibuat (kemungkinan nama otomatis yang sudah ada)';
          }
          p.kekuatan = p.dibagiDengan.length === 0 && !ragu ? 'kuat' : 'lemah';
        }
      } else if (e.buatSebelum) {
        gantikan('dibuat lalu di-DROP dalam migrasi yang sama');
      } else if (akhir.i > i && akhir.e.aksi === 'buat') {
        gantikan('dibuat ulang oleh migrasi lebih baru', akhir.i);
      } else {
        const pernahDibuat = riwayat.some((r) => r.i < i && r.e.aksi === 'buat');
        if (!pernahDibuat) p.catatan = 'objek tidak pernah dibuat di migrasi mana pun (DROP objek warisan); ketiadaannya bukan bukti';
      }
      penanda.push(p);
    }
    return { versi: b.versi, nama: b.nama, penanda, peringatan: b.peringatan };
  });
}

/**
 * Bandingkan isi fungsi di database (pg_proc.prosrc) dengan definisi di migrasi (sidik jari badan). Memberi bukti yang
 * lebih tajam daripada sekadar "fungsi ada" untuk fungsi yang didefinisikan ulang berkali-kali (CREATE OR REPLACE):
 *  - `sama_unik`   : isi DB identik dengan definisi migrasi ini dan tidak ada definisi lain yang berbadan sama => bukti kuat migrasi ini;
 *  - `sama_ambigu` : identik dengan migrasi ini DAN definisi lain berbadan sama => tidak membuktikan migrasi ini;
 *  - `lebih_lama`  : identik hanya dengan definisi dari migrasi LEBIH LAMA => versi migrasi ini belum diterapkan;
 *  - `lebih_baru`  : identik hanya dengan definisi dari migrasi LEBIH BARU => sudah ditimpa, tidak ada informasi tentang migrasi ini;
 *  - `tidak_cocok` : tidak identik dengan definisi mana pun (diubah manual / beda format) => tidak ada informasi;
 *  - `tanpa_sidik` : tidak ada badan yang dapat dibandingkan.
 * @param {{ sidik?: string, definisi?: { versi: string, sidik: string }[] }} p penanda fungsi (aksi buat, aktif)
 * @param {string} versi versi migrasi pemilik penanda
 * @param {string[]|undefined} badanDb daftar prosrc fungsi bernama+jumlah argumen sama di database
 * @returns {'sama_unik'|'sama_ambigu'|'lebih_lama'|'lebih_baru'|'tidak_cocok'|'tanpa_sidik'}
 */
export function nilaiIsiFungsi(p, versi, badanDb) {
  if (!p.sidik || !p.definisi?.length || !badanDb?.length) return 'tanpa_sidik';
  const db = new Set(badanDb.map(normalisasiBadan));
  const cocok = p.definisi.filter((d) => db.has(d.sidik));
  if (cocok.length === 0) return 'tidak_cocok';
  if (cocok.some((d) => d.versi === versi)) return cocok.length === 1 ? 'sama_unik' : 'sama_ambigu';
  return cocok[cocok.length - 1].versi < versi ? 'lebih_lama' : 'lebih_baru';
}

// ---------------------------------------------------------------------------------------------------------------
// 5. Penentu status
// ---------------------------------------------------------------------------------------------------------------

/**
 * @typedef {'terpasang'|'sebagian'|'tidak_ditemukan'|'tidak_dapat_ditentukan'} StatusMigrasi
 * @typedef {object} HasilPeriksa
 * @property {'buat'|'hapus'} aksi
 * @property {'aktif'|'digantikan'} status
 * @property {'kuat'|'lemah'|null} kekuatan
 * @property {boolean|null} ada Hasil pemeriksaan katalog (null = tidak dapat diperiksa).
 */

/**
 * Tentukan status satu migrasi dari hasil pemeriksaan katalog atas penanda-penandanya.
 *  - objek `buat` aktif yang HILANG adalah bukti tegas (objek hasil migrasi tidak ada);
 *  - objek `buat` aktif yang ADA baru bukti bila `kuat` (bukan objek bersama dengan migrasi lain);
 *  - objek `hapus` aktif yang MASIH ADA berarti DROP-nya belum terjadi; yang tidak ada tidak membuktikan apa pun.
 * @param {HasilPeriksa[]} hasil
 * @returns {{ status: StatusMigrasi, alasan: string }}
 */
export function tentukanStatus(hasil) {
  const aktif = hasil.filter((h) => h.status === 'aktif');
  const buat = aktif.filter((h) => h.aksi === 'buat');
  const hapus = aktif.filter((h) => h.aksi === 'hapus');
  const hilang = buat.filter((h) => h.ada === false);
  const takTahu = [...buat, ...hapus].filter((h) => h.ada === null);
  const kuatAda = buat.filter((h) => h.ada === true && h.kekuatan === 'kuat');
  const hapusBelum = hapus.filter((h) => h.ada === true);

  if (aktif.length === 0) {
    return { status: 'tidak_dapat_ditentukan', alasan: 'tidak ada penanda aktif (tanpa DDL terukur, atau seluruh penanda digantikan migrasi lain)' };
  }
  if (hilang.length > 0) {
    return kuatAda.length > 0
      ? { status: 'sebagian', alasan: `${hilang.length} dari ${buat.length} objek hasil migrasi tidak ada` }
      : { status: 'tidak_ditemukan', alasan: 'objek hasil migrasi tidak ada, dan tidak ada penanda kuat yang ditemukan' };
  }
  if (hapusBelum.length > 0) {
    return kuatAda.length > 0
      ? { status: 'sebagian', alasan: `${hapusBelum.length} objek yang seharusnya di-DROP masih ada` }
      : { status: 'tidak_ditemukan', alasan: 'objek yang seharusnya di-DROP masih ada dan tidak ada penanda kuat yang ditemukan' };
  }
  if (takTahu.length > 0) {
    return { status: 'tidak_dapat_ditentukan', alasan: `${takTahu.length} penanda tidak dapat diperiksa (akses katalog/skema)` };
  }
  if (kuatAda.length > 0) {
    return { status: 'terpasang', alasan: `${kuatAda.length} penanda kuat ada${buat.length > kuatAda.length ? `, ${buat.length - kuatAda.length} lainnya objek bersama (ada)` : ''}` };
  }
  return {
    status: 'tidak_dapat_ditentukan',
    alasan: buat.length > 0
      ? 'semua penanda yang ada adalah objek bersama dengan migrasi lain (ada, tetapi tidak membuktikan migrasi ini)'
      : 'hanya pemeriksaan DROP (objek sudah tidak ada) sehingga tidak membuktikan migrasi ini',
  };
}
