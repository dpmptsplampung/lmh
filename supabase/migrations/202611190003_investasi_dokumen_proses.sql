-- Proses dokumen per batch; pembacaan publik tetap hanya status aktif.
ALTER TABLE public.investment_documents
  DROP CONSTRAINT investment_documents_status_check,
  ADD CONSTRAINT investment_documents_status_check CHECK (status IN ('diproses','aktif','nonaktif','gagal')),
  ADD COLUMN halaman_selesai integer NOT NULL DEFAULT 0,
  ADD COLUMN galat text CHECK (char_length(galat) <= 500),
  ADD COLUMN diproses_pada timestamptz;

CREATE POLICY investment_kelola_modul ON public.investment_documents
  FOR ALL TO authenticated
  USING ((SELECT public.boleh_kelola_investasi()))
  WITH CHECK ((SELECT public.boleh_kelola_investasi()));

-- Tombstone konsumsi unggahan: tidak mengikuti umur dokumen, agar raw yang di-PUT ulang tidak dapat didaftarkan lagi.
CREATE TABLE public.investment_pdf_claims (
  kunci text PRIMARY KEY CHECK (kunci ~ '^investment-docs/raw/[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'),
  pengunggah_uid uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT investment_pdf_claims_pemilik CHECK (split_part(kunci, '/', 3) = pengunggah_uid::text)
);
ALTER TABLE public.investment_pdf_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investment_pdf_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT (kunci), INSERT (kunci) ON public.investment_pdf_claims TO authenticated;
CREATE POLICY investment_pdf_claims_baca ON public.investment_pdf_claims
  FOR SELECT TO authenticated
  USING (pengunggah_uid = (SELECT auth.uid()) AND (SELECT public.boleh_kelola_investasi()));
CREATE POLICY investment_pdf_claims_konsumsi ON public.investment_pdf_claims
  FOR INSERT TO authenticated
  WITH CHECK (pengunggah_uid = (SELECT auth.uid()) AND (SELECT public.boleh_kelola_investasi()));
