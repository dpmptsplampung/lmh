-- Rollback operasional G1. BUKAN migrasi maju dan belum dijalankan pada produksi.
-- Menutup RPC UMKM dan melepas pemicu penjaga penanda, mempertahankan data serta bukti izin/riwayat.
-- Hentikan bila G2 sudah terpasang: rollback gelombang berikutnya lebih dahulu.
-- Batas: route presign/konfirmasi R2 umkm-draf tetap tersedia untuk akun aktif berpenanda dan sesi valid.
-- Nilai penanda tidak dikosongkan; perubahan langsung kembali mungkin setelah pemicu penjaga dilepas.
-- Pencabutan otomatis saat role/auth_user_id berubah berhenti; audit perubahan tetap dipertahankan.
-- Rollback ini tidak menutup unggah draf atau mengembalikan seluruh perilaku petugas ke sebelum G1.
DO $$
BEGIN
  IF to_regprocedure('public.umkm_kirim_pesan_kontak(text,text,text,text,uuid)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('umkm_cari_katalog','umkm_tindakan_darurat')) THEN
    RAISE EXCEPTION 'Rollback gelombang UMKM berikutnya terlebih dahulu';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.umkm_simpan_profil(jsonb,uuid,uuid,integer);
DROP FUNCTION IF EXISTS public.umkm_ambil_tugas(uuid,integer,uuid);
DROP FUNCTION IF EXISTS public.umkm_putuskan_profil(uuid,integer,uuid,text,text);
DROP FUNCTION IF EXISTS public.umkm_ubah_visibilitas(uuid,integer,uuid,text,uuid);
DROP FUNCTION IF EXISTS public.umkm_ubah_izin(uuid,integer,uuid,text);
DROP FUNCTION IF EXISTS public.umkm_atur_pemeriksa(uuid,boolean,uuid);
DROP FUNCTION IF EXISTS public.umkm_detail_tugas(uuid);
DROP FUNCTION IF EXISTS public.umkm_daftar_tugas(uuid);
DROP FUNCTION IF EXISTS public.umkm_cari_profil(text,uuid);
DROP FUNCTION IF EXISTS public.umkm_akses_kontak_petugas(uuid);
DROP FUNCTION IF EXISTS public.umkm_profil_publik(uuid);
DROP TRIGGER IF EXISTS umkm_jaga_penanda ON public.petugas;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC, anon, authenticated;
-- Tabel privat, flag, rahasia HMAC dan fungsi internal ditahan; tidak ada penghapusan bukti.
-- Klien RPC UMKM memperoleh MODUL_BELUM_TERSEDIA (503), daftar akun dan jalur unggah tetap tersedia.
-- Pengaktifan kembali dilakukan dengan migrasi maju baru, bukan mengubah atau menjalankan ulang baseline.
NOTIFY pgrst, 'reload schema';
