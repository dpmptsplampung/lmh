// @vitest-environment node
// Kontrak statis 202610140013_fo_keterbukaan_data (keputusan CEO 2026-10-14: keterbukaan data antar Front Office) beserta
// rollback dan penjaga urutan rollback 0012. Tidak mengeksekusi SQL; tidak menyentuh database.
// Uji perilaku: scripts/test-fo-keterbukaan.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES, MIGRATIONS_DIR, listMigrationFiles, stripSqlComments } from './migration-test-utils';
import { mengandungKontrolTransaksi } from '../../scripts/lib/sql-txn.mjs';

const M13 = '202610140013_fo_keterbukaan_data.sql';
const RB13 = 'rollback-fo-keterbukaan-data-202610140013.sql';

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

const raw = baca(M13);
const sql = stripSqlComments(raw);
const rbRaw = bacaDocs(RB13);
const rb = stripSqlComments(rbRaw);
const m9 = stripSqlComments(baca('202610140009_chat_online.sql'));
const f13 = ambilFungsi(sql, 'boleh_penanganan');
const f9 = ambilFungsi(m9, 'boleh_penanganan');

/** Cabang front_office dari definisi boleh_penanganan (dari IF v_role = 'front_office' sampai IF berikutnya). */
function cabangFo(def: string): string {
  const awal = def.indexOf("IF v_role = 'front_office' THEN");
  const akhir = def.indexOf("IF v_role = 'petugas'");
  expect(awal).toBeGreaterThan(0);
  expect(akhir).toBeGreaterThan(awal);
  return def.slice(awal, akhir);
}

describe('202610140013: berkas, urutan, prasyarat', () => {
  it('terdaftar, nama valid, sesudah 0012; tanpa kontrol transaksi; perintah dry-run di header', () => {
    expect(FORWARD_MIGRATION_FILES).toContain(M13);
    const semua = listMigrationFiles();
    expect(semua.indexOf(M13)).toBe(semua.indexOf('202610140012_perbaikan_review.sql') + 1);
    expect(mengandungKontrolTransaksi(raw)).toBe(false);
    expect(mengandungKontrolTransaksi(rbRaw)).toBe(false);
    expect(raw).toContain(`apply-migration.mjs supabase/migrations/${M13} --atomic --dry-run`);
    expect(rbRaw).toContain(`apply-migration.mjs docs/${RB13} --atomic --dry-run`);
  });

  it('penjaga prasyarat (DO) sebelum perubahan apa pun: penanganan/boleh_penanganan, 0009, 0012', () => {
    const awal = sql.search(/DO \$\$/);
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(sql.search(/\b(?:CREATE|ALTER|UPDATE|INSERT|DROP|REVOKE|COMMENT)\b/));
    const blok = sql.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(blok).toMatch(/to_regclass\('public\.penanganan'\) IS NULL/);
    expect(blok).toMatch(/to_regprocedure\('public\.boleh_penanganan\(uuid,text,uuid,uuid,text\)'\) IS NULL/);
    expect(blok).toMatch(/to_regprocedure\('public\.chat_buat_kunjungan\(uuid,text,date\)'\) IS NULL/);
    expect(blok).toMatch(/to_regprocedure\('public\.hari_tanpa_layanan\(date\)'\) IS NULL/);
  });

  it('hanya mengganti boleh_penanganan: tanpa policy/GRANT tabel/DML; tidak menyentuh tabel lain', () => {
    expect([...sql.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)/g)].map((m) => m[1])).toEqual(['boleh_penanganan']);
    expect(sql).not.toMatch(/\bCREATE\s+POLICY\b|\bDROP\s+POLICY\b|\bALTER\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bGRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)\b[^;]*\bON\s+(?:TABLE\s+)?public\./i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b|\bUPDATE\s+public\.|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bALTER\s+TABLE\b/i);
  });
});

describe('boleh_penanganan versi 0013', () => {
  it('signature dan atribut sama dengan versi 0009 (STABLE, SECURITY DEFINER, search_path terkunci)', () => {
    expect(kepala(f13)).toBe(kepala(f9));
    expect(f13).toMatch(/SECURITY DEFINER/);
    expect(f13).toMatch(/SET search_path = pg_catalog, public/);
  });

  it('cabang front_office = RETURN true (semua FO membaca semua tahap); FO tetap lewat staf_saya() (aktif)', () => {
    expect(rapikan(cabangFo(f13))).toBe("IF v_role = 'front_office' THEN RETURN true; END IF;");
    expect(f13).toMatch(/FROM public\.staf_saya\(\) AS me;\s+IF v_id IS NULL THEN\s+RETURN false;/);
  });

  it('cabang lain (admin, petugas, chat, default false) IDENTIK dengan versi 0009', () => {
    const tanpaFo = (d: string) => rapikan(d.replace(cabangFo(d), ''));
    expect(tanpaFo(f13)).toBe(tanpaFo(f9));
    // Petugas tidak ikut dilonggarkan: masih dibatasi layanannya.
    expect(f13).toMatch(/IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN/);
    expect(f13.trimEnd()).toMatch(/RETURN false;\s+END \$\$;$/);
  });

  it('hak EXECUTE sama (authenticated + service_role; anon/PUBLIC dicabut); penanda komentar 202610140013', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.boleh_penanganan\(uuid, text, uuid, uuid, text\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.boleh_penanganan\(uuid, text, uuid, uuid, text\) TO authenticated, service_role;/);
    expect(sql).toMatch(/COMMENT ON FUNCTION public\.boleh_penanganan\(uuid, text, uuid, uuid, text\) IS\s+'202610140013:/);
  });

  it('penanganan tetap baca-saja untuk klien: 0003 hanya GRANT SELECT + policy SELECT, tanpa policy tulis', () => {
    const m3 = stripSqlComments(baca('202610140003_fo_model_data.sql'));
    expect(m3).toMatch(/GRANT SELECT ON TABLE public\.penanganan TO authenticated;/);
    const policies = [...m3.matchAll(/CREATE POLICY (\w+) ON public\.penanganan FOR (\w+)/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(policies).toEqual(['penanganan_staf_select:SELECT']);
    // Tidak ada migrasi lain yang menambah policy/hak tulis penanganan.
    for (const f of listMigrationFiles()) {
      const s = stripSqlComments(baca(f));
      expect(s, f).not.toMatch(/CREATE POLICY \w+ ON public\.penanganan FOR (?:INSERT|UPDATE|DELETE|ALL)/i);
      expect(s, f).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[^;]*ON\s+(?:TABLE\s+)?public\.penanganan\s+TO\s+(?:authenticated|anon|PUBLIC)/i);
    }
  });

  it('RPC penutup tahap FO tetap memeriksa pemilik (BUKAN_PEMILIK) pada versi terakhirnya', () => {
    // fo_selesai / fo_eskalasi versi terakhir ada di 0007 (tidak diubah 0012/0013).
    const m7 = stripSqlComments(baca('202610140007_wp24_akhiri_dual_write.sql'));
    for (const nama of ['fo_selesai', 'fo_eskalasi']) {
      expect(ambilFungsi(m7, nama), nama).toMatch(/BUKAN_PEMILIK/);
      expect(stripSqlComments(baca('202610140012_perbaikan_review.sql'))).not.toMatch(new RegExp(`FUNCTION public\\.${nama}\\b`));
    }
  });
});

describe('rollback 202610140013', () => {
  it('memulihkan boleh_penanganan PERSIS dari 0009 + hak; komentar dihapus', () => {
    expect(rapikan(ambilFungsi(rb, 'boleh_penanganan'))).toBe(rapikan(f9));
    expect(rb).toMatch(/GRANT EXECUTE ON FUNCTION public\.boleh_penanganan\(uuid, text, uuid, uuid, text\) TO authenticated, service_role;/);
    expect(rb).toMatch(/COMMENT ON FUNCTION public\.boleh_penanganan\(uuid, text, uuid, uuid, text\) IS NULL;/);
    expect(rb).not.toMatch(/\bDROP\b|\bDELETE\b/i);
  });

  it('penjaga di awal: boleh_penanganan dan 0009 harus ada', () => {
    const awal = rb.search(/DO \$\$/);
    expect(awal).toBeGreaterThanOrEqual(0);
    expect(awal).toBeLessThan(rb.search(/\b(?:CREATE|ALTER|COMMENT)\b/));
    const blok = rb.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(blok).toMatch(/to_regprocedure\('public\.chat_buat_kunjungan\(uuid,text,date\)'\) IS NULL THEN\s+RAISE EXCEPTION 'ROLLBACK DITOLAK/);
  });

  it('rollback 0012 menolak selama penanda 0013 masih ada (sebelum perubahan apa pun)', () => {
    const r12 = stripSqlComments(bacaDocs('rollback-perbaikan-review-202610140012.sql'));
    const blok = r12.match(/DO \$\$[\s\S]*?\$\$;/)![0];
    expect(r12.search(/DO \$\$/)).toBeLessThan(r12.search(/\b(?:CREATE|DROP|ALTER)\b/));
    expect(rapikan(blok)).toContain(
      "IF COALESCE(pg_catalog.obj_description( pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)'), 'pg_proc'), '') LIKE '%202610140013%' THEN RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140013");
    // Penanda yang diperiksa memang ditulis oleh 0013.
    expect(raw).toMatch(/IS\s+'202610140013:/);
  });
});

describe('dokumen', () => {
  it('MIGRATIONS, DB-CHANGES, RBAC, DECISION_LOG, PDP mencatat 0013 / keterbukaan antar FO', () => {
    expect(bacaDocs('MIGRATIONS.md')).toContain(M13);
    expect(bacaDocs('MIGRATIONS.md')).toContain(RB13);
    expect(bacaDocs(join('analysis', 'DB-CHANGES.md'))).toContain('202610140013');
    expect(bacaDocs(join('analysis', '04-RBAC-MATRIX.md'))).toContain('202610140013');
    expect(bacaDocs('DECISION_LOG.md')).toMatch(/keterbukaan[^\n]*Front Office|Front Office[^\n]*keterbukaan/i);
    expect(bacaDocs('KEBIJAKAN_PDP.md')).toContain('202610140013');
  });
});
