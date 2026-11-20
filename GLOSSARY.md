# Lampung Maju Hub

Portal pendamping pelayanan DPMPTSP Provinsi Lampung: memfasilitasi pengunjung dan petugas, memantau pelayanan, dan mendata pelayanan. Proses perizinan dan layanan itu sendiri tetap berjalan di sistem resmi masing-masing instansi.

## Bahasa

### Kelembagaan dan layanan

**Instansi**:
Lembaga pemilik satu atau lebih Layanan yang hadir di kantor DPMPTSP, misalnya DPMPTSP sendiri, Balmon, BPJS Kesehatan, atau Bank Lampung.
_Hindari_: penyerta, lembaga, unit

**Layanan**:
Satu titik pelayanan di kantor yang dijalankan oleh satu Instansi, dengan deskripsi, jadwal, antrean, dan daftar website terkait (termasuk Sistem Resmi) miliknya sendiri.
_Hindari_: gerai, unit layanan

**Sistem Resmi**:
Aplikasi atau website milik Instansi tempat permohonan benar-benar diproses, misalnya OSS RBA atau SiCantik.
_Hindari_: sistem eksternal, aplikasi pihak ketiga

**Layanan Arsip**:
Layanan yang sudah tidak melayani dan tidak tampil di mana pun, tetapi riwayat pelayanannya tetap tersimpan.
_Hindari_: layanan dihapus, layanan nonaktif

### Petugas

**Front Office**:
Petugas yang mendaftarkan pengunjung dan mengawasi serta mengelola antrean semua Layanan; bukan petugas sebuah Layanan.
_Hindari_: FO sebagai layanan, resepsionis

**Petugas Layanan**:
Petugas yang melayani pengunjung di satu Layanan tertentu.
_Hindari_: petugas mitra (untuk peran ini)

**Koordinator**:
Penanda pada akun Front Office atau Petugas Layanan yang memberi hak melihat dan mengunduh semua data unitnya, serta mengambil alih pendataan yang sedang berjalan; bukan role tersendiri.
_Hindari_: pengelola rekap, backoffice, supervisor

### Pendataan

**Pendataan Umum**:
Data yang dicatat untuk setiap pelayanan, sama untuk semua Layanan: identitas pengunjung (dicatat sekali oleh Front Office, atau dari profil pengunjung chat), topik, dan catatan petugas.
_Hindari_: data kunjungan dasar

**Pendataan Khusus**:
Data tambahan yang dicatat petugas untuk satu Layanan tertentu; isiannya berbeda per Layanan dan ditentukan oleh admin (tujuh jenis isian, tanpa unggah berkas). Helpdesk OSS dan Non OSS tidak memakainya: keduanya punya formulir tetap.
_Hindari_: pendataan eksplisit, form OSS, form perizinan

**Topik**:
Pilihan jenis persoalan per Layanan (dikelola admin) yang dipilih petugas saat menutup pelayanan; bagian dari Pendataan Umum.
_Hindari_: kategori penanganan

### Live chat

**Percakapan**:
Satu rangkaian pesan tetap antara seorang pengunjung dan satu Layanan, seperti satu kontak di WhatsApp; berisi seluruh riwayat dari semua sesi. Sesi per kunjungan dicatat di belakang layar untuk rekap.
_Hindari_: sesi chat (untuk pengertian ini), thread

### Investasi

**IPRO**:
Investment Project Ready to Offer: proyek investasi daerah yang siap ditawarkan dan dikelola sendiri oleh PTSP, dengan halaman detail, galeri gambar, angka kunci, dokumen kajian, dan kontak lembaga. Disimpan di `ipro_proyek` dengan `sumber = 'ptsp'`. Bahasa Inggris belum punya antarmuka.
_Hindari_: proyek FOILA (untuk pengertian ini), listing investasi

**FOILA**:
Portal investasi Provinsi Lampung (`invest.lampungprov.go.id`) yang dikelola PTSP tetapi lama tidak diperbarui. LMH hanya menampilkan Kartu FOILA yang menaut keluar; konten FOILA tidak dipakai sebagai sumber chatbot.
_Hindari_: IPRO (untuk entri FOILA)

**Kartu FOILA**:
Cuplikan satu proyek FOILA di hub `/investasi` (judul, ringkasan, sektor, kabupaten/kota, nilai dalam teks bebas, satu gambar) yang diisi manual oleh pengelola dan menaut ke FOILA. Tidak punya halaman detail. Disimpan di `ipro_proyek` dengan `sumber = 'foila'`.
_Hindari_: IPRO FOILA, salinan FOILA

**Kotak Masuk Investasi**:
Satu daftar pesan minat investasi dari pengunjung, baik dari tombol "Hubungi petugas" pada IPRO maupun dari formulir dokumen Investment Gallery. Dikelola admin dan petugas bermodul `investasi` (Front Office tidak); pesan dihapus 365 hari setelah selesai atau ditolak. Disimpan di `investasi_lead` dengan kolom `kanal`.
_Hindari_: lead investasi, inbox

**Paket B**:
Bagian pekerjaan Investment Gallery untuk dokumen PDF besar: unggah langsung ke R2 lewat presigned PUT, lalu render halaman PNG ber-watermark per batch. Petugas bermodul `investasi` ikut mengelolanya. Bukan rilis atau tier produk.
_Hindari_: upload PDF lama (route multipart yang sudah dihapus)
