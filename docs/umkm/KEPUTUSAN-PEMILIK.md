# Keputusan pemilik: fitur UMKM

Sumber kebenaran P-01 sampai P-40 (nomor keputusan = nomor P). Bagian di bawah disalin apa adanya; bila ada teks yang bertentangan, keputusan bernomor lebih besar yang berlaku.

## 3. Keputusan pemilik (sumber kebenaran; kutip di dokumen, jangan diubah)

1. Pendaftar UMKM baru: disimpan privat (pending) sampai petugas memeriksa manual, baru dipublikasikan.
2. Data perusahaan singkat, ditambah daftar kebutuhan (boleh lebih dari satu kebutuhan, dan lebih dari satu UMKM per kebutuhan).
3. NIB bukan syarat masuk. UMKM tanpa NIB didorong mengurusnya.
4. Nomor WhatsApp UMKM tidak boleh tampil publik atau diakses langsung. SEMUA permintaan nomor diperiksa petugas UMKM. Setelah disetujui, petugas front office (FO) mengirim nomor lewat WhatsApp resmi instansi, setelah memeriksa ulang izin UMKM. Tidak ada jalur otomatis.
5. Pemeriksaan UMKM dan perusahaan: manual, petugas yang menentukan. Petugas pemeriksa banyak dan boleh bergantian. FO siaga jam kerja (08.00-16.00), merespons dalam 1 hari.
6. Waktu petugas UMKM: perkiraan 1-2 hari kerja per minggu (asumsi, bukan jaminan).
7. Target waktu: "secepatnya", tanpa angka yang dijanjikan ke pengguna. Antrean tertua dan lengkap dikerjakan lebih dulu; hal mendesak (pencabutan izin, laporan penipuan) didahulukan.
8. Tahap A (katalog + alat kerja petugas/FO), B (data perusahaan, kebutuhan, persetujuan kontak, pembagian nomor), C (UMKM mendaftar/mengedit sendiri, tetap privat sampai diperiksa): DISETUJUI.
9. Foto: sumber bebas (tautan luar tanpa daftar situs) atau diunggah ke LMH (Cloudflare R2). Foto satudata TIDAK disalin ke R2; tampil dari tautan. Supabase Storage tidak menerima berkas foto UMKM baru. Mengganti tautan foto berarti diperiksa ulang; ada tombol laporkan dan petugas bisa menyembunyikan foto.
10. Nomor yang sudah dikirim FO boleh tampil lagi di akun pemohon (hanya setelah login, tidak di cache/log).
11. Marketplace lama tetap berjalan berdampingan.
12. Vercel dan Supabase free tier: sistem harus ringan; pencarian, aturan izin, dan catatan keputusan dikerjakan di database; hasil 20 per halaman; cache katalog tanpa nomor.
13. Paket Vercel sudah dicek pemilik dan tidak bermasalah.
14. (Ditambah kemudian) Data UMKM boleh punya tautan TikTok dan/atau Instagram, OPSIONAL. Bila ada, tampil di katalog; bila tidak ada, tidak tampil sama sekali (tanpa kotak kosong). Ini berarti ada sedikit penyesuaian pada data UMKM.
15. (Ditambah setelah audit, 2026-11-06) Angka "diminati perusahaan" TIDAK dipakai dalam rumus peringkat. Angka itu tetap boleh dihitung untuk laporan petugas.
16. (Ditambah setelah audit) FO boleh memakai satu akses khusus yang tercatat untuk melihat nomor UMKM, hanya untuk meminta izin UMKM dan mengirim nomor yang sudah disetujui petugas.
17. (Ditambah setelah audit) Tahap A hanya memberi katalog, tautan profil, dan alat kerja petugas/FO. Pembagian nomor baru berjalan bila tiga hal bisa dicatat: keputusan petugas, izin UMKM terbaru, dan pengiriman oleh FO. Ini tidak mengubah keputusan 8.
18. (Ditambah setelah audit) Target jumlah profil UMKM di katalog: paling banyak 10.000. Angka ini batas atas, bukan jumlah yang harus tercapai sebelum rilis. Waktu pemeriksaan per profil belum diukur dan tidak boleh dijanjikan sebagai tenggat.

Jawaban pemilik atas 10 pertanyaan terbuka `RENCANA.md` bagian 8 (2026-11-06). Nomor di sini = keputusan; nomor pertanyaan asal di dalam tanda kurung.
19. (Pertanyaan 1) Profil dari satudata boleh tampil tanpa izin pemilik. Tetap diperiksa petugas sebelum tampil (sama dengan keputusan 1 dan 5). Izin memberi nomor tetap harus ada sebelum nomor dikirim (keputusan 4).
20. (Pertanyaan 2) Pencatatan perilaku pengunjung (dilihat, pencarian tanpa hasil, klik hubungi) cukup diumumkan di kebijakan privasi, tanpa persetujuan terpisah. Syarat: `docs/KEBIJAKAN_PDP.md` dan halaman kebijakan privasi diperbarui dan terbit sebelum pencatatan dinyalakan; sakelar tetap mati sebelum itu. Sisi sistem sebelumnya menyarankan persetujuan; tinjauan petugas pelindungan data (DPO) tetap disarankan sebelum rilis, tetapi bukan syarat dari pemilik.
21. (Pertanyaan 3) Bila UMKM mencabut izin nomor, nomor yang pernah dikirim tidak tampil lagi di akun perusahaan; perusahaan diarahkan ke WhatsApp resmi. Ini mempersempit keputusan 10 (nomor tampil lagi di akun pemohon) pada kasus izin dicabut.
22. (Pertanyaan 4) Persetujuan petugas berlaku 14 hari bila FO belum mengirim. Lewat itu permintaan ditahan dan diperiksa ulang; tidak pernah lolos otomatis.
23. (Pertanyaan 5) Semua angka (dilihat, disukai) tampil untuk umum, tanpa ambang minimal. Cara melindungi UMKM baru dari kesan sepi tetap lewat slot UMKM baru di urutan.
24. (Pertanyaan 6) UMKM boleh melihat nama perusahaan yang sudah menerima nomornya.
25. (Pertanyaan 7) Pemeriksaan bersama dilakukan bebas kapan saja, tanpa hari tetap. FO tidak menjanjikan jam periksa ke perusahaan; urutan antrean tetap mengikuti keputusan 7.
26. (Pertanyaan 8) Tidak ada batas bisnis jumlah UMKM per pengajuan atau permintaan berjalan per akun perusahaan. Batas teknis anti-spam (laju permintaan) tetap dipertahankan sebagai pengaman [USUL, bukan pembatas pengguna sah].
27. (Pertanyaan 9) Angka kerja lain (bobot urutan, masa simpan catatan, masa pegang 30 menit, batas 30 akses FO per hari, salinan sementara satu menit) memakai usulan tim dan ditinjau setelah tiga bulan berjalan.
28. (Pertanyaan 10) Tidak ada label "Diminati perusahaan" di profil umum.

Perubahan peran FO (arahan pemilik, 2026-11-06). Keputusan 29 sampai 32 mengalahkan semua teks di keputusan 1 sampai 28 yang memberi FO tugas operasional.
29. FO tidak punya fungsi operasional di fitur UMKM; FO hanya bersifat supervisi. Seluruh kerja operasional (memeriksa UMKM dan perusahaan, memeriksa permintaan, meminta izin UMKM, mengirim nomor, membalas pemohon) dikerjakan petugas UMKM. Akibat pada keputusan lain: keputusan 4 (pengirim nomor), keputusan 5 (FO siaga dan merespons dalam 1 hari tidak berlaku lagi untuk fitur ini; target tetap keputusan 7), keputusan 16 (akses khusus FO dihapus), keputusan 17 (catatan ketiga menjadi pengiriman oleh petugas UMKM), keputusan 22 (bila petugas belum mengirim), keputusan 25 (LMH tidak menjanjikan jam periksa), keputusan 27 (batas akses 30 per hari berlaku untuk petugas UMKM).
30. Petugas UMKM yang menyetujui permintaan juga mengirim nomor lewat WhatsApp resmi. Sistem memeriksa ulang izin UMKM saat petugas menekan kirim dan mencatatnya. Pengiriman tetap dilakukan manusia; tidak ada jalur otomatis (keputusan 4). Akses nomor oleh petugas UMKM tercatat.
31. Supervisi FO berarti baca saja: jumlah antrean, lama proses, dan jejak kerja petugas. Nomor WhatsApp UMKM tersamar bagi FO. FO tidak bisa menyetujui, mengubah, atau mengirim apa pun, kecuali tindakan mendesak di keputusan 32.
32. Hal mendesak (laporan penipuan, pencabutan izin) saat tidak ada petugas UMKM yang bertugas boleh ditangani admin dan FO (dikonfirmasi pemilik). Tindakannya terbatas pada menyembunyikan profil sementara, menahan permintaan, dan mencatat pencabutan izin; tanpa melihat nomor; tercatat; ditinjau petugas UMKM pada giliran berikutnya.

Kanal WhatsApp (arahan pemilik, 2026-11-06). Keputusan 33 sampai 35 mengalahkan teks sebelumnya yang menyebut WhatsApp resmi instansi atau pengiriman nomor lewat chat.
33. Tiap petugas UMKM memakai nomor WhatsApp pribadinya masing-masing. Nomor pribadi petugas tidak tampil di halaman publik.
34. Tombol "Hubungi lewat petugas" dan jalan keluar saat pencarian kosong membuka formulir singkat di LMH (nama, perusahaan, nomor yang bisa dihubungi, pesan). Petugas yang bertugas menghubungi pengirim dari WhatsApp-nya. Formulir ini masuk tahap A; tahap A tetap tidak membagikan nomor UMKM (keputusan 17).
35. Saat permintaan disetujui, petugas hanya mengirim pemberitahuan lewat WhatsApp. Nomor UMKM tidak ditulis di chat; perusahaan melihatnya setelah login di akunnya. Tetap manusia yang memutuskan: petugas menekan tombol buka nomor, sistem memeriksa ulang izin saat itu dan mencatatnya. Perusahaan wajib punya akun untuk menerima nomor. Ini mengubah bagian "mengirim nomor" di keputusan 4 dan 30, dan keputusan 10 menjadi jalur utama.

Prinsip penyederhanaan (arahan pemilik, 2026-11-06). Mengalahkan semua aturan buatan tim dan angka usulan.
36. Semuanya harus sederhana. Jangan terlalu banyak aturan dan batasan, agar tidak menyulitkan petugas dan pengguna lain. Akibat langsung: keputusan 22 (masa berlaku 14 hari) gugur karena menyetujui dan membuka nomor kini satu langkah; batas 30 akses per hari di keputusan 27 gugur. "Salinan sementara satu menit" di keputusan 27 berarti cache katalog, dan tetap ada karena membuat sistem ringan (keputusan 12). Yang tetap: nomor UMKM tidak publik, profil dan permintaan diperiksa petugas, izin UMKM, nomor dilihat di akun setelah login, pencatatan otomatis, FO baca saja.
37. (2026-11-10) "setuju semua, umkm lama di hapus saja". Marketplace UMKM lama (`/umkm`, inbox, edit lewat tautan email, halaman admin "UMKM") dihapus dari aplikasi; keputusan 11 gugur. Alamat lama diarahkan ke katalog baru. Data lama di database tidak dihapus.

Impor data satudata dan produk UMKM (arahan pemilik, 2026-11-10).
38. Data satudata yang masuk ke LMH:
   - Data pribadi tidak masuk: NIK, tanggal lahir, jenis kelamin, disabilitas, pendidikan, alamat rumah, dan koordinat. Kata pemilik: "data sangat pribadi seperti NIK, Tanggal Lahir, Jenis Kelamin, dll Jangan masuk, tapi kamu harus detail ya, 1 kolom data sangat berarti sekali di UMKM ini".
   - Omzet masuk sebagai rentang, tanpa angka persis; label "lebih dari Rp... per tahun" tampil publik.
   - Modal pendirian dan aset tidak masuk.
   - Nama usaha yang memuat nama pemilik diganti otomatis menjadi `<Spesifik> <Kecamatan>`.
   - Nama pemilik tetap masuk, hanya untuk petugas UMKM, dan tidak pernah publik.
   - Baris dengan HP kosong atau asal tidak masuk. Kata pemilik: "yang data nomor hp nya kosong, yang asal jangan di masukin."
39. UMKM yang mengedit datanya bisa menambah produk lain beserta kapasitas produksinya. Kata pemilik: "seharusnya nanti si umkm ketika edit data dia, bisa tambahin produk produk yang lain, kapasitas produksi nya berapa."
   - Kapasitas tampil publik dengan keterangan "menurut UMKM", setelah diperiksa petugas.
   - Tiap produk boleh punya satu foto sendiri, diperiksa petugas seperti foto lain.
40. Halaman pengguna `/me` dan formulir UMKM dirapikan. Kata pemilik: "di halaman pengguna https://lmh.dpmptsp.web.id/me, ini menu bar kiri nya gk lengkap, lalu tampilan input umkm ini masih kurang rapi, harusnya bisa upload foto sendiri. jangan hanya link dari satu data, inputan nya bisa pilih link foto atau upload foto. lalu ada foto utama untuk foto profil, ada juga foto produk."
   - Menu kiri `/me` ditambah "Usaha saya" (`/me/usaha`), "Cari pemasok" (`/me/umkm`, judul halamannya ikut diganti), dan "Lacak pengaduan" (`/pengaduan/lacak`). Menu ini tampil untuk semua pengguna yang login.
   - Setiap foto bisa diisi dengan memilih tautan atau unggah, termasuk saat pertama mendaftar.
   - Ada satu foto utama sebagai foto profil, dan foto produk (P-39).

## 4. Permintaan baru: statistik, peringkat, rekomendasi

Kata pemilik: statistik UMKM harus ada, yaitu berapa kali sebuah UMKM diakses dan berapa yang menyukai. Ada algoritma peringkat: UMKM yang paling disukai atau sering dilihat naik ke atas, seperti katalog e-commerce. Berbeda untuk tiap pengunjung atau tiap perusahaan: begitu mencari, ia mendapat rekomendasi yang disesuaikan.

Dokumen wajib menjawab, dengan tanda [FAKTA]/[ASUMSI]/[USUL]:
- Apa yang dihitung (dilihat, pengunjung unik, disukai, dihubungi, permintaan nomor, hasil) dan definisinya; cara mencegah hitungan ganda dan manipulasi (suka palsu, bot, refresh).
- Siapa melihat angka apa: publik, UMKM pemilik, petugas, admin. Apa yang ditampilkan ke publik (mis. ambang minimal agar angka kecil tidak memalukan UMKM baru).
- Algoritma peringkat bawaan: rumus sederhana yang bisa dijelaskan, sinyal yang dipakai, bobot, peluruhan waktu, perlakuan UMKM baru (cold start) dan keadilan agar yang lama tidak menguasai puncak selamanya. Sertakan opsi yang ditolak dan alasannya.
- Rekomendasi personal: dasar personalisasi untuk (a) pengunjung anonim/baru, (b) pengunjung login, (c) perusahaan dengan kebutuhan tersimpan (cocokkan kebutuhan ke Jenis/Kategori/Spesifik dan kab/kota). Bagaimana "rekomendasi begitu ia mencari" bekerja tanpa pekerjaan berat di Vercel.
- Privasi: apa yang dicatat tentang perilaku pengunjung, dasar persetujuan, retensi, kaitan dengan `docs/KEBIJAKAN_PDP.md`, `consent_log`, dan kebijakan privasi.
- Biaya di free tier: berapa tulisan ke database per kejadian, cara menggabungkan (batch/agregasi berkala), di mana disimpan, kapan dihitung ulang (pg_cron di database, bukan Vercel), batas ukuran tabel jejak dan cara memangkasnya.
- Statistik untuk petugas/admin: laporan dampak (kunjungan, pencarian tanpa hasil, permintaan, hasil kerja sama) dan kapan dirilis (per tahap).
- Keputusan pemilik yang masih terbuka tentang ini, dengan opsi dan rekomendasi.
