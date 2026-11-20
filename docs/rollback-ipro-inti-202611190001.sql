-- Rollback operasional inti IPRO; belum dijalankan di staging/produksi.
-- Hanya pemilik DB menjalankan dalam satu transaksi setelah aplikasi IPRO dinonaktifkan.
-- Tutup paket lanjutan lebih dahulu, kemudian rollback Kotak Masuk Investasi 202611190002.
-- Pertahankan proyek, gambar, kunci objek, trigger audit, FK dan seluruh riwayat.
DO $$
BEGIN
  IF to_regprocedure('public.investasi_kirim_minat(text,uuid,text,text,text,text,text,boolean,text,uuid)') IS NOT NULL
    OR to_regprocedure('public.investasi_ubah_status_minat(uuid,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback Kotak Masuk Investasi 202611190002 terlebih dahulu';
  END IF;
END $$;
REVOKE ALL ON TABLE public.ipro_proyek, public.ipro_gambar FROM PUBLIC, anon, authenticated;
-- Hak tingkat kolom tetap ada setelah REVOKE tingkat tabel; cabut keduanya.
REVOKE SELECT (
  id, sumber, status, slug, judul, judul_en, ringkasan, ringkasan_en,
  deskripsi, deskripsi_en, sektor, kab_kota, lokasi_teks, lat, lng, pemilik,
  nilai_investasi, mata_uang, nilai_teks, irr_persen, npv_nilai, payback_bulan,
  skema, status_lahan, luas_ha, tahap_kajian, perizinan, dokumen_id,
  kontak_instansi, kontak_email, kontak_telepon, sumber_url, sumber_slug,
  urutan, diterbitkan_pada, versi, dibuat_pada, diubah_pada
) ON TABLE public.ipro_proyek FROM PUBLIC, anon, authenticated;
REVOKE SELECT (
  id, proyek_id, kunci, kunci_mini, lebar, tinggi, alt, alt_en,
  keterangan, keterangan_en, utama, urutan, dibuat_pada
) ON TABLE public.ipro_gambar FROM PUBLIC, anon, authenticated;
-- Helper boleh_kelola_investasi tetap ada untuk RLS baca lead yang disimpan; tidak ada akses publik IPRO.
-- Pengaktifan kembali lewat migrasi maju baru, bukan mengulang atau mengedit migrasi lama.
NOTIFY pgrst, 'reload schema';
