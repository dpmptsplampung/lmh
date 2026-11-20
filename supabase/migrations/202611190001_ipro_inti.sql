-- IPRO PTSP dan kartu FOILA. Prasyarat: 202611160001_lingkup_layanan_staf.
DO $$
BEGIN
  IF to_regprocedure('public.staf_modul()') IS NULL
    OR to_regprocedure('public.sesi_valid()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202611160001_lingkup_layanan_staf wajib tersedia';
  END IF;
END $$;

CREATE FUNCTION public.boleh_kelola_investasi() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT coalesce(
    (public.get_my_role() = 'admin' AND public.sesi_valid())
    OR public.staf_modul() = 'investasi', false)
$$;
REVOKE ALL ON FUNCTION public.boleh_kelola_investasi() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kelola_investasi() TO authenticated;

CREATE TABLE public.ipro_proyek (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sumber text NOT NULL CHECK (sumber IN ('ptsp', 'foila')),
  status text NOT NULL DEFAULT 'draf' CHECK (status IN ('draf', 'terbit', 'arsip')),
  slug text NOT NULL UNIQUE CHECK (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 120),
  judul text NOT NULL CHECK (char_length(btrim(judul)) BETWEEN 3 AND 200),
  judul_en text CHECK (char_length(btrim(judul_en)) BETWEEN 3 AND 200),
  ringkasan text NOT NULL CHECK (char_length(btrim(ringkasan)) BETWEEN 1 AND 600),
  ringkasan_en text CHECK (char_length(btrim(ringkasan_en)) BETWEEN 1 AND 600),
  deskripsi text CHECK (char_length(deskripsi) <= 20000),
  deskripsi_en text CHECK (char_length(deskripsi_en) <= 20000),
  -- Daftar tetap memakai CHECK seperti enum teks UMKM; penambahan nilai lewat migrasi maju.
  sektor text NOT NULL CHECK (sektor IN (
    'pertanian', 'perikanan', 'pariwisata', 'industri', 'energi', 'infrastruktur', 'kawasan', 'jasa', 'lainnya')),
  kab_kota text NOT NULL CHECK (char_length(btrim(kab_kota)) BETWEEN 3 AND 60),
  lokasi_teks text CHECK (char_length(lokasi_teks) <= 300),
  lat numeric(9,6) CHECK (lat BETWEEN -6.6 AND -3.0),
  lng numeric(9,6) CHECK (lng BETWEEN 103.0 AND 106.6),
  pemilik text CHECK (char_length(pemilik) <= 200),
  nilai_investasi numeric(18,0) CHECK (nilai_investasi >= 0),
  mata_uang text NOT NULL DEFAULT 'IDR' CHECK (mata_uang IN ('IDR', 'USD')),
  nilai_teks text CHECK (char_length(nilai_teks) <= 200),
  irr_persen numeric(6,2) CHECK (irr_persen BETWEEN -100 AND 1000),
  npv_nilai numeric(18,0),
  payback_bulan integer CHECK (payback_bulan BETWEEN 1 AND 600),
  skema text CHECK (skema IN ('kpbu', 'b2b', 'bumd', 'swasta_penuh', 'lainnya')),
  status_lahan text CHECK (status_lahan IN (
    'milik_pemda', 'milik_bumn_bumd', 'milik_swasta', 'milik_masyarakat', 'belum_ditetapkan')),
  luas_ha numeric(12,2) CHECK (luas_ha > 0),
  tahap_kajian text CHECK (tahap_kajian IN ('pra_fs', 'fs', 'ipro')),
  perizinan text CHECK (char_length(perizinan) <= 2000),
  dokumen_id uuid REFERENCES public.investment_documents(id) ON DELETE SET NULL,
  kontak_instansi text CHECK (char_length(kontak_instansi) <= 200),
  kontak_email text CHECK (char_length(kontak_email) <= 254
    AND kontak_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  kontak_telepon text CHECK (kontak_telepon ~ '^\+?[0-9][0-9 \-]{5,19}$'),
  sumber_url text CHECK (char_length(sumber_url) <= 2048),
  sumber_slug text CHECK (char_length(sumber_slug) <= 300),
  urutan integer NOT NULL DEFAULT 0,
  diterbitkan_pada timestamptz,
  versi integer NOT NULL DEFAULT 1 CHECK (versi > 0),
  dibuat_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  diubah_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  dibuat_pada timestamptz NOT NULL DEFAULT now(),
  diubah_pada timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ipro_koordinat_berpasangan CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT ipro_sumber_sah CHECK (
    (sumber = 'ptsp' AND sumber_url IS NULL AND sumber_slug IS NULL)
    OR (sumber = 'foila' AND sumber_url IS NOT NULL
      AND sumber_url ~ '^https://invest\.lampungprov\.go\.id/[^[:space:]]*$'
      AND deskripsi IS NULL AND deskripsi_en IS NULL AND dokumen_id IS NULL
      AND kontak_instansi IS NULL AND kontak_email IS NULL AND kontak_telepon IS NULL)),
  CONSTRAINT ipro_terbit_bertanggal CHECK (status <> 'terbit' OR diterbitkan_pada IS NOT NULL)
);
COMMENT ON COLUMN public.ipro_proyek.kontak_instansi IS 'Kontak lembaga untuk publik; bukan identitas pribadi petugas.';
COMMENT ON COLUMN public.ipro_proyek.kontak_email IS 'Alamat email lembaga untuk publik; dilarang mengisi email pribadi petugas.';
COMMENT ON COLUMN public.ipro_proyek.kontak_telepon IS 'Nomor telepon lembaga untuk publik; dilarang mengisi nomor pribadi petugas.';
COMMENT ON COLUMN public.ipro_proyek.nilai_investasi IS 'Nilai numerik IPRO dalam mata_uang; Rupiah atau Dolar AS, tanpa konversi otomatis.';
COMMENT ON COLUMN public.ipro_proyek.npv_nilai IS 'NPV numerik, boleh negatif; satuannya sama dengan mata_uang baris (IDR atau USD).';
COMMENT ON COLUMN public.ipro_proyek.nilai_teks IS 'Label nilai FOILA apa adanya, termasuk mata uang campuran; tidak diparse menjadi angka.';

CREATE INDEX ipro_publik_urut ON public.ipro_proyek(status, sumber, urutan, diterbitkan_pada DESC)
  WHERE status = 'terbit';
CREATE INDEX ipro_sektor ON public.ipro_proyek(sektor) WHERE status = 'terbit';
CREATE INDEX ipro_kab_kota ON public.ipro_proyek(kab_kota) WHERE status = 'terbit';
CREATE UNIQUE INDEX ipro_foila_unik ON public.ipro_proyek(sumber_slug)
  WHERE sumber = 'foila' AND sumber_slug IS NOT NULL;
CREATE INDEX ipro_dokumen ON public.ipro_proyek(dokumen_id);
CREATE INDEX ipro_pembuat ON public.ipro_proyek(dibuat_oleh);
CREATE INDEX ipro_pengubah ON public.ipro_proyek(diubah_oleh);

CREATE TABLE public.ipro_gambar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proyek_id uuid NOT NULL REFERENCES public.ipro_proyek(id) ON DELETE CASCADE,
  kunci text NOT NULL UNIQUE CHECK (kunci ~ '^ipro-gambar/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'),
  kunci_mini text NOT NULL UNIQUE CHECK (kunci_mini ~ '^ipro-gambar/[0-9a-f-]{36}/[0-9a-f-]{36}-640\.webp$'),
  lebar integer NOT NULL CHECK (lebar BETWEEN 1 AND 4000),
  tinggi integer NOT NULL CHECK (tinggi BETWEEN 1 AND 4000),
  alt text NOT NULL CHECK (char_length(btrim(alt)) BETWEEN 3 AND 200),
  alt_en text CHECK (char_length(btrim(alt_en)) BETWEEN 3 AND 200),
  keterangan text CHECK (char_length(keterangan) <= 300),
  keterangan_en text CHECK (char_length(keterangan_en) <= 300),
  utama boolean NOT NULL DEFAULT false,
  urutan integer NOT NULL DEFAULT 0,
  dibuat_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  dibuat_pada timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ipro_gambar_satu_utama ON public.ipro_gambar(proyek_id) WHERE utama;
CREATE INDEX ipro_gambar_proyek ON public.ipro_gambar(proyek_id, urutan);
CREATE INDEX ipro_gambar_pembuat ON public.ipro_gambar(dibuat_oleh);

CREATE FUNCTION public.ipro_isi_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_petugas uuid;
BEGIN
  SELECT p.id INTO v_petugas FROM public.petugas AS p
    WHERE p.auth_user_id = auth.uid() AND p.aktif;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sumber IS DISTINCT FROM OLD.sumber THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE = '22023';
    END IF;
    IF OLD.diterbitkan_pada IS NOT NULL AND NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'SLUG_TERKUNCI' USING ERRCODE = '22023';
    END IF;
    NEW.versi := OLD.versi + 1;
    NEW.dibuat_oleh := OLD.dibuat_oleh;
    -- Pertahankan pembuat selama akun masih ada; jangan mengalahkan FK ON DELETE SET NULL.
    -- OLD NULL tetap NULL sehingga klien tidak bisa mengisi ulang pembuat lewat UPDATE.
    IF NOT EXISTS (SELECT 1 FROM public.petugas AS p WHERE p.id = OLD.dibuat_oleh) THEN
      NEW.dibuat_oleh := NULL;
    END IF;
    NEW.dibuat_pada := OLD.dibuat_pada;
    -- Riwayat terbit tidak dapat dihapus untuk mengakali penguncian slug.
    NEW.diterbitkan_pada := OLD.diterbitkan_pada;
  ELSE
    NEW.versi := 1;
    NEW.dibuat_oleh := v_petugas;
    NEW.dibuat_pada := now();
    NEW.diterbitkan_pada := NULL;
  END IF;
  NEW.diubah_oleh := v_petugas;
  NEW.diubah_pada := now();
  IF NEW.status = 'terbit' AND NEW.diterbitkan_pada IS NULL THEN
    NEW.diterbitkan_pada := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ipro_isi_audit() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER ipro_isi_audit BEFORE INSERT OR UPDATE ON public.ipro_proyek
  FOR EACH ROW EXECUTE FUNCTION public.ipro_isi_audit();
CREATE TRIGGER ipro_audit_status AFTER UPDATE OF status ON public.ipro_proyek
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('update_status');

ALTER TABLE public.ipro_proyek ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ipro_gambar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ipro_proyek, public.ipro_gambar FROM PUBLIC, anon, authenticated;
-- UUID staf hanya untuk audit internal; riwayat pengubah tersedia lewat audit_log.
-- PostgREST select=* sengaja gagal: lapisan data wajib memakai kolom eksplisit,
-- termasuk RETURNING setelah INSERT/UPDATE/DELETE (aturan repo melarang select('*')).
GRANT SELECT (
  id, sumber, status, slug, judul, judul_en, ringkasan, ringkasan_en,
  deskripsi, deskripsi_en, sektor, kab_kota, lokasi_teks, lat, lng, pemilik,
  nilai_investasi, mata_uang, nilai_teks, irr_persen, npv_nilai, payback_bulan,
  skema, status_lahan, luas_ha, tahap_kajian, perizinan, dokumen_id,
  kontak_instansi, kontak_email, kontak_telepon, sumber_url, sumber_slug,
  urutan, diterbitkan_pada, versi, dibuat_pada, diubah_pada
) ON TABLE public.ipro_proyek TO anon, authenticated;
GRANT SELECT (
  id, proyek_id, kunci, kunci_mini, lebar, tinggi, alt, alt_en,
  keterangan, keterangan_en, utama, urutan, dibuat_pada
) ON TABLE public.ipro_gambar TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.ipro_proyek, public.ipro_gambar TO authenticated;

CREATE POLICY ipro_publik_baca ON public.ipro_proyek FOR SELECT TO anon, authenticated
  USING (status = 'terbit');
CREATE POLICY ipro_kelola_baca ON public.ipro_proyek FOR SELECT TO authenticated
  USING ((SELECT public.boleh_kelola_investasi()));
CREATE POLICY ipro_kelola_tambah ON public.ipro_proyek FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.boleh_kelola_investasi()));
CREATE POLICY ipro_kelola_ubah ON public.ipro_proyek FOR UPDATE TO authenticated
  USING ((SELECT public.boleh_kelola_investasi()))
  WITH CHECK ((SELECT public.boleh_kelola_investasi()));
CREATE POLICY ipro_kelola_hapus ON public.ipro_proyek FOR DELETE TO authenticated
  USING ((SELECT public.boleh_kelola_investasi()) AND status = 'draf');
CREATE POLICY ipro_gambar_publik ON public.ipro_gambar FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.ipro_proyek AS p WHERE p.id = proyek_id AND p.status = 'terbit'));
CREATE POLICY ipro_gambar_kelola ON public.ipro_gambar FOR ALL TO authenticated
  USING ((SELECT public.boleh_kelola_investasi()))
  WITH CHECK ((SELECT public.boleh_kelola_investasi()));
