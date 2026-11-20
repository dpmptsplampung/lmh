// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync('supabase/migrations/202611190003_investasi_dokumen_proses.sql', 'utf8');
describe('proses dokumen investasi', () => {
  it('memperluas status dan menyimpan kemajuan serta galat terbatas', () => {
    expect(sql).toContain('DROP CONSTRAINT investment_documents_status_check');
    expect(sql).toContain("CHECK (status IN ('diproses','aktif','nonaktif','gagal'))");
    expect(sql).toContain('halaman_selesai integer NOT NULL DEFAULT 0');
    expect(sql).toContain('char_length(galat) <= 500');
    expect(sql).toContain('diproses_pada timestamptz');
  });
  it('menambah policy modul; policy admin dan publik dipertahankan', () => {
    expect(sql).toContain('FOR ALL TO authenticated');
    expect(sql).toContain('USING ((SELECT public.boleh_kelola_investasi()))');
    expect(sql).toContain('WITH CHECK ((SELECT public.boleh_kelola_investasi()))');
    expect(sql).not.toMatch(/DROP POLICY|CREATE FUNCTION|\bBEGIN\b|\bCOMMIT\b/);
  });
});

describe('tombstone konsumsi PDF', () => {
  it('kunci unik, pemilik dari sesi dan catatan tidak terhapus bersama dokumen', () => {
    expect(sql).toContain('CREATE TABLE public.investment_pdf_claims');
    expect(sql).toContain('kunci text PRIMARY KEY');
    expect(sql).toContain('DEFAULT auth.uid()');
    expect(sql).toContain("split_part(kunci, '/', 3) = pengunggah_uid::text");
    expect(sql).not.toContain('REFERENCES public.investment_documents');
  });
  it('RLS dan izin kolom hanya mengizinkan konsumsi dan pembacaan kunci sendiri', () => {
    expect(sql).toContain('ALTER TABLE public.investment_pdf_claims ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON public.investment_pdf_claims FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT SELECT (kunci), INSERT (kunci)');
    expect(sql).toContain('pengunggah_uid = (SELECT auth.uid()) AND (SELECT public.boleh_kelola_investasi())');
  });
});
