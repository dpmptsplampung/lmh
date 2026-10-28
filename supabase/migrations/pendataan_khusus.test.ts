// @vitest-environment node
//
// Kontrak statis migrasi 202610300001 (Fase 4: definisi dan jawaban Pendataan Khusus). Hanya membaca teks SQL.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { FORWARD_MIGRATION_FILES } from './migration-test-utils';

const NAMA_FILE = '202610300001_pendataan_khusus.sql';
const sql = readFileSync(join(__dirname, NAMA_FILE), 'utf8').replace(/\r\n/g, '\n');
const bare = sql.replace(/--[^\n]*/g, '');

function fungsi(nama: string): string {
  return bare.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nama}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] ?? '';
}

describe('202610300001_pendataan_khusus migration', () => {
  it('terdaftar tepat sesudah 202610290002 dan menjaga prasyarat lingkup Fase 3', () => {
    const daftar = FORWARD_MIGRATION_FILES as readonly string[];
    expect(daftar.indexOf(NAMA_FILE)).toBe(daftar.indexOf('202610290002_rekap_terpadu.sql') + 1);
    expect(bare).toMatch(/to_regprocedure\('public\.boleh_data_pelayanan\(text,uuid,uuid\)'\) IS NULL/);
    expect(bare).toMatch(/to_regclass\('public\.penanganan'\) IS NULL/);
  });

  it('aditif (B1): tanpa TRUNCATE, DROP TABLE/COLUMN, DELETE, atau UPDATE nilai lama di luar fungsi/trigger', () => {
    const atas = bare.replace(/\$\$[\s\S]*?\$\$/g, '');
    expect(atas).not.toMatch(/TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN|\bDELETE\s+FROM\b|\bUPDATE\s+public\./i);
    // Satu-satunya INSERT di luar fungsi: topik awal "Lainnya" (baris baru).
    const insertAtas = atas.match(/INSERT INTO [a-z_.]+/gi) ?? [];
    expect(insertAtas).toEqual(['INSERT INTO public.topik_penanganan']);
  });

  it('definisi isian: tujuh jenis tepat, opsi array, label 2-100', () => {
    expect(bare).toMatch(/CREATE TABLE IF NOT EXISTS public\.pendataan_khusus_field/);
    const jenis = bare.match(/CHECK \(jenis IN \(([^)]*)\)\)/)?.[1] ?? '';
    expect(jenis.replace(/\s+/g, '')).toBe(
      "'teks_singkat','teks_panjang','angka','tanggal','pilihan_tunggal','pilihan_ganda','ya_tidak'",
    );
    expect(bare).toMatch(/layanan_id\s+uuid\s+NOT NULL REFERENCES public\.layanan\(id\) ON DELETE CASCADE/);
    expect(bare).toMatch(/CHECK \(char_length\(btrim\(label\)\) BETWEEN 2 AND 100\)/);
    expect(bare).toMatch(/jsonb_typeof\(opsi\) = 'array'/);
    expect(bare).toMatch(/pernah_diisi\s+boolean\s+NOT NULL DEFAULT false/);
    expect(bare).toMatch(/tersembunyi\s+boolean\s+NOT NULL DEFAULT false/);
  });

  it('jawaban kunci field_id stabil + salinan label/jenis; FK RESTRICT; unik per pelayanan x isian', () => {
    expect(bare).toMatch(/CREATE TABLE IF NOT EXISTS public\.pendataan_khusus_jawaban/);
    expect(bare).toMatch(/penanganan_id\s+uuid\s+NOT NULL REFERENCES public\.penanganan\(id\) ON DELETE RESTRICT/);
    expect(bare).toMatch(/field_id\s+uuid\s+NOT NULL REFERENCES public\.pendataan_khusus_field\(id\) ON DELETE RESTRICT/);
    expect(bare).toMatch(/label_snapshot\s+text\s+NOT NULL/);
    expect(bare).toMatch(/jenis_snapshot\s+text\s+NOT NULL/);
    expect(bare).toMatch(/UNIQUE \(penanganan_id, field_id\)/);
  });

  it('aturan "pernah diisi" ditegakkan trigger DB: jenis terkunci, layanan tetap, hapus ditolak, flag monoton', () => {
    const jaga = fungsi('pendataan_khusus_field_jaga');
    expect(jaga).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(jaga).toMatch(/JENIS_TERKUNCI/);
    expect(jaga).toMatch(/OLD\.pernah_diisi OR EXISTS \(SELECT 1 FROM public\.pendataan_khusus_jawaban/);
    expect(jaga).toMatch(/NEW\.jenis IS DISTINCT FROM OLD\.jenis/);
    expect(jaga).toMatch(/LAYANAN_TETAP/);
    expect(jaga).toMatch(/NEW\.pernah_diisi := OLD\.pernah_diisi OR NEW\.pernah_diisi/);
    expect(jaga).toMatch(/LAYANAN_FORMULIR_TETAP/);
    expect(jaga).toMatch(/form_pendataan IS NOT NULL/);
    expect(jaga).toMatch(/ISIAN_TERLALU_BANYAK/);
    expect(jaga).toMatch(/OPSI_TIDAK_VALID/);
    expect(bare).toMatch(/BEFORE INSERT OR UPDATE ON public\.pendataan_khusus_field/);

    const hapus = fungsi('pendataan_khusus_field_jaga_hapus');
    expect(hapus).toMatch(/SUDAH_DIISI/);
    expect(hapus).toMatch(/OLD\.pernah_diisi OR EXISTS/);
    expect(bare).toMatch(/BEFORE DELETE ON public\.pendataan_khusus_field/);

    const tandai = fungsi('pendataan_khusus_tandai_terisi');
    expect(tandai).toMatch(/SET pernah_diisi = true/);
    expect(bare).toMatch(/AFTER INSERT ON public\.pendataan_khusus_jawaban/);
  });

  it('RLS: definisi dibaca staf, ditulis admin TO authenticated (tanpa FOR ALL); jawaban hanya SELECT lewat boleh_baca_khusus', () => {
    expect(bare).toMatch(/ALTER TABLE public\.pendataan_khusus_field ENABLE ROW LEVEL SECURITY/);
    expect(bare).toMatch(/ALTER TABLE public\.pendataan_khusus_jawaban ENABLE ROW LEVEL SECURITY/);
    expect(bare).not.toMatch(/FOR ALL/i);
    for (const op of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(bare).toMatch(new RegExp(`CREATE POLICY pendataan_khusus_field_admin_${op.toLowerCase()} ON public\\.pendataan_khusus_field FOR ${op} TO authenticated`));
    }
    expect(bare).toMatch(/CREATE POLICY pendataan_khusus_field_select ON public\.pendataan_khusus_field FOR SELECT TO authenticated\s+USING \(public\.peran_saya\(\) IN \('admin', 'petugas', 'front_office'\)\)/);
    expect(bare).toMatch(/CREATE POLICY pendataan_khusus_jawaban_select ON public\.pendataan_khusus_jawaban FOR SELECT TO authenticated\s+USING \(public\.boleh_baca_khusus\(penanganan_id\)\)/);
    // Jawaban: klien tidak punya hak tulis sama sekali.
    expect(bare).toMatch(/REVOKE ALL ON TABLE public\.pendataan_khusus_jawaban FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT SELECT ON TABLE public\.pendataan_khusus_jawaban TO authenticated/);
    expect(bare).not.toMatch(/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*pendataan_khusus_jawaban/);
    expect(bare).not.toMatch(/TO anon/);
  });

  it('lingkup baca jawaban = boleh_data_pelayanan Fase 3 (tanpa jendela operasional)', () => {
    const f = fungsi('boleh_baca_khusus');
    expect(f).toMatch(/STABLE\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(f).toMatch(/public\.boleh_data_pelayanan\(p\.peran_tahap, p\.layanan_id, p\.penangan_id\)/);
    expect(f).not.toMatch(/kunjungan_operasional|boleh_penanganan|boleh_kunjungan/);
    expect(bare).toMatch(/REVOKE ALL ON FUNCTION public\.boleh_baca_khusus\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.boleh_baca_khusus\(uuid\) TO authenticated, service_role/);
  });

  it('validasi: kunci per id isian terlihat, FOR SHARE, ketujuh jenis, wajib; simpan internal tanpa GRANT klien', () => {
    const v = fungsi('pendataan_khusus_validasi');
    expect(v).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(v).toMatch(/NOT x\.tersembunyi[\s\S]*FOR SHARE/);
    expect(v).toMatch(/KHUSUS_WAJIB/);
    expect(v).toMatch(/KHUSUS_TIDAK_VALID/);
    for (const j of ['teks_singkat', 'teks_panjang', 'angka', 'tanggal', 'pilihan_tunggal', 'pilihan_ganda', 'ya_tidak']) {
      expect(v, j).toContain(`'${j}'`);
    }
    expect(v).toMatch(/jsonb_typeof\(v_raw\) <> 'number'/);
    expect(v).toMatch(/jsonb_typeof\(v_raw\) = 'boolean'/);

    const s = fungsi('pendataan_khusus_simpan');
    expect(s).toMatch(/public\.pendataan_khusus_validasi\(p_layanan, p_jawaban\)/);
    expect(s).toMatch(/INSERT INTO public\.pendataan_khusus_jawaban/);
    for (const f of ['pendataan_khusus_validasi', 'pendataan_khusus_simpan']) {
      expect(bare).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
      expect(bare).not.toMatch(new RegExp(`GRANT[^;]*public\\.${f}`));
    }
  });

  it('topik awal "Lainnya" bagi Layanan tanpa topik: backfill + trigger Layanan baru', () => {
    expect(bare).toMatch(/INSERT INTO public\.topik_penanganan \(layanan_id, nama, urut\)[\s\S]*'Lainnya'[\s\S]*WHERE l\.aktif\s+AND NOT EXISTS \(SELECT 1 FROM public\.topik_penanganan AS t WHERE t\.layanan_id = l\.id\)/);
    const f = fungsi('layanan_topik_awal');
    expect(f).toMatch(/SECURITY DEFINER\s+SET search_path = pg_catalog, public/);
    expect(f).toMatch(/ON CONFLICT DO NOTHING/);
    expect(bare).toMatch(/AFTER INSERT ON public\.layanan/);
  });

  it('batas 40 isian dan urutan dijaga DB: kunci penasihat per Layanan, urut diberikan trigger (bukan hitungan aplikasi)', () => {
    const jaga = fungsi('pendataan_khusus_field_jaga');
    expect(jaga).toMatch(/pg_advisory_xact_lock\(/);
    expect(jaga.indexOf('pg_advisory_xact_lock(')).toBeLessThan(jaga.indexOf('ISIAN_TERLALU_BANYAK'));
    expect(jaga).toMatch(/NEW\.urut := /);
    expect(jaga).toMatch(/max\(f\.urut\)/);
  });

  it('urutan atomik: satu pernyataan UPDATE ... FROM unnest, SECURITY INVOKER (RLS admin), mismatch -> ISIAN_TIDAK_DITEMUKAN', () => {
    const f = fungsi('pendataan_khusus_urutkan');
    expect(f).toMatch(/LANGUAGE plpgsql\s+VOLATILE\s+SECURITY INVOKER\s+SET search_path = pg_catalog, public/);
    expect(f.match(/UPDATE public\.pendataan_khusus_field/g)).toHaveLength(1);
    expect(f).toMatch(/unnest\(p_urutan\) WITH ORDINALITY/);
    expect(f).toMatch(/ISIAN_TIDAK_DITEMUKAN/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.pendataan_khusus_urutkan\(uuid, uuid\[\]\) TO authenticated/);
  });

  it('peta jawaban untuk rekap: SECURITY INVOKER (RLS = lingkup ketat), satu nilai jsonb, tanpa definer', () => {
    const f = fungsi('pendataan_khusus_peta');
    expect(f).toMatch(/STABLE\s+SECURITY INVOKER\s+SET search_path = pg_catalog, public/);
    expect(f).toMatch(/FROM public\.pendataan_khusus_jawaban AS j\s+WHERE j\.penanganan_id = ANY\(p_penanganan\)/);
    expect(f).not.toMatch(/SECURITY DEFINER/);
    expect(bare).toMatch(/GRANT EXECUTE ON FUNCTION public\.pendataan_khusus_peta\(uuid\[\]\) TO authenticated/);
  });
});
