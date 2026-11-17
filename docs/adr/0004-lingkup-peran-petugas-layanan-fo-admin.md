# Lingkup peran: Petugas Layanan per Layanan, FO membaca semua, modul berbasis Layanan

Menggantikan sebagian [ADR 0003](0003-koordinator-dan-akses-data-per-orang.md). Pada 2026-11-16 pemilik menegaskan bahwa Petugas Layanan bukan admin dan bukan Front Office.

- **Petugas Layanan** terikat satu Layanan (`petugas.layanan_id`). Ia melihat, mengerjakan, dan merekap SELURUH data Layanannya, tidak Layanan lain. Penanda Koordinator tidak lagi memperluas hak baca; ia hanya mempertahankan hak ambil alih pendataan.
- **Front Office** membaca semua data antrean dan semua Layanan (baca-saja, tidak mengubah data layanan). Pengecualian disengaja: koreksi data layanan terkunci lewat `koreksi_pelayanan` tetap tersedia bagi FO dan admin. Akses lintas-pembuat ke data pelayanan HANYA lewat RPC `lihat_data_pelayanan` yang mencatat `audit_log`; baca langsung tabel oleh FO tetap mengikuti aturan basis (pembuat, koordinator).
- **Modul Layanan**: `layanan.modul` (`umkm`, `investasi`) menentukan fitur khusus. Petugas di Layanan bermodul otomatis mendapat fiturnya; penanda manual `pemeriksa_umkm` dihentikan (RPC `umkm_atur_pemeriksa` ditolak).
- **Rute**: Petugas Layanan memakai `/petugas/*`; admin dan FO tetap `/admin/*`. `proxy.ts` menegakkan otorisasi rute di server (fail-closed) dan mengalihkan tautan lama.
- **Pendataan Khusus** menjadi langkah saat Mulai Layanan (data FO, lalu isian khusus; draf tersimpan), dan ekspor memakai definisi terbaru.

## Consequences

Ekspor dan "Lihat Data" oleh FO memuat PII lintas pembuat, sehingga wajib diaudit dan gagal-tertutup bila audit gagal; `docs/KEBIJAKAN_PDP.md` harus selaras. Satu helper SQL (`lingkup_layanan_saya()`) menjadi sumber tunggal lingkup; fungsi `boleh_*` dan rekap tidak boleh menyalin logika sendiri.
