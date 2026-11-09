-- Rollback operasional G2 tiket 04, belum dijalankan pada staging/produksi.
-- Tutup 0004 dan 0003 dahulu. Bukti unggah, pointer, antrean hapus dan semua tabel tetap tersedia.
DO $$
BEGIN
  IF to_regprocedure('public.umkm_kirim_pesan_kontak(text,text,text,text,uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback pesan dan laporan UMKM lebih dahulu'; END IF;
END $$;
CREATE OR REPLACE FUNCTION umkm_private.ada_kontak(p_teks text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE teks text; kelompok text[]; grup text[]; sisa text; i integer;
BEGIN
  teks := translate(normalize(coalesce(p_teks,''), NFKC),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९', '012345678901234567890123456789');
  FOR i IN 0..9 LOOP teks := replace(teks, '%3' || i::text, i::text); END LOOP;
  IF teks ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,}|tel:|mailto:'
    OR teks ~* 'wa[[:space:]]*[.][[:space:]]*(me|link)|whatsapp[[:space:]]*[.][[:space:]]*com'
    OR teks ~* 't[[:space:]]*[.][[:space:]]*me|linktr[[:space:]]*[.][[:space:]]*ee' THEN
    RETURN true;
  END IF;
  FOR kelompok IN SELECT regexp_matches(teks, '[0-9]+(?:[^[:alnum:]]{1,3}[0-9]+)*', 'g') LOOP
    grup := regexp_split_to_array(kelompok[1], '[^0-9]+');
    sisa := '';
    FOR i IN REVERSE array_length(grup,1)..1 LOOP
      sisa := grup[i] || sisa;
      EXIT WHEN length(sisa) > 15;
      IF length(sisa) >= 9 AND sisa ~ '^(0[1-9]|62|8[1-9])' THEN RETURN true; END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END $$;

DROP FUNCTION IF EXISTS public.umkm_cari_katalog(text,text,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.umkm_filter_katalog();
DROP FUNCTION IF EXISTS public.umkm_profil_publik(uuid);
DROP FUNCTION IF EXISTS public.umkm_bukti_foto(uuid,uuid,text,bigint,text);
DROP FUNCTION IF EXISTS public.umkm_rencana_foto(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.umkm_terbitkan_foto(uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.umkm_antrian_hapus_foto(uuid);
DROP FUNCTION IF EXISTS public.umkm_selesai_hapus_foto(uuid);
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC, anon, authenticated, service_role;
-- Proyeksi katalog ditutup (503); kartu cache lama dapat bertahan sampai TTL 60 detik.
-- Pemicu hide tetap menjaga pointer dan antrean, tetapi retry R2 ditutup oleh rollback ini.
-- Skrip ini tidak menghapus objek R2/CDN; objek yang sudah diketahui perlu ditangani operator penyimpanan.
-- Rencana salin tersimpan tetap ditahan; RPC rencana ditutup dan ada_kontak dipulihkan ke G1.
-- Detail pemeriksa G1 tetap tersedia; tambahan kolom tidak dibuang dan tidak memberi hak tabel langsung.
-- Pengaktifan ulang melalui migrasi maju baru, bukan mengedit atau mengulang migrasi ini.
NOTIFY pgrst, 'reload schema';
