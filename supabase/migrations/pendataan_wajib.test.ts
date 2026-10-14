// @vitest-environment node
// Kontrak statis Tahap C3 (keputusan CEO G.5): 202610140011_pendataan_wajib (Pendataan semua field wajib) beserta
// rollback-nya. Tidak mengeksekusi SQL; tidak menyentuh database.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';
import {
  SKALA_USAHA_OPTIONS,
  STATUS_PENANAMAN_MODAL_OPTIONS,
  TIPE_PELAKU_USAHA_OPTIONS,
  ossPelayananFinalSchema,
  perizinanPelayananFinalSchema,
} from '../../src/lib/types/pelayanan';

const M11 = '202610140011_pendataan_wajib.sql';
const M7 = '202610140007_wp24_akhiri_dual_write.sql';
const RB11 = 'rollback-pendataan-wajib-202610140011.sql';

const baca = (nama: string) => readFileSync(join(MIGRATIONS_DIR, nama), 'utf8').replace(/\r\n/g, '\n');
const bacaDocs = (nama: string) =>
  readFileSync(join(MIGRATIONS_DIR, '..', '..', 'docs', nama), 'utf8').replace(/\r\n/g, '\n');
const rapikan = (s: string) => s.replace(/\s+/g, ' ').trim();

function ambilFungsi(sql: string, nama: string): string {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${nama}\\s*\\([\\s\\S]*?\\$\\$;`, 'gi');
  const hasil = [...sql.matchAll(re)].map((m) => m[0]);
  if (hasil.length !== 1) throw new Error(`fungsi ${nama}: ${hasil.length} definisi`);
  return hasil[0];
}
/** Kode galat di awal pesan RAISE ('KODE: ...'). */
const kodeGalat = (def: string) => new Set([...def.matchAll(/'([A-Z][A-Z_]{3,}):/g)].map((m) => m[1]));

const raw = baca(M11);
const sql = stripSqlComments(raw);
const rbRaw = bacaDocs(RB11);
const rb = stripSqlComments(rbRaw);
const sql7 = stripSqlComments(baca(M7));

const fn11 = ambilFungsi(sql, 'layanan_selesai');
const fn7 = ambilFungsi(sql7, 'layanan_selesai');
const helper = ambilFungsi(sql, 'pendataan_validasi_payload');

describe('202610140011_pendataan_wajib (C3)', () => {
  it('terdaftar sebagai migrasi forward dan tanpa kontrol transaksi (apply --atomic membungkusnya)', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(M11);
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rbRaw)).toBe(false);
  });

  it('penjaga prasyarat: wajib setelah 202610140007 (layanan_selesai tanpa visit)', () => {
    expect(sql).toMatch(/to_regprocedure\('public\.visit_arsip_jaga\(\)'\)\s+IS NULL/);
    expect(sql).toMatch(/to_regprocedure\('public\.layanan_selesai\(uuid,text,jsonb,uuid,text\)'\)\s+IS NULL/);
    expect(raw).toMatch(/PRASYARAT: 202610140007/);
  });

  it('layanan_selesai = versi 0007 PERSIS + tepat dua pemanggilan validasi (oss, perizinan) setelah cek LOCKED', () => {
    const tanpaSisipan = fn11
      .replace(/\n\s*PERFORM public\.pendataan_validasi_payload\('(?:oss|perizinan)', p_payload\);\n/g, '\n');
    expect(rapikan(tanpaSisipan)).toBe(rapikan(fn7));
    expect(fn11.match(/pendataan_validasi_payload\(/g)).toHaveLength(2);
    // validasi di cabang yang benar, sesudah pemeriksaan LOCKED dan sebelum INSERT/UPDATE data pelayanan
    const iOss = fn11.indexOf("pendataan_validasi_payload('oss'");
    const iPz = fn11.indexOf("pendataan_validasi_payload('perizinan'");
    expect(fn11.lastIndexOf("RAISE EXCEPTION 'LOCKED", iOss)).toBeGreaterThan(fn11.indexOf("p_form_type = 'oss'"));
    expect(fn11.indexOf('INSERT INTO public.pelayanan_oss')).toBeGreaterThan(iOss);
    expect(fn11.indexOf('INSERT INTO public.pelayanan_perizinan')).toBeGreaterThan(iPz);
    expect(iPz).toBeGreaterThan(fn11.indexOf("p_form_type = 'perizinan'"));
  });

  it('signature, atribut, dan kode galat layanan_selesai tidak berubah; tidak menyentuh visit', () => {
    const kepala = (d: string) => rapikan(d.slice(0, d.indexOf('$$')));
    expect(kepala(fn11)).toBe(kepala(fn7));
    expect(kodeGalat(fn11)).toEqual(kodeGalat(fn7));
    expect(fn11).not.toMatch(/public\.visit\b/);
    // grant tidak diubah di sini (CREATE OR REPLACE mempertahankan grant 0005)
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.layanan_selesai/i);
  });

  it('pendataan_validasi_payload: invoker tanpa hak publik, galat INVALID_PAYLOAD (22023), search_path terkunci', () => {
    expect(helper).toMatch(/SET search_path = pg_catalog, public/);
    expect(helper).not.toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.pendataan_validasi_payload\(text, jsonb\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).not.toMatch(/GRANT[^;]*pendataan_validasi_payload/i);
    expect(kodeGalat(helper)).toEqual(new Set(['INVALID_PAYLOAD']));
    expect(helper).toMatch(/USING ERRCODE = '22023'/);
    // kode baru tidak bentrok dengan kode galat lain pada pesan (pola klien memakai \b...\b)
    expect(helper).not.toMatch(/LOCKED|INVALID_FORM|NOT_FOUND|FORBIDDEN/);
  });

  it('daftar field wajib di SQL = kunci skema Zod final (satu kebenaran, tanpa field terlewat)', () => {
    const semua = [...helper.matchAll(/v_wajib := ARRAY\[([^\]]*)\]/g)].map((m) =>
      [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]),
    );
    expect(semua[0]).toEqual(Object.keys(ossPelayananFinalSchema.shape));
    expect(semua[1]).toEqual(Object.keys(perizinanPelayananFinalSchema.shape));
    // semua field menjadi wajib: tidak ada yang dikecualikan
    expect(semua[0]).toHaveLength(14);
    expect(semua[1]).toHaveLength(11);
  });

  it('nilai pilihan di SQL = opsi di TypeScript; CHECK pelayanan_oss dilonggarkan (superset) dengan opsi tidak berlaku', () => {
    const daftarIn = (kolom: string, teks: string) => {
      const m = teks.match(new RegExp(`'${kolom}'\\s*\\)\\s+NOT IN \\(([^)]*)\\)`));
      if (!m) throw new Error(`NOT IN ${kolom} tidak ada`);
      return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    };
    expect(daftarIn('tipe_pelaku_usaha', helper)).toEqual([...TIPE_PELAKU_USAHA_OPTIONS]);
    expect(daftarIn('status_penanaman_modal', helper)).toEqual([...STATUS_PENANAMAN_MODAL_OPTIONS]);
    expect(daftarIn('skala_usaha', helper)).toEqual([...SKALA_USAHA_OPTIONS]);

    const cek = (kolom: string) => {
      const m = sql.match(new RegExp(`CHECK \\(${kolom} IS NULL OR ${kolom} IN \\(([^)]*)\\)\\)`));
      if (!m) throw new Error(`CHECK ${kolom} tidak ada`);
      return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    };
    expect(cek('tipe_pelaku_usaha')).toEqual([...TIPE_PELAKU_USAHA_OPTIONS]);
    expect(cek('skala_usaha')).toEqual([...SKALA_USAHA_OPTIONS]);
    // status_penanaman_modal sudah punya 'tidak_ada': CHECK-nya tidak diubah
    expect(sql).not.toMatch(/status_penanaman_modal IS NULL/);
    // hanya melonggarkan: tidak menghapus/mengubah data, tidak ada UPDATE/DELETE
    // (di luar badan layanan_selesai, yang menulis data pelayanan baru seperti 0007)
    expect(sql.replace(fn11, '')).not.toMatch(/\b(?:UPDATE|DELETE)\b\s+(?:FROM\s+)?public\./i);
    expect(sql).not.toMatch(/ADD CONSTRAINT[^;]*NOT VALID/i);
  });

  it('validasi hanya pada penyelesaian baru: tidak ada penguncian / perubahan data lama', () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.pelayanan_(?:oss|perizinan)[^;]*(?:SET NOT NULL|ADD COLUMN)/i);
    expect(sql).not.toMatch(/koreksi_pelayanan/);
  });
});

describe('rollback-pendataan-wajib-202610140011', () => {
  it('memulihkan layanan_selesai PERSIS versi 0007 dan menghapus helper', () => {
    expect(rapikan(ambilFungsi(rb, 'layanan_selesai'))).toBe(rapikan(fn7));
    expect(rb).toMatch(/DROP FUNCTION IF EXISTS public\.pendataan_validasi_payload\(text, jsonb\);/);
    expect(rb).not.toMatch(/pendataan_validasi_payload\('/);
    // fungsi dipulihkan SEBELUM helper dihapus (tidak ada fungsi yang menunjuk helper yang sudah hilang)
    expect(rb.indexOf('CREATE OR REPLACE FUNCTION public.layanan_selesai')).toBeLessThan(
      rb.indexOf('DROP FUNCTION IF EXISTS public.pendataan_validasi_payload'),
    );
  });

  it('tidak menyempitkan CHECK (aman bagi baris yang sudah memakai nilai tidak berlaku)', () => {
    expect(rb).not.toMatch(/ADD CONSTRAINT|DROP CONSTRAINT/i);
    expect(rbRaw).toMatch(/TIDAK dikembalikan/);
  });
});
