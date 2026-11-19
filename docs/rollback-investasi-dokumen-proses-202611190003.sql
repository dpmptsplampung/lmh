-- Hanya setelah semua dokumen diproses/gagal ditangani pemilik; constraint menolak rollback yang menghilangkan status.
DROP POLICY IF EXISTS investment_kelola_modul ON public.investment_documents;
ALTER TABLE public.investment_documents
  DROP CONSTRAINT investment_documents_status_check,
  ADD CONSTRAINT investment_documents_status_check CHECK (status IN ('aktif','nonaktif')),
  DROP COLUMN halaman_selesai,
  DROP COLUMN galat,
  DROP COLUMN diproses_pada;

-- Menghapus tombstone memungkinkan unggahan lama dipakai lagi; pastikan raw/ telah direkonsiliasi dahulu.
DROP TABLE public.investment_pdf_claims;
