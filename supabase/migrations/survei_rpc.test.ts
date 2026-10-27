// @vitest-environment node
// Kontrak statis migrasi 202610270003_survei_rpc (survei terpadu Fase A, Task 4): dua RPC PUBLIK yang bisa dipanggil anon,
// get_survei_context (status undangan, tanpa identitas) dan kirim_survei (satu-satunya jalur tulis jawaban survei, atomik).
// Tidak mengeksekusi SQL dan tidak menyentuh database. Uji PERILAKU (urutan hasil, batas kedaluwarsa, kiriman ganda, payload
// nakal, atomik, hak): scripts/lokal/skenario-survei-rpc.mjs (PGlite lokal). Penyerialan oleh SELECT ... FOR UPDATE tidak bisa
// dibuktikan di PGlite (satu sesi), jadi dijaga DI SINI lewat urutan teks fungsi. Rollback: docs/rollback-survei-rpc-202610270003.sql.
// Kecocokan rentang CHECK dengan src/lib/survei/pertanyaan.ts ditambahkan di Task 6 (ruling R2).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi, mengubahPolicyAtauFungsi } from '../../scripts/lib/sql-txn.mjs';
import { pecahPernyataan } from '../../scripts/lib/migration-markers.mjs';

const BERKAS = '202610270003_survei_rpc.sql';
const BERKAS_UNDANGAN = '202610270001_survei_undangan.sql';
const BERKAS_JAWABAN = '202610270002_survei_jawaban.sql';
const BERKAS_ROLLBACK = 'rollback-survei-rpc-202610270003.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8').replace(/\r\n/g, '\n');
const bacaDocs = (...bagian: string[]) => readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', ...bagian), 'utf8').replace(/\r\n/g, '\n');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

const raw = baca(BERKAS);
const sql = stripSqlComments(raw);
const pernyataan = pecahPernyataan(sql).map(rapikan);
const rollbackRaw = bacaDocs(BERKAS_ROLLBACK);
const rollback = stripSqlComments(rollbackRaw);
const pernyataanRollback = pecahPernyataan(rollback).map(rapikan);

/** Definisi lengkap `CREATE [OR REPLACE] FUNCTION public.<nama>(...) ... $$;` dari SQL bebas komentar. */
function ambilFungsi(teks: string, nama: string): string {
  const hasil = [...teks.matchAll(new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${nama}\s*\([\s\S]*?\$\$;`, 'gi'))].map((m) => m[0]);
  if (hasil.length !== 1) throw new Error(`fungsi ${nama}: ${hasil.length} definisi`);
  return hasil[0];
}
const badan = (def: string) => def.slice(def.indexOf('$$') + 2, def.lastIndexOf('$$'));

const KONTEKS = ambilFungsi(sql, 'get_survei_context');
const KIRIM = ambilFungsi(sql, 'kirim_survei');
const B_KONTEKS = badan(KONTEKS);
const B_KIRIM = badan(KIRIM);
const FUNGSI = { get_survei_context: KONTEKS, kirim_survei: KIRIM };

const KUNCI_SPAK = ['p1', 'p2', 'p3', 'p4', 'p5'];
const KUNCI_SKM = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10', 'u11'];
const KOLOM_SPAK = ['p1_tanpa_diskriminasi', 'p2_tanpa_kecurangan', 'p3_tanpa_imbalan', 'p4_tanpa_pungli', 'p5_tanpa_percaloan'];
const KOLOM_SKM = ['u1_persyaratan', 'u2_prosedur', 'u3_waktu', 'u4_biaya', 'u5_produk', 'u6_kompetensi', 'u7_perilaku', 'u8_sarana', 'u9_pengaduan', 'u10_transparansi', 'u11_integritas'];
const HASIL_KIRIM = ['submitted', 'invalid', 'expired', 'duplicate', 'not_found'];

/** Daftar ARRAY['a', 'b', ...] pertama yang kunci pertamanya `awal`. */
function ambilArray(teks: string, awal: string): string[] {
  const m = teks.match(new RegExp(String.raw`ARRAY\[\s*'${awal}'([^\]]*)\]`));
  if (!m) throw new Error(`ARRAY berawal ${awal} tidak ditemukan`);
  return [awal, ...[...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])];
}

/** Pisahkan argumen tingkat-atas yang dipisah koma (tanpa memecah tanda kurung atau kutip). */
function pisahArgumen(s: string): string[] {
  const hasil: string[] = [];
  let kedalaman = 0;
  let dalamKutip = false;
  let cur = '';
  for (const c of s) {
    if (c === "'") dalamKutip = !dalamKutip;
    if (!dalamKutip && (c === '(' || c === '[')) kedalaman += 1;
    if (!dalamKutip && (c === ')' || c === ']')) kedalaman -= 1;
    if (!dalamKutip && kedalaman === 0 && c === ',') {
      hasil.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) hasil.push(cur.trim());
  return hasil;
}

/** Isi tanda kurung pertama yang seimbang setelah `awal`. */
function kurungSetelah(teks: string, awal: string): string {
  const i = teks.indexOf(awal);
  if (i < 0) throw new Error(`tidak ditemukan: ${awal}`);
  let j = teks.indexOf('(', i + awal.length - 1);
  const mulai = j + 1;
  let kedalaman = 0;
  let dalamKutip = false;
  for (; j < teks.length; j += 1) {
    const c = teks[j];
    if (c === "'") dalamKutip = !dalamKutip;
    if (dalamKutip) continue;
    if (c === '(') kedalaman += 1;
    if (c === ')') {
      kedalaman -= 1;
      if (kedalaman === 0) return teks.slice(mulai, j);
    }
  }
  throw new Error(`kurung tidak seimbang setelah: ${awal}`);
}

/** Pasangan kolom -> ekspresi nilai dari `INSERT INTO <tabel> (kolom...) VALUES (nilai...)`. */
function sisipan(tabel: string): Array<[string, string]> {
  const stmt = B_KIRIM.match(new RegExp(String.raw`INSERT\s+INTO\s+public\.${tabel}\s*\([\s\S]*?\)\s*VALUES\s*\([\s\S]*?\)\s*;`, 'i'));
  if (!stmt) throw new Error(`INSERT ${tabel} tidak ditemukan`);
  const kolom = pisahArgumen(kurungSetelah(stmt[0], `INSERT INTO public.${tabel} (`));
  const nilaiTeks = pisahArgumen(kurungSetelah(stmt[0].slice(stmt[0].search(/VALUES/i)), 'VALUES ('));
  expect(nilaiTeks).toHaveLength(kolom.length);
  return kolom.map((k, i) => [k, rapikan(nilaiTeks[i])]);
}

describe('survei_rpc: berkas, urutan, atomik, aditif', () => {
  it('terdaftar di FORWARD_MIGRATION_FILES tepat setelah migrasi jawaban, nomor di atas semua migrasi di luar seri', () => {
    expect(BERKAS).toMatch(/^\d{12}_[a-z0-9_]+\.sql$/);
    expect(FORWARD_MIGRATION_FILES).toContain(BERKAS);
    expect(listMigrationFiles()).toContain(BERKAS);
    const daftar = [...FORWARD_MIGRATION_FILES];
    expect(daftar).toEqual([...daftar].sort());
    expect(daftar.indexOf(BERKAS)).toBe(daftar.indexOf(BERKAS_JAWABAN) + 1);
    const luarSeri = listMigrationFiles().filter((nama) => !/^2026102700\d\d_/.test(nama));
    for (const nama of luarSeri) expect(nama < BERKAS).toBe(true);
    expect(BERKAS > '202610260001').toBe(true);
  });

  it('tanpa BEGIN/COMMIT (berkas maupun rollback) dan terdeteksi sebagai perubahan fungsi (wajib --atomic)', () => {
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rollbackRaw)).toBe(false);
    expect(mengubahPolicyAtauFungsi(raw)).toBe(true);
    expect(mengubahPolicyAtauFungsi(rollbackRaw)).toBe(true);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202610270003_survei_rpc\.sql --atomic --dry-run/);
    expect(raw).toMatch(/apply-migration\.mjs supabase\/migrations\/202610270003_survei_rpc\.sql --atomic\s*$/m);
    expect(raw).toContain('docs/rollback-survei-rpc-202610270003.sql');
    expect(rollbackRaw).toMatch(/apply-migration\.mjs docs\/rollback-survei-rpc-202610270003\.sql --atomic --dry-run/);
  });

  it('aditif: hanya fungsi baru (DO penjaga, CREATE OR REPLACE FUNCTION, REVOKE, GRANT, COMMENT); tanpa tabel, kolom, policy, trigger, view, DROP, atau DML tingkat-atas', () => {
    const jenis = pernyataan.map((p) => p.match(/^(DO|CREATE OR REPLACE FUNCTION|REVOKE|GRANT|COMMENT ON FUNCTION)\b/)?.[1]);
    expect(jenis.every((j) => j !== undefined)).toBe(true);
    expect(sql).not.toMatch(/\bDROP\b|\bALTER\b|\bTRUNCATE\b|\bCASCADE\b|\bCREATE\s+(?:TABLE|VIEW|TRIGGER|POLICY|INDEX|SEQUENCE)\b/i);
    expect(pernyataan.filter((p) => /^(INSERT|UPDATE|DELETE)\b/i.test(p))).toEqual([]);
  });

  it('TEPAT dua fungsi baru: get_survei_context(text) dan kirim_survei(text, jsonb, jsonb)', () => {
    const nama = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(public\.\w+)\s*\(([^)]*)\)/gi)].map((m) => `${m[1]}(${rapikan(m[2])})`);
    expect(nama).toEqual(['public.get_survei_context(p_token text)', 'public.kirim_survei(p_token text, p_spak jsonb, p_skm jsonb)']);
  });

  it('prasyarat dijaga lebih dulu dengan pesan PRASYARAT (undangan, spak_respons, kolom skm 11 unsur, constraint wizard)', () => {
    const awal = raw.indexOf('DO $$');
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(raw.indexOf('CREATE OR REPLACE FUNCTION'));
    const guard = raw.slice(awal, raw.indexOf('END $$', awal));
    expect(guard).toMatch(/to_regclass\('public\.survei_undangan'\)/);
    expect(guard).toMatch(/to_regclass\('public\.spak_respons'\)/);
    expect(guard).toMatch(/to_regclass\('public\.skm_respons'\)/);
    expect(guard).toMatch(/to_regclass\('public\.layanan'\)/);
    expect(guard).toMatch(/to_regclass\('public\.kunjungan'\)/);
    expect(guard).toMatch(/skm_respons_wizard_kunjungan_versi_check/);
    // Semua kolom yang ditulis fungsi baru dicek keberadaannya oleh penjaga (kolom 0002).
    for (const kolom of ['u10_transparansi', 'u11_integritas', 'versi', 'sumber', 'p1_tanpa_diskriminasi', 'p5_tanpa_percaloan']) expect(guard, kolom).toContain(kolom);
    expect(guard.match(/RAISE EXCEPTION 'PRASYARAT:/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it('objek yang dikonsumsi didefinisikan migrasi sebelumnya; kedua fungsi baru belum ada di migrasi lain', () => {
    const lama = listMigrationFiles().filter((nama) => nama < BERKAS);
    const semuaLama = lama.map((nama) => stripSqlComments(baca(nama))).join('\n');
    // Kolom yang dibaca/ditulis fungsi baru memang ada di definisi tabelnya (bukan sekadar muncul di teks lain).
    const tabelUndangan = semuaLama.match(/CREATE TABLE IF NOT EXISTS public\.survei_undangan \(([\s\S]*?)\n\);/)?.[1] ?? '';
    const tabelSpak = semuaLama.match(/CREATE TABLE IF NOT EXISTS public\.spak_respons \(([\s\S]*?)\n\);/)?.[1] ?? '';
    for (const kolom of ['id', 'kunjungan_id', 'token', 'layanan_id', 'unit', 'kedaluwarsa_pada', 'diisi_pada']) expect(tabelUndangan, `survei_undangan.${kolom}`).toMatch(new RegExp(String.raw`^\s*${kolom}\s`, 'm'));
    for (const kolom of ['kunjungan_id', 'layanan_id', 'unit', 'sumber', ...KOLOM_SPAK]) expect(tabelSpak, `spak_respons.${kolom}`).toMatch(new RegExp(String.raw`^\s*${kolom}\s`, 'm'));
    for (const kolom of ['u10_transparansi', 'u11_integritas', 'versi', 'sumber', 'unit']) expect(semuaLama, `skm_respons.${kolom}`).toMatch(new RegExp(String.raw`ADD COLUMN IF NOT EXISTS ${kolom}\s`));
    expect(semuaLama).toMatch(/ADD CONSTRAINT\s+skm_respons_wizard_kunjungan_versi_check/);
    expect(semuaLama).toMatch(/CREATE TABLE IF NOT EXISTS public\.layanan|CREATE TABLE public\.layanan/);
    expect(semuaLama).not.toMatch(/\bkirim_survei\b|\bget_survei_context\b/);
    // Hanya BERKAS ini yang mendefinisikan keduanya.
    const pendefinisi = listMigrationFiles().filter((nama) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(?:kirim_survei|get_survei_context)\b/i.test(stripSqlComments(baca(nama))));
    expect(pendefinisi).toEqual([BERKAS]);
  });
});

describe('survei_rpc: SECURITY DEFINER, search_path, hak EXECUTE', () => {
  it('jumlah SECURITY DEFINER = jumlah CREATE FUNCTION = 2, semuanya search_path tetap, dan keduanya VOLATILE', () => {
    const buat = sql.match(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi) ?? [];
    const definer = sql.match(/\bSECURITY DEFINER\b/gi) ?? [];
    expect(buat).toHaveLength(2);
    expect(definer).toHaveLength(buat.length);
    expect(sql.match(/SET search_path = pg_catalog, public/gi)).toHaveLength(buat.length);
    for (const [nama, def] of Object.entries(FUNGSI)) {
      expect(def, nama).toMatch(/\bSECURITY DEFINER\b/i);
      expect(def, nama).toMatch(/SET search_path = pg_catalog, public/i);
      expect(def, nama).toMatch(/\bLANGUAGE plpgsql\b/i);
      // VOLATILE disengaja: PostgREST hanya mengekspos fungsi STABLE/IMMUTABLE lewat GET (token masuk URL/log akses).
      expect(def.slice(0, def.indexOf('$$')), nama).toMatch(/\bVOLATILE\b/);
      expect(def.slice(0, def.indexOf('$$')), nama).not.toMatch(/\b(?:STABLE|IMMUTABLE)\b/);
    }
  });

  it('EXECUTE persis: hanya anon dan authenticated (bukan PUBLIC), REVOKE dari PUBLIC/anon/authenticated mendahului GRANT', () => {
    const grants = pernyataan.filter((p) => /^GRANT\b/i.test(p)).sort();
    expect(grants).toEqual(
      [
        'GRANT EXECUTE ON FUNCTION public.get_survei_context(text) TO anon, authenticated',
        'GRANT EXECUTE ON FUNCTION public.kirim_survei(text, jsonb, jsonb) TO anon, authenticated',
      ].sort(),
    );
    const revoke = pernyataan.filter((p) => /^REVOKE\b/i.test(p)).sort();
    expect(revoke).toEqual(
      [
        'REVOKE ALL ON FUNCTION public.get_survei_context(text) FROM PUBLIC, anon, authenticated',
        'REVOKE ALL ON FUNCTION public.kirim_survei(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated',
      ].sort(),
    );
    for (const g of pernyataan.filter((p) => /^GRANT\b/i.test(p))) {
      const fungsi = g.match(/ON FUNCTION (\S+\([^)]*\))/)![1];
      const iRevoke = pernyataan.findIndex((p) => /^REVOKE\b/i.test(p) && p.includes(fungsi));
      expect(iRevoke, g).toBeGreaterThanOrEqual(0);
      expect(iRevoke, g).toBeLessThan(pernyataan.indexOf(g));
    }
    expect(sql).not.toMatch(/\bTO\s+PUBLIC\b|\bTO\s+service_role\b/i);
  });

  it('semua fungsi bawaan dikualifikasi pg_catalog (tidak bisa dibajak lewat search_path)', () => {
    const tanpaKualifikasi = /(?<![.\w])(now|jsonb_typeof|jsonb_object_keys|jsonb_build_object|count|trunc|length|cardinality|to_regclass|to_regprocedure|string_agg)\s*\(/gi;
    for (const [nama, def] of Object.entries(FUNGSI)) expect([...badan(def).matchAll(tanpaKualifikasi)].map((m) => m[0]), nama).toEqual([]);
  });

  it('jam hanya dari database: tidak ada parameter waktu, now() bertransaksi, tanpa clock_timestamp/CURRENT_*', () => {
    for (const [nama, def] of Object.entries(FUNGSI)) {
      const tanda = def.slice(0, def.indexOf(')'));
      expect(tanda, nama).not.toMatch(/\b(?:timestamp|timestamptz|date|time|interval)\b/i);
      expect(badan(def), nama).not.toMatch(/\b(?:clock_timestamp|statement_timestamp|transaction_timestamp|current_timestamp|current_date|localtimestamp)\b/i);
    }
    expect(B_KONTEKS).toMatch(/pg_catalog\.now\(\)/);
    expect(B_KIRIM).toMatch(/pg_catalog\.now\(\)/);
  });

  it('jalur kegagalan yang diharapkan mengembalikan nilai, TIDAK ada RAISE sama sekali (tidak membuat galat 4xx/5xx dari data pengguna)', () => {
    for (const [nama, def] of Object.entries(FUNGSI)) expect(badan(def), nama).not.toMatch(/\bRAISE\b/i);
  });
});

describe('survei_rpc: get_survei_context', () => {
  it('signature (p_token text) RETURNS jsonb, hanya MEMBACA (tanpa INSERT/UPDATE/DELETE/kunci)', () => {
    expect(rapikan(KONTEKS)).toMatch(/^CREATE OR REPLACE FUNCTION public\.get_survei_context\(p_token text\) RETURNS jsonb /);
    expect(B_KONTEKS).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b|\bFOR\s+(?:UPDATE|SHARE)\b/i);
  });

  it('urutan hasil: tidak ada baris -> tidak_valid; diisi_pada -> sudah_diisi; sudah lewat batas -> kedaluwarsa; selain itu ok', () => {
    const iNol = B_KONTEKS.indexOf("'tidak_valid'");
    const iDiisi = B_KONTEKS.indexOf("'sudah_diisi'");
    const iLewat = B_KONTEKS.indexOf("'kedaluwarsa'");
    const iOk = B_KONTEKS.indexOf("'ok'");
    for (const i of [iNol, iDiisi, iLewat, iOk]) expect(i).toBeGreaterThanOrEqual(0);
    expect(iNol).toBeLessThan(iDiisi);
    expect(iDiisi).toBeLessThan(iLewat);
    expect(iLewat).toBeLessThan(iOk);
    expect(B_KONTEKS).toMatch(/IF NOT FOUND THEN\s+RETURN pg_catalog\.jsonb_build_object\(\s*'status', 'tidak_valid'/);
    expect(rapikan(B_KONTEKS)).toMatch(/CASE WHEN v_u\.diisi_pada IS NOT NULL THEN 'sudah_diisi' WHEN pg_catalog\.now\(\) >= v_u\.kedaluwarsa_pada THEN 'kedaluwarsa' ELSE 'ok' END/);
  });

  it('R8: batas tepat sudah kedaluwarsa (now() >= kedaluwarsa_pada), sama dengan ambil_qr_survei (0001) dan kirim_survei', () => {
    expect(B_KONTEKS).toMatch(/pg_catalog\.now\(\)\s*>=\s*v_u\.kedaluwarsa_pada/);
    expect(B_KIRIM).toMatch(/pg_catalog\.now\(\)\s*>=\s*v_u\.kedaluwarsa_pada/);
    for (const b of [B_KONTEKS, B_KIRIM]) expect(b).not.toMatch(/now\(\)\s*>(?!=)/);
    const qr = badan(ambilFungsi(stripSqlComments(baca(BERKAS_UNDANGAN)), 'ambil_qr_survei'));
    expect(qr).toMatch(/pg_catalog\.now\(\)\s*>=\s*v_u\.kedaluwarsa_pada/);
  });

  it('hanya membuka {status, unit, layanan_nama, kedaluwarsa_pada}: tanpa id kunjungan/undangan/layanan, token, atau identitas pengunjung', () => {
    const panggilan = [...B_KONTEKS.matchAll(/jsonb_build_object\(/g)].map((m) => kurungSetelah(B_KONTEKS.slice(m.index), 'jsonb_build_object('));
    expect(panggilan).toHaveLength(2); // satu untuk token tak dikenal, satu untuk undangan yang ada
    for (const isi of panggilan) {
      const arg = pisahArgumen(isi);
      const kunci = arg.filter((_, i) => i % 2 === 0).map((k) => k.replace(/'/g, ''));
      expect(kunci).toEqual(['status', 'unit', 'layanan_nama', 'kedaluwarsa_pada']);
      expect(isi).not.toMatch(/kunjungan_id|\bv_u\.id\b|\btoken\b|\bv_u\.layanan_id\b/i);
    }
    // Pada token tak dikenal semua nilai NULL kecuali status.
    expect(panggilan[0]).toMatch(/'unit', NULL::text,\s*'layanan_nama', NULL::text,\s*'kedaluwarsa_pada', NULL::timestamptz/);
    // Sumber identitas tidak disentuh sama sekali.
    expect(B_KONTEKS).not.toMatch(/\bpublic\.kunjungan\b|\bpengunjung\b|\bkontak_hp\b|\bemail\b|\bqr_token\b/i);
    // Satu-satunya tabel yang dibaca: undangan dan layanan (nama label unit).
    expect([...B_KONTEKS.matchAll(/\bFROM\s+(public\.\w+)/gi)].map((m) => m[1]).sort()).toEqual(['public.layanan', 'public.survei_undangan']);
  });

  it('pencarian memakai token persis (WHERE u.token = p_token) dan tanpa pengecualian untuk NULL (NULL -> tidak ada baris -> tidak_valid)', () => {
    expect(rapikan(B_KONTEKS)).toMatch(/SELECT \* INTO v_u FROM public\.survei_undangan AS u WHERE u\.token = p_token;/);
  });
});

describe('survei_rpc: kirim_survei (validasi, urutan, atomik)', () => {
  it('signature (p_token text, p_spak jsonb, p_skm jsonb) RETURNS text', () => {
    expect(rapikan(KIRIM)).toMatch(/^CREATE OR REPLACE FUNCTION public\.kirim_survei\(p_token text, p_spak jsonb, p_skm jsonb\) RETURNS text /);
  });

  it('hasil hanya submitted|invalid|expired|duplicate|not_found; submitted hanya satu kali dan menjadi RETURN terakhir', () => {
    const literal = [...B_KIRIM.matchAll(/RETURN\s+'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(literal)].sort()).toEqual([...HASIL_KIRIM].sort());
    expect(literal.filter((h) => h === 'submitted')).toHaveLength(1);
    expect(literal[literal.length - 1]).toBe('submitted');
    // Tidak ada RETURN lain (mis. RETURN NULL atau ekspresi) yang bisa lolos sebagai hasil di luar lima nilai.
    expect([...B_KIRIM.matchAll(/\bRETURN\b/g)]).toHaveLength(literal.length);
  });

  it('URUTAN: validasi payload -> kunci undangan (FOR UPDATE) -> not_found -> duplicate (diisi_pada) -> expired -> status kunjungan -> INSERT spak -> INSERT skm -> UPDATE diisi_pada -> duplicate (unik) -> submitted', () => {
    const urut = [
      ['validasi: invalid', B_KIRIM.indexOf("RETURN 'invalid'")],
      ['FOR UPDATE', B_KIRIM.search(/\bFOR UPDATE\b/)],
      ['not_found', B_KIRIM.indexOf("RETURN 'not_found'")],
      ['diisi_pada terisi', B_KIRIM.search(/v_u\.diisi_pada IS NOT NULL/)],
      ['duplicate (diisi_pada)', B_KIRIM.indexOf("RETURN 'duplicate'")],
      ['expired (cek)', B_KIRIM.search(/pg_catalog\.now\(\) >= v_u\.kedaluwarsa_pada/)],
      ['expired', B_KIRIM.indexOf("RETURN 'expired'")],
      ['status kunjungan', B_KIRIM.search(/v_status IS DISTINCT FROM 'selesai'/)],
      ['INSERT spak', B_KIRIM.search(/INSERT INTO public\.spak_respons/)],
      ['INSERT skm', B_KIRIM.search(/INSERT INTO public\.skm_respons/)],
      ['UPDATE diisi_pada', B_KIRIM.search(/UPDATE public\.survei_undangan/)],
      ['EXCEPTION unique_violation', B_KIRIM.search(/EXCEPTION\s+WHEN unique_violation THEN/)],
      ['duplicate (unik)', B_KIRIM.lastIndexOf("RETURN 'duplicate'")],
      ['submitted', B_KIRIM.indexOf("RETURN 'submitted'")],
    ] as const;
    for (const [nama, i] of urut) expect(i, nama).toBeGreaterThanOrEqual(0);
    for (let k = 1; k < urut.length; k += 1) expect(urut[k][1], `${urut[k - 1][0]} < ${urut[k][0]}`).toBeGreaterThan(urut[k - 1][1]);
    // RETURN 'duplicate' muncul tepat dua kali: pemeriksaan diisi_pada dan handler unique_violation.
    expect([...B_KIRIM.matchAll(/RETURN 'duplicate'/g)]).toHaveLength(2);
  });

  it('FOR UPDATE pada undangan berdasarkan token persis, SEBELUM pemeriksaan diisi_pada (penyerialan ketukan ganda/kiriman bersamaan)', () => {
    expect(rapikan(B_KIRIM)).toMatch(/SELECT \* INTO v_u FROM public\.survei_undangan AS u WHERE u\.token = p_token FOR UPDATE;/);
    expect([...B_KIRIM.matchAll(/FROM public\.survei_undangan/g)]).toHaveLength(1); // tidak ada pembacaan undangan tanpa kunci
  });

  it('validasi payload: token >= 16 karakter, kedua payload objek JSON, kunci PERSIS p1..p5 dan u1..u11 (tanpa kurang/lebih)', () => {
    const iKunci = B_KIRIM.indexOf('CONSTANT text[]');
    expect(iKunci).toBeGreaterThanOrEqual(0);
    expect(ambilArray(B_KIRIM, 'p1')).toEqual(KUNCI_SPAK);
    expect(ambilArray(B_KIRIM, 'u1')).toEqual(KUNCI_SKM);
    const guardAwal = rapikan(B_KIRIM.slice(B_KIRIM.indexOf('BEGIN'), B_KIRIM.indexOf("RETURN 'invalid'")));
    expect(guardAwal).toMatch(/p_token IS NULL OR pg_catalog\.length\(p_token\) < 16/);
    expect(guardAwal).toMatch(/p_spak IS NULL OR pg_catalog\.jsonb_typeof\(p_spak\) IS DISTINCT FROM 'object'/);
    expect(guardAwal).toMatch(/p_skm IS NULL OR pg_catalog\.jsonb_typeof\(p_skm\) IS DISTINCT FROM 'object'/);
    // Jumlah kunci aktual = jumlah kunci yang diharapkan (jadi kunci asing menggagalkan), dan tiap kunci yang diharapkan wajib ada.
    const ringkas = rapikan(B_KIRIM);
    expect(ringkas).toMatch(/\(SELECT pg_catalog\.count\(\*\) FROM pg_catalog\.jsonb_object_keys\(p_spak\)\) <> pg_catalog\.cardinality\(c_kunci_spak\)/);
    expect(ringkas).toMatch(/\(SELECT pg_catalog\.count\(\*\) FROM pg_catalog\.jsonb_object_keys\(p_skm\)\) <> pg_catalog\.cardinality\(c_kunci_skm\)/);
    expect(ringkas).toMatch(/FOREACH v_kunci IN ARRAY c_kunci_spak LOOP/);
    expect(ringkas).toMatch(/FOREACH v_kunci IN ARRAY c_kunci_skm LOOP/);
  });

  it('nilai: jsonb_typeof = number, bilangan bulat (trunc), SPAK 1-6 dan SKM 1-4 sama dengan CHECK tabel di migrasi 0002 dan baseline', () => {
    const ringkas = rapikan(B_KIRIM);
    // Tiap perulangan: tipe number (kunci hilang -> NULL -> ditolak), lalu bilangan bulat, lalu rentang; semuanya 'invalid'.
    for (const [payload, min, maks] of [['p_spak', 'c_spak_min', 'c_spak_maks'], ['p_skm', 'c_skm_min', 'c_skm_maks']] as const) {
      const loop = ringkas.match(new RegExp(`FOREACH v_kunci IN ARRAY c_kunci_${payload.slice(2)} LOOP (.*?) END LOOP;`))![1];
      expect(loop, payload).toContain(`IF pg_catalog.jsonb_typeof(${payload} -> v_kunci) IS DISTINCT FROM 'number' THEN RETURN 'invalid'; END IF;`);
      expect(loop, payload).toContain(`v_angka := (${payload} ->> v_kunci)::numeric;`);
      expect(loop, payload).toContain(`IF v_angka <> pg_catalog.trunc(v_angka) OR v_angka < ${min} OR v_angka > ${maks} THEN RETURN 'invalid'; END IF;`);
    }
    const konstanta = (nama: string) => Number(B_KIRIM.match(new RegExp(String.raw`${nama}\s+CONSTANT numeric := (\d+);`))?.[1]);
    const jawaban = stripSqlComments(baca(BERKAS_JAWABAN));
    const dasar = stripSqlComments(baca('202607140003_feature_schema.sql'));
    const rentang = (teks: string, kolom: string) => {
      const m = teks.match(new RegExp(String.raw`\b${kolom}\s+smallint[^,\n]*CHECK\s*\(\s*${kolom}\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)\s*\)`));
      if (!m) throw new Error(`CHECK ${kolom} tidak ditemukan`);
      return [Number(m[1]), Number(m[2])];
    };
    for (const kolom of KOLOM_SPAK) expect(rentang(jawaban, kolom), kolom).toEqual([konstanta('c_spak_min'), konstanta('c_spak_maks')]);
    for (const kolom of KOLOM_SKM.slice(0, 9)) expect(rentang(dasar, kolom), kolom).toEqual([konstanta('c_skm_min'), konstanta('c_skm_maks')]);
    for (const kolom of KOLOM_SKM.slice(9)) expect(rentang(jawaban, kolom), kolom).toEqual([konstanta('c_skm_min'), konstanta('c_skm_maks')]);
    expect([konstanta('c_spak_min'), konstanta('c_spak_maks'), konstanta('c_skm_min'), konstanta('c_skm_maks')]).toEqual([1, 6, 1, 4]);
  });

  it('konversi ke smallint HANYA setelah semua validasi (lewat numeric, jadi 3.0 dan 1e0 sah tanpa galat cast), dan validasi tidak memakai cast yang bisa melempar galat', () => {
    const iCast = B_KIRIM.search(/::numeric\)::smallint/);
    const iInvalidTerakhir = B_KIRIM.lastIndexOf("RETURN 'invalid'");
    expect(iCast).toBeGreaterThan(iInvalidTerakhir);
    expect(B_KIRIM).not.toMatch(/::smallint\b(?<!\)::smallint)/); // setiap ::smallint didahului ::numeric)
    expect(B_KIRIM).not.toMatch(/::(?:int|integer|bigint)\b/i);
    // Cast ke numeric di validasi hanya terjadi sesudah jsonb_typeof memastikan tipe number (urutan dalam perulangan).
    for (const payload of ['p_spak', 'p_skm']) {
      const teksLoop = rapikan(B_KIRIM);
      expect(teksLoop.indexOf(`jsonb_typeof(${payload} -> v_kunci)`)).toBeLessThan(teksLoop.indexOf(`(${payload} ->> v_kunci)::numeric`));
    }
  });

  it('pemetaan kolom: p1..p5 -> spak_respons.p1_tanpa_diskriminasi..p5_tanpa_percaloan, u1..u11 -> skm_respons.u1_persyaratan..u11_integritas, sesuai nama kunci (bukan urutan masuk)', () => {
    const spak = sisipan('spak_respons');
    const skm = sisipan('skm_respons');
    expect(spak.slice(0, 4).map(([k]) => k)).toEqual(['kunjungan_id', 'layanan_id', 'unit', 'sumber']);
    expect(spak.slice(4).map(([k]) => k)).toEqual(KOLOM_SPAK);
    expect(skm.slice(0, 5).map(([k]) => k)).toEqual(['kunjungan_id', 'layanan_id', 'unit', 'sumber', 'versi']);
    expect(skm.slice(5).map(([k]) => k)).toEqual(KOLOM_SKM);
    spak.slice(4).forEach(([kolom, nilai], i) => expect(nilai, kolom).toBe(`((p_spak ->> '${KUNCI_SPAK[i]}')::numeric)::smallint`));
    skm.slice(5).forEach(([kolom, nilai], i) => expect(nilai, kolom).toBe(`((p_skm ->> '${KUNCI_SKM[i]}')::numeric)::smallint`));
    // Kolom bertujuan: persis kolom yang ada di migrasi 0002/baseline (tidak ada kolom baru yang salah ketik).
    const jawaban = stripSqlComments(baca(BERKAS_JAWABAN));
    for (const kolom of [...KOLOM_SPAK, 'u10_transparansi', 'u11_integritas']) expect(jawaban, kolom).toContain(kolom);
  });

  it('nilai tetap dari undangan dan konstanta: kunjungan_id/layanan_id/unit dari v_u, sumber wizard, SKM versi 2; tanpa identitas, saran, atau visit_id', () => {
    for (const tabel of ['spak_respons', 'skm_respons']) {
      const isi = Object.fromEntries(sisipan(tabel));
      expect(isi.kunjungan_id).toBe('v_u.kunjungan_id');
      expect(isi.layanan_id).toBe('v_u.layanan_id');
      expect(isi.unit).toBe('v_u.unit');
      expect(isi.sumber).toBe("'wizard'");
    }
    expect(Object.fromEntries(sisipan('skm_respons')).versi).toBe('2');
    for (const kolom of ['saran', 'visit_id', 'jenis_kelamin', 'pendidikan', 'created_at']) {
      expect(sisipan('spak_respons').map(([k]) => k)).not.toContain(kolom);
      expect(sisipan('skm_respons').map(([k]) => k)).not.toContain(kolom);
    }
  });

  it('kedaluwarsa dan status kunjungan: now() >= kedaluwarsa_pada -> expired; kunjungan bukan selesai (atau hilang) -> invalid', () => {
    expect(rapikan(B_KIRIM)).toMatch(/IF pg_catalog\.now\(\) >= v_u\.kedaluwarsa_pada THEN RETURN 'expired'; END IF;/);
    expect(rapikan(B_KIRIM)).toMatch(/SELECT k\.status INTO v_status FROM public\.kunjungan AS k WHERE k\.id = v_u\.kunjungan_id;/);
    expect(rapikan(B_KIRIM)).toMatch(/IF NOT FOUND OR v_status IS DISTINCT FROM 'selesai' THEN RETURN 'invalid'; END IF;/);
    expect(rapikan(B_KIRIM)).toMatch(/IF v_u\.diisi_pada IS NOT NULL THEN RETURN 'duplicate'; END IF;/);
  });

  it('ATOMIK: kedua INSERT dan UPDATE diisi_pada berada dalam SATU blok BEGIN ... EXCEPTION WHEN unique_violation; tidak ada WHEN OTHERS, COMMIT, ROLLBACK, atau SAVEPOINT', () => {
    expect([...B_KIRIM.matchAll(/\bEXCEPTION\b/g)]).toHaveLength(1);
    expect(B_KIRIM).toMatch(/EXCEPTION\s+WHEN unique_violation THEN\s+RETURN 'duplicate';\s+END;/);
    expect(B_KIRIM).not.toMatch(/\bWHEN\s+OTHERS\b|\bCOMMIT\b|\bROLLBACK\b|\bSAVEPOINT\b/i);
    const iBlokAwal = B_KIRIM.lastIndexOf('BEGIN', B_KIRIM.search(/INSERT INTO public\.spak_respons/));
    const iBlokAkhir = B_KIRIM.search(/EXCEPTION\s+WHEN unique_violation/);
    const blok = B_KIRIM.slice(iBlokAwal, iBlokAkhir);
    expect(blok.match(/\bINSERT INTO public\.(\w+)/g)).toEqual(['INSERT INTO public.spak_respons', 'INSERT INTO public.skm_respons']);
    expect(blok).toMatch(/UPDATE public\.survei_undangan\s+SET diisi_pada = pg_catalog\.now\(\)\s+WHERE id = v_u\.id;/);
    // Tidak ada tulis di luar blok itu, dan blok itu dimulai SETELAH semua pemeriksaan (tidak ada RETURN selain di handler).
    const sebelumBlok = B_KIRIM.slice(0, iBlokAwal).replace(/\bFOR UPDATE\b/g, '');
    expect(sebelumBlok).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expect(blok).not.toMatch(/\bRETURN\b/);
    // Tabel yang ditulis hanya tiga itu, dan satu-satunya UPDATE mengisi diisi_pada.
    expect([...B_KIRIM.matchAll(/\bUPDATE\s+(public\.\w+)\s+SET\s+(\w+)/g)].map((m) => `${m[1]}.${m[2]}`)).toEqual(['public.survei_undangan.diisi_pada']);
    expect(B_KIRIM).not.toMatch(/\bDELETE\b|\bTRUNCATE\b/i);
  });

  it('diisi_pada memakai jam database (pg_catalog.now()), bukan input pengguna', () => {
    expect(B_KIRIM).toMatch(/SET diisi_pada = pg_catalog\.now\(\)/);
    expect(KIRIM.slice(0, KIRIM.indexOf('$$'))).not.toMatch(/diisi|kedaluwarsa|waktu/i);
  });
});

describe('survei_rpc: rollback', () => {
  const urut = (re: RegExp) => pernyataanRollback.findIndex((p) => re.test(p));

  it('penjaga DO di urutan PERTAMA dan satu-satunya, mendahului DROP pertama', () => {
    expect(urut(/^DO \$\$/)).toBe(0);
    expect(pernyataanRollback.filter((p) => /^DO\b/.test(p))).toHaveLength(1);
    expect(rollback.indexOf('DO $$')).toBeLessThan(rollback.search(/\bDROP\b/i));
  });

  it('hanya DROP kedua fungsi (tanpa CASCADE, DML, ALTER, tabel): sama dengan yang dibuat migrasi, urutan kebalikan pembuatan', () => {
    expect(pernyataanRollback.slice(1)).toEqual([
      'DROP FUNCTION IF EXISTS public.kirim_survei(text, jsonb, jsonb)',
      'DROP FUNCTION IF EXISTS public.get_survei_context(text)',
    ]);
    const dibuat = [...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/gi)].map((m) => m[1]).sort();
    const dihapus = [...rollback.matchAll(/DROP\s+FUNCTION\s+IF EXISTS\s+public\.(\w+)/gi)].map((m) => m[1]).sort();
    expect(dihapus).toEqual(dibuat);
    expect(rollback).not.toMatch(/\bCASCADE\b|\bDELETE\b|\bTRUNCATE\b|\bUPDATE\b|\bALTER\b|\bDROP\s+TABLE\b|\bINSERT\b/i);
  });

  it('penjaga: menolak (PRASYARAT ROLLBACK) bila fungsi public lain, selain dua yang di-DROP, menyebut kirim_survei/get_survei_context; generik', () => {
    const awal = rollback.indexOf('DO $$');
    const akhir = rollback.indexOf('END $$;');
    expect(akhir).toBeGreaterThan(awal);
    const guard = rapikan(rollback.slice(awal, akhir));
    expect(guard).toMatch(/FROM pg_catalog\.pg_proc AS p JOIN pg_catalog\.pg_namespace AS n ON n\.oid = p\.pronamespace/);
    expect(guard).toMatch(/WHERE n\.nspname = 'public'/);
    const dikecualikan = guard.match(/p\.proname NOT IN \(([^)]*)\)/)?.[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort();
    expect(dikecualikan).toEqual(['get_survei_context', 'kirim_survei']);
    expect(guard).toMatch(/p\.prosrc ~\* '\(get_survei_context\|kirim_survei\)'/);
    expect(guard).toMatch(/RAISE EXCEPTION 'PRASYARAT ROLLBACK: /);
    expect(guard).toMatch(/IF v_fungsi IS NOT NULL THEN RAISE EXCEPTION/);
    expect(guard).not.toMatch(/ensure_undangan|spak_respons|notify_kunjungan_status/i);
  });

  it('header menjelaskan urutan (SESUDAH rollback 0004, SEBELUM rollback 0002 dan 0001), penjaga, dan akibatnya (survei tidak bisa dikirim; jawaban tersimpan tidak hilang)', () => {
    const header = rollbackRaw.replace(/\n--\s*/g, ' '); // gabungkan baris komentar agar frasa yang terpotong antar baris tetap cocok
    expect(header).toMatch(/PENJAGA/);
    expect(header).toMatch(/TIDAK ada ketergantungan tercatat/);
    expect(header).toMatch(/PERINGATAN/);
    expect(header).toMatch(/SETELAH rollback 202610270004/);
    expect(header).toMatch(/SEBELUM rollback 202610270002 dan 202610270001/);
    expect(header).toMatch(/jawaban yang sudah tersimpan TIDAK dihapus/i);
  });
});

describe('survei_rpc: pencatatan (docs/ATURAN_MIGRASI.md #4) dan skenario', () => {
  it('tercatat di MANIFEST.json', () => {
    const manifest = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'MANIFEST.json'), 'utf8'));
    expect(JSON.stringify(manifest)).toContain(BERKAS);
  });

  it('docs/MIGRATIONS.md: bagian "Survei terpadu Fase A" memuat berkas dan rollback 0003 (baris sesudah 0002), sebelum bagian 0014', () => {
    const md = bacaDocs('MIGRATIONS.md');
    const judul = '## Survei terpadu Fase A (202610270001-202610270004)';
    expect(md).toContain(judul);
    const bagian = md.slice(md.indexOf(judul), md.indexOf('## Data walk-in lengkap (0014)'));
    expect(md.indexOf(judul)).toBeLessThan(md.indexOf('## Data walk-in lengkap (0014)'));
    expect(bagian).toContain(BERKAS);
    expect(bagian).toContain(BERKAS_ROLLBACK);
    const baris = bagian.split('\n').filter((l) => l.startsWith('| 20261027'));
    expect(baris.map((l) => l.slice(0, 14))).toEqual(expect.arrayContaining(['| 202610270002', '| 202610270003']));
    const b3 = baris.find((l) => l.startsWith('| 202610270003 |'))!;
    expect(b3).toMatch(/BELUM DITERAPKAN/);
    expect(baris.indexOf(b3)).toBeGreaterThan(baris.findIndex((l) => l.startsWith('| 202610270002 |')));
  });

  it('docs/analysis/DB-CHANGES.md: entri 0003 SESUDAH entri 0002 (entri 0004 menyusul), status DITULIS, BELUM DITERAPKAN, memuat hasil PGlite, rollback, dan skenario', () => {
    const md = bacaDocs('analysis', 'DB-CHANGES.md');
    const i = md.lastIndexOf('202610270003_survei_rpc');
    expect(i).toBeGreaterThan(md.lastIndexOf('202610270002_survei_jawaban'));
    const mulai = md.lastIndexOf('\n### ', i);
    const berikut = md.indexOf('\n### ', i);
    const entri = md.slice(mulai, berikut < 0 ? undefined : berikut); // hanya entri 0003 sendiri
    expect(entri).toContain('Status       : DITULIS, BELUM DITERAPKAN');
    expect(entri).toMatch(/PGlite/);
    expect(entri).toContain(BERKAS_ROLLBACK);
    expect(entri).toContain('skenario-survei-rpc.mjs');
  });

  it('skenario PGlite ada dan memuat migrasi, rollback, dan batas kedaluwarsa yang diuji', () => {
    const skenario = join(MIGRATIONS_DIR, '..', '..', 'scripts', 'lokal', 'skenario-survei-rpc.mjs');
    expect(existsSync(skenario)).toBe(true);
    const isi = readFileSync(skenario, 'utf8');
    expect(isi).toContain('202610270003_survei_rpc.sql');
    expect(isi).toContain('rollback-survei-rpc-202610270003.sql');
    expect(isi).toContain('TEPAT di batas');
  });
});
