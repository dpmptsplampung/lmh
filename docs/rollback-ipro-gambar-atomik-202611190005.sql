-- Rollback operasional; BELUM DIJALANKAN di staging/produksi.
-- Pemilik menjalankan dalam satu transaksi setelah fitur mutasi IPRO dinonaktifkan.
-- Pertahankan data, objek R2, trigger penjaga terbit, dan penutupan penulisan gambar langsung.
-- Jangan mengembalikan grant lama: itu membuka lagi balapan reset utama/jumlah/publish.
REVOKE ALL ON FUNCTION public.ipro_tambah_gambar(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ipro_ubah_gambar(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ipro_hapus_gambar(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ipro_ubah_status(uuid,text,integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ipro_gambar FROM PUBLIC, anon, authenticated;
-- Pengaktifan kembali harus lewat migrasi maju dan klien RPC yang telah diverifikasi.
NOTIFY pgrst, 'reload schema';
