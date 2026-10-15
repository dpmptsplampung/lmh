// @vitest-environment node
// Kontrak statis 202610140015_pendataan_tanpa_topik_email_opsional (permintaan CEO 2026-10-15) beserta rollback.
// Tidak mengeksekusi SQL; tidak menyentuh database.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const M15 = '202610140015_pendataan_tanpa_topik_email_opsional.sql';
const RB15 = 'rollback-pendataan-tanpa-topik-email-opsional-202610140015.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8').replace(/\r\n/g, '\n');
const bacaDocs = (nama: string) =>
  readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', nama), 'utf8').replace(/\r\n/g, '\n');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

function ambilFungsi(sql: string, nama: string): string {
  const re = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.` + nama + String.raw`\s*\([\s\S]*?\$\$;`, 'gi');
  const hasil = [...sql.matchAll(re)].map((m) => m[0]);
  if (hasil.length !== 1) throw new Error(`fungsi ${nama}: ${hasil.length} definisi`);
  return hasil[0];
}
const kepala = (d: string) => rapikan(d.slice(0, d.indexOf('$$')));
const kodeGalat = (def: string) => new Set([...def.matchAll(/'([A-Z][A-Z_]{3,}):/g)].map((m) => m[1]));
const urutan = (def: string, penanda: string[]) => {
  const pos = penanda.map((p) => def.indexOf(p));
  for (const [i, p] of pos.entries()) expect(p, penanda[i]).toBeGreaterThan(0);
  expect([...pos].sort((a, b) => a - b)).toEqual(pos);
};

const raw = baca(M15);
const sql = stripSqlComments(raw);
const rbRaw = bacaDocs(RB15);
const rb = stripSqlComments(rbRaw);
const m12 = baca('202610140012_perbaikan_review.sql');
const m14 = baca('202610140014_walkin_data_lengkap.sql');
const ls15 = ambilFungsi(sql, 'layanan_selesai');
const ls12 = ambilFungsi(stripSqlComments(m12), 'layanan_selesai');
const fo15 = ambilFungsi(sql, 'fo_mulai_kunjungan');
const fo14 = ambilFungsi(stripSqlComments(m14), 'fo_mulai_kunjungan');

describe('202610140015: berkas, prasyarat, cakupan', () => {
  it('terdaftar, tepat sesudah 0014, tanpa kontrol transaksi, perintah dry-run di header', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(M15);
    const semua = listMigrationFiles();
    expect(semua.indexOf(M15)).toBe(semua.indexOf('202610140014_walkin_data_lengkap.sql') + 1);
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rbRaw)).toBe(false);
    expect(raw).toContain(`apply-migration.mjs supabase/migrations/${M15} --atomic --dry-run`);
    expect(rbRaw).toContain(`apply-migration.mjs docs/${RB15} --atomic --dry-run`);
  });

  it('penjaga prasyarat (penanda 0014, layanan_selesai 5 argumen, form_pendataan) sebelum perubahan apa pun', () => {
    expect(sql.search(/DO \$\$/)).toBeLessThan(sql.search(/\b(?:CREATE|ALTER|COMMENT)\b/));
    const blok = sql.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(blok).toContain("NOT LIKE '202610140014%'");
    expect(blok).toContain("to_regprocedure('public.layanan_selesai(uuid,text,jsonb,uuid,text)') IS NULL");
    expect(blok).toContain("attname = 'form_pendataan'");
  });

  it('hanya dua fungsi + CHECK; tanpa GRANT/REVOKE/DML/POLICY', () => {
    expect([...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/g)].map((m) => m[1]))
      .toEqual(['layanan_selesai', 'fo_mulai_kunjungan']);
    expect(sql).not.toMatch(/\bGRANT\b|\bREVOKE\b|\bPOLICY\b|\bUPDATE\s+public\.(?!tiket_antrean|penanganan|kunjungan|pelayanan_)|\bDELETE\s+FROM\b/i);
    expect([...sql.matchAll(/COMMENT ON FUNCTION public\.(\w+)\([^)]*\) IS\s+'202610140015:/g)].map((m) => m[1]))
      .toEqual(['layanan_selesai', 'fo_mulai_kunjungan']);
  });

  it('CHECK penanganan_status_konsisten = versi 0003 + "OR peran_tahap = \'layanan\'" pada klausa topik', () => {
    const cek = (s: string) => rapikan(s.match(/ADD CONSTRAINT penanganan_status_konsisten CHECK \([\s\S]*?\n\)/)![0]);
    const asli = rapikan(stripSqlComments(baca('202610140003_fo_model_data.sql')))
      .match(/CONSTRAINT penanganan_status_konsisten (CHECK \(.*?batal_karena IS NOT NULL\) \))/)![1];
    expect(cek(sql)).toBe(`ADD CONSTRAINT penanganan_status_konsisten ${asli
      .replace("(hasil = 'dikembalikan' OR (topik", "(hasil = 'dikembalikan' OR peran_tahap = 'layanan' OR (topik")}`);
    expect(cek(rb)).toBe(`ADD CONSTRAINT penanganan_status_konsisten ${asli}`);
    expect(rb).toContain(') NOT VALID;');
  });
});

describe('layanan_selesai versi 0015', () => {
  it('signature/atribut, kode galat, dan isi selain blok topik/catatan identik dengan 0012', () => {
    expect(kepala(ls15)).toBe(kepala(ls12));
    expect(kodeGalat(ls15)).toEqual(kodeGalat(ls12));
    // Dibandingkan pada teks BERKOMENTAR (penanda blok = komentar) lalu komentar dibuang.
    const tanpaBlok = (d: string) => rapikan(stripSqlComments(d
      .replace(/-- Tahap penanganan[\s\S]*?\n  END IF;\n/, '')
      .replace(/    -- 202610140015: catatan tahap layanan[\s\S]*?\n    END IF;\n/, '')));
    expect(tanpaBlok(ambilFungsi(raw, 'layanan_selesai'))).toBe(tanpaBlok(ambilFungsi(m12, 'layanan_selesai')));
  });

  it('layanan tanpa Pendataan tetap wajib topik + catatan; ber-Pendataan opsional (divalidasi bila dikirim)', () => {
    const r = rapikan(ls15);
    expect(r).toContain(
      'IF v_form_wajib IS NULL THEN v_topik := public.fo_validasi_topik(p_topik_id, v_t.layanan_id); '
      + 'v_catatan := public.fo_validasi_catatan(p_catatan, 1000); ELSE IF p_topik_id IS NOT NULL THEN '
      + 'v_topik := public.fo_validasi_topik(p_topik_id, v_t.layanan_id); END IF;');
    expect(r).toContain("IF pg_catalog.btrim(COALESCE(p_catatan, '')) <> '' THEN v_catatan := public.fo_validasi_catatan(p_catatan, 1000);");
  });

  it('catatan diturunkan dari Pendataan (tindak_lanjut + uraian_solusi / catatan_petugas), <= 1000, fallback "-"', () => {
    const r = rapikan(ls15);
    expect(r).toContain("'Tindak lanjut: ' || NULLIF(pg_catalog.btrim(p_payload->>'tindak_lanjut'), '')");
    expect(r).toContain("CASE p_form_type WHEN 'oss' THEN p_payload->>'uraian_solusi' ELSE p_payload->>'catatan_petugas' END");
    expect(r).toMatch(/pg_catalog\.left\([\s\S]*1000\)\), ''\), '-'\);/);
    // diturunkan setelah pendataan ditulis, sebelum penanganan ditutup
    urutan(ls15, ['PERFORM public.pendataan_validasi_payload', 'IF v_catatan IS NULL THEN', 'UPDATE public.penanganan AS p']);
  });
});

describe('fo_mulai_kunjungan versi 0015', () => {
  it('signature/atribut dan kode galat identik dengan 0014; hanya validasi email + INSERT berubah', () => {
    expect(kepala(fo15)).toBe(kepala(fo14));
    expect(kodeGalat(fo15)).toEqual(kodeGalat(fo14));
    const n15 = rapikan(fo15
      .replace(/IF v_email <> '' AND \(([\s\S]*?)\) THEN\s+RAISE EXCEPTION '[^']*'/, 'IF $1 THEN RAISE EXCEPTION X')
      .replace("NULLIF(v_email, '')", 'v_email'));
    const n14 = rapikan(fo14
      .replace(/IF (pg_catalog\.char_length\(v_email\)[\s\S]*?) THEN\s+RAISE EXCEPTION '[^']*'/, 'IF $1 THEN RAISE EXCEPTION X'));
    expect(n15).toBe(n14);
  });

  it('email kosong diterima (NULL), terisi tetap divalidasi pola 0014', () => {
    expect(rapikan(fo15)).toContain(
      "IF v_email <> '' AND (pg_catalog.char_length(v_email) > 254 OR v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\\.[a-z0-9-]+)*\\.[a-z]{2,}$') THEN");
    expect(fo15).toContain("NULLIF(v_email, '')");
    expect(fo15).toMatch(/USING ERRCODE = '22023', DETAIL = 'email';/);
  });
});

describe('rollback 202610140015', () => {
  it('memulihkan layanan_selesai PERSIS 0012 dan fo_mulai_kunjungan + komentar PERSIS 0014', () => {
    expect(rbRaw).toContain(ambilFungsi(m12, 'layanan_selesai'));
    expect(rbRaw).toContain(ambilFungsi(m14, 'fo_mulai_kunjungan'));
    expect(rbRaw).toContain(m14.match(/COMMENT ON FUNCTION public\.fo_mulai_kunjungan[\s\S]*?';/)![0]);
    expect(rb).toContain('COMMENT ON FUNCTION public.layanan_selesai(uuid, text, jsonb, uuid, text) IS NULL;');
    expect(rb).not.toMatch(/\bGRANT\b|\bREVOKE\b|\bDELETE\b/i);
    // DML hanya di dalam fungsi yang dipulihkan (tidak ada perubahan data tingkat atas)
    const luar = rb.replace(ambilFungsi(rb, 'layanan_selesai'), '').replace(ambilFungsi(rb, 'fo_mulai_kunjungan'), '');
    expect(luar).not.toMatch(/\bUPDATE\s+public\.|\bINSERT\s+INTO\b/i);
  });

  it('penjaga urutan di awal: penanda 0015 pada KEDUA fungsi', () => {
    expect(rb.search(/DO \$\$/)).toBeLessThan(rb.search(/\b(?:CREATE|ALTER|COMMENT)\b/));
    const blok = rb.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect([...blok.matchAll(/NOT LIKE '202610140015%' THEN\s+RAISE EXCEPTION 'ROLLBACK DITOLAK/g)]).toHaveLength(2);
  });
});
