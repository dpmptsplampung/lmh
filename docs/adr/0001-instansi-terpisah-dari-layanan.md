# Instansi dipisah dari Layanan

Sebelumnya satu baris `layanan` mencampur dua hal: lembaga pemilik (DPMPTSP, Balmon, BPJS Kesehatan, Bank Lampung) dan titik pelayanan yang punya antrean. DPMPTSP sendiri menjalankan beberapa Layanan (Helpdesk OSS, Non OSS, Investment Gallery, Matchmaking UMKM), sementara tautan resmi melekat ke Layanan, bukan lembaga (Helpdesk OSS → oss.go.id, padahal instansinya DPMPTSP). Kami memisahkan **Instansi** sebagai entitas sendiri yang dirujuk setiap Layanan, dan menaruh deskripsi, jadwal, antrean, serta daftar website terkait di Layanan. Alternatif "semua kolom di `layanan`" ditolak karena data lembaga akan berulang dan tidak konsisten antar-Layanan milik instansi yang sama.

Kolom lama `layanan.penyerta` (`dpmptsp`/`p4`) dan `layanan.tipe` tidak dipakai untuk memodelkan instansi; keduanya dibiarkan apa adanya karena data lama tidak boleh diubah (spesifikasi B1).
