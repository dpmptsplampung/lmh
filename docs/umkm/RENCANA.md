# Rencana fitur UMKM Lampung Maju Hub

Dokumen ini untuk pemilik fitur. Isinya: apa yang dibangun, urutannya, kerja petugas, aturan yang tersisa, dan risikonya. Rincian untuk tim pengembang ada di dokumen lain (bagian 9).

## 1. Ringkasnya

DPMPTSP menjadi perantara antara perusahaan yang mencari pemasok dan UMKM Lampung. Perusahaan mencari UMKM di katalog LMH. Nomor WhatsApp UMKM tidak pernah terbuka untuk umum. Petugas UMKM memeriksa setiap permintaan. Saat petugas menekan satu tombol "Setujui", sistem memeriksa izin UMKM, dan bila izin ada, nomor langsung tampil di akun perusahaan. Petugas hanya mengirim pemberitahuan lewat WhatsApp; nomor UMKM tidak ditulis di chat. Semua tindakan tercatat otomatis.

| Tahap | Isi | Yang mulai merasakan |
|---|---|---|
| A | Katalog yang diperiksa petugas, formulir singkat "Hubungi lewat petugas", angka disukai (angka dilihat menyusul setelah kebijakan privasi terbit), daftar tugas petugas, halaman pengawasan FO. Belum ada pembagian nomor. | Pengunjung, petugas UMKM, FO |
| B | Perusahaan mendaftar singkat, menulis kebutuhan, meminta nomor. Nomor tampil di akunnya setelah disetujui. | Perusahaan, petugas UMKM |
| C | UMKM mendaftar dan mengubah datanya sendiri, tetap diperiksa dulu | UMKM |

Marketplace UMKM yang sekarang tetap berjalan seperti biasa di semua tahap.

## 2. Keputusan Bapak/Ibu (36 butir)

Kutipan persisnya ada di `KEPUTUSAN-PEMILIK.md`. Tabel ini memakai arti yang berlaku sekarang.

| No | Keputusan |
|---|---|
| 1 | Pendaftar UMKM baru tertutup sampai petugas memeriksa, baru tampil. |
| 2 | Data perusahaan singkat, ditambah daftar kebutuhan. Satu kebutuhan boleh memilih beberapa UMKM. |
| 3 | NIB bukan syarat. UMKM tanpa NIB didorong mengurusnya. |
| 4 | Nomor UMKM tidak boleh tampil untuk umum. Semua permintaan diperiksa petugas UMKM. Tidak ada jalur otomatis. |
| 5 | Pemeriksaan manual; petugas yang menentukan, boleh bergantian. |
| 6 | Waktu petugas UMKM kira-kira 1 sampai 2 hari kerja per minggu (perkiraan). |
| 7 | Target "secepatnya", tanpa angka yang dijanjikan. Yang tertua dan lengkap lebih dulu; yang mendesak didahulukan. |
| 8 | Tahap A, B, dan C disetujui. |
| 9 | Foto dari tautan mana pun atau diunggah ke gudang foto R2. Foto satudata tidak disalin. Ganti foto berarti diperiksa ulang. Ada tombol laporkan; petugas bisa menyembunyikan foto. |
| 10 | Nomor tampil di akun pemohon setelah masuk (login). Ini kini jalur utama. |
| 11 | Marketplace lama tetap berjalan. |
| 12 | Sistem ringan untuk layanan gratis. Hasil pencarian 20 per halaman. |
| 13 | Paket Vercel sudah dicek. |
| 14 | Tautan TikTok dan Instagram tidak wajib; bila kosong, tidak tampil sama sekali. |
| 15 | Angka "diminati perusahaan" tidak masuk rumus urutan; boleh untuk laporan petugas. |
| 16 | Akses khusus FO dihapus (keputusan 29). |
| 17 | Tahap A tidak membagi nomor. Pembagian nomor berjalan bila keputusan petugas, izin terbaru, dan pembukaan nomor bisa dicatat. |
| 18 | Paling banyak 10.000 profil. Ini batas atas, bukan syarat rilis, bukan tenggat. |
| 19 | Profil satudata boleh tampil tanpa izin pemilik, setelah diperiksa. Izin nomor tetap wajib. |
| 20 | Pencatatan perilaku pengunjung cukup diumumkan di kebijakan privasi. Sakelar mati sampai kebijakan terbit. |
| 21 | Bila UMKM mencabut izin, nomor tidak tampil lagi di akun perusahaan. |
| 22 | Masa berlaku 14 hari gugur (keputusan 36). |
| 23 | Semua angka dilihat dan disukai tampil tanpa batas minimal. UMKM baru dilindungi lewat slot UMKM baru. |
| 24 | UMKM boleh melihat nama perusahaan yang sudah menerima nomornya. |
| 25 | Pemeriksaan kapan saja, tanpa hari tetap. LMH tidak menjanjikan jam periksa. |
| 26 | Tidak ada batas jumlah UMKM per pengajuan atau permintaan berjalan. Hanya batas teknis anti-spam. |
| 27 | Angka kerja yang tersisa (bobot urutan, masa simpan catatan) memakai usulan tim dan ditinjau setelah tiga bulan. |
| 28 | Tidak ada label "Diminati perusahaan" di profil umum. |
| 29 | FO tidak punya tugas operasional di fitur ini, hanya mengawasi. |
| 30 | Petugas UMKM yang menyetujui juga membuka nomor. Sistem memeriksa ulang izin saat itu dan mencatatnya. |
| 31 | FO hanya membaca: jumlah antrean, lama proses, jejak kerja. Nomor UMKM tidak pernah sampai ke FO. |
| 32 | Hal mendesak saat tidak ada petugas UMKM: admin dan FO boleh menyembunyikan profil sementara, menahan permintaan, dan mencatat pencabutan izin, tanpa melihat nomor. |
| 33 | Tiap petugas UMKM memakai WhatsApp pribadinya. Nomor petugas tidak tampil di halaman publik. |
| 34 | "Hubungi lewat petugas" dan pencarian kosong membuka formulir singkat di LMH. Petugas menghubungi pengirim dari WhatsApp-nya. |
| 35 | Petugas hanya mengirim pemberitahuan lewat WhatsApp; nomor UMKM tidak ditulis di chat. Perusahaan wajib punya akun untuk menerima nomor. |
| 36 | Semuanya harus sederhana. Aturan yang tidak perlu dihapus. |

## 3. Cerita tiap tahap

### Tahap A: katalog dan alat kerja petugas

**Cerita.** Pak Andi, petugas UMKM, menerima daftar UMKM kopi dari satudata. Ia memeriksa satu per satu lalu menekan "Terbitkan". Seminggu kemudian staf sebuah hotel membuka profil UMKM kopi, menekan "Hubungi lewat petugas", dan mengisi nama, perusahaan, nomor yang bisa dihubungi, dan pesan. Pak Andi melihat pesan itu di daftar tugasnya, menghubungi staf hotel dari WhatsApp-nya, dan mengirim tautan profil. Di tahap ini nomor UMKM belum dibagikan.

| Pihak | Yang dilihat |
|---|---|
| Pengunjung | Katalog yang sudah diperiksa, angka dilihat dan disukai, tombol hubungi, tombol laporkan, tautan TikTok/Instagram bila ada. Nomor UMKM tidak pernah tampil. |
| Pengunjung yang masuk | Sama, ditambah tombol suka dan daftar yang ia sukai. |
| Petugas UMKM | Satu daftar tugas, layar pemeriksaan, tombol sembunyikan, laporan. |
| FO | Halaman pengawasan: jumlah antrean, lama proses, jejak kerja, tanpa nomor. Tamu di loket diarahkan ke petugas UMKM. |

**Selesai bila**
- Profil yang belum diperiksa tidak bisa dibuka siapa pun selain petugas, termasuk lewat tautan langsung.
- Terbukti tidak ada jalan apa pun untuk memberi nomor UMKM kepada FO, perusahaan, atau pengunjung.
- Pemeriksaan isi halaman dan data yang dikirim ke peramban tidak menemukan nomor UMKM. Nomor yang tertulis di deskripsi memicu peringatan, dan petugas melihat fotonya.
- Formulir singkat masuk ke daftar tugas petugas, dan FO hanya melihat jumlahnya.
- Kebijakan privasi sudah diperbarui sebelum formulir dibuka, termasuk soal WhatsApp pribadi petugas.
- Keputusan petugas selesai dalam satu layar dan paling banyak dua klik.
- Katalog tetap berjalan saat sakelar pencatatan mati.
- Marketplace lama tetap berfungsi.

Tidak ada syarat jumlah profil minimal.

**Ukuran:** besar (L), karena isi, privasi, foto, dan marketplace lama semuanya tersentuh.

### Tahap B: perusahaan meminta nomor UMKM

**Cerita.** Bu Rina, staf pembelian PT Maju, mencari "keripik pisang" dan memilih tiga UMKM. Ia masuk dengan akun Google, mengisi nama perusahaan dan jabatannya, lalu menulis kebutuhannya. Di akunnya muncul "Permintaan diterima pada 12 Januari".

Saat bekerja, Pak Andi mengambil permintaan tertua dan menelepon PT Maju untuk memastikan Bu Rina memang bekerja di sana. Satu UMKM ia tolak karena sedang tidak berproduksi. Dua lainnya ia setujui. UMKM pertama sudah memberi izin, jadi nomornya langsung tampil di akun Bu Rina. UMKM kedua belum, jadi statusnya "menunggu izin"; Pak Andi menanyakan lewat WhatsApp, mencatat jawabannya, lalu menekan "Setujui" lagi.

Pak Andi mengirim pesan ke Bu Rina: permintaan disetujui, silakan masuk ke akun LMH, beserta kode permintaan. Nomor UMKM tidak ada di pesan itu.

| Pihak | Yang dilihat |
|---|---|
| Perusahaan | Status tiap permintaan, tanggal, alasan bila ditolak, nomor yang sudah dibuka, rekomendasi UMKM untuk kebutuhannya, nama petugas dan empat angka terakhir nomornya (usulan). |
| Petugas UMKM | Permintaan di daftar tugas yang sama, dengan tombol "Setujui" dan "Tolak". |
| FO | Sama dengan tahap A. Tidak pernah melihat nomor. |
| UMKM | Pesan WhatsApp dari petugas saat izin ditanyakan. |

**Selesai bila**
- Tidak ada cara membuka nomor tanpa petugas menekan "Setujui".
- Nomor tidak terbuka bila izin dicabut, dan berhenti tampil saat izin dicabut.
- Nomor hanya terlihat di akun pemohon, setelah masuk, tidak di cache, catatan sistem, atau chat.
- Templat pesan tidak punya tempat untuk nomor UMKM.
- FO tidak bisa membaca nomor lewat jalan apa pun.
- Kebijakan privasi sudah memuat izin nomor sebelum tahap ini dibuka.

**Ukuran:** besar (L), karena izin dan akses nomor paling peka walau layarnya sedikit.

### Tahap C: UMKM mengurus profilnya sendiri

**Cerita.** Bu Sari, pemilik usaha tapis di Pringsewu, mendaftar lewat ponselnya. Profilnya belum tampil; ia melihat tulisan "menunggu pemeriksaan, diajukan 3 Februari". Petugas menulis catatan agar fotonya diganti. Setelah diganti, profilnya diterbitkan. Ia bisa melihat angka dilihat, disukai, dan nama perusahaan yang menerima nomornya. Karena belum punya NIB, ia mendapat penjelasan cara mengurusnya; profilnya tetap tampil.

**Selesai bila**
- Pendaftaran dan perubahan tidak tampil sebelum diperiksa; versi lama tetap tampil selama menunggu.
- Foto pendaftar tidak bisa dibuka lewat alamat publik sebelum disetujui.
- Akun yang baru masuk tidak otomatis menjadi pemilik profil.
- UMKM bisa mencabut izin nomornya sendiri dan langsung berlaku.

**Ukuran:** sedang (M).

## 4. Kerja petugas dan aturan yang tersisa

| Petugas UMKM mengerjakan | FO hanya mengawasi | Admin |
|---|---|---|
| Memeriksa profil, perusahaan, dan permintaan. Menanyakan dan mencatat izin. Menekan "Setujui" dan memberi tahu pemohon. Menjawab formulir. Mengetik data tamu loket. Mencatat hasil. Menyembunyikan foto atau profil. | Membaca jumlah antrean, lama proses, dan jejak kerja, tanpa nomor. Mengarahkan tamu loket. Tindakan mendesak saja. | Menandai siapa petugas UMKM. Tindakan mendesak. Laporan. Melihat nomor hanya bila ditandai sebagai petugas UMKM. |

**Kerja petugas UMKM dalam satu hari**
1. Buka daftar tugas: yang mendesak paling atas, sisanya urut dari yang tertua.
2. Pilih butir. Kalau perlu, ambil alih dari rekan dengan satu klik.
3. Periksa di satu layar, telepon atau WhatsApp bila perlu, lalu tekan "Terbitkan", "Setujui", atau "Tolak" dengan alasan singkat.
4. Bila izin belum ada, tanyakan ke UMKM, catat jawabannya, tekan "Setujui" lagi.
5. Kirim pemberitahuan ke pemohon dengan satu tombol, tanpa nomor UMKM.

**Aturan yang tersisa.** Silakan coret bila masih dianggap berlebihan.

| Aturan | Asal |
|---|---|
| Profil diperiksa sebelum tampil | Keputusan 1, 5 |
| Nomor UMKM tidak tampil untuk umum, termasuk di deskripsi | Keputusan 4 |
| Setiap permintaan diputuskan petugas, tidak ada jalur otomatis | Keputusan 4 |
| Sistem memeriksa izin saat "Setujui" | Keputusan 30, 35 |
| Nomor hanya di akun pemohon setelah masuk; perusahaan wajib punya akun | Keputusan 10, 35 |
| Pencabutan izin langsung menghentikan tampilnya nomor | Keputusan 21 |
| Nomor UMKM tidak ditulis di chat | Keputusan 35 |
| Formulir singkat untuk menghubungi petugas | Keputusan 34 |
| FO hanya membaca dan tidak pernah menerima nomor; tindakan mendesak terbatas | Keputusan 29, 31, 32 |
| Foto bisa dilaporkan dan disembunyikan; ganti foto diperiksa ulang | Keputusan 9 |
| Tahap A tidak membagi nomor | Keputusan 17 |
| Sakelar pencatatan mati sampai kebijakan privasi terbit | Keputusan 20 |
| Satu suka per akun; satu hitungan dilihat per pengunjung per hari | Permintaan Bapak/Ibu soal statistik; dikerjakan sistem |
| Pencatatan otomatis setiap tindakan penting | Keputusan 36 |
| Satu batas laju anti-spam, tidak terasa pengguna wajar | Keputusan 26 |
| Masa simpan catatan | Keputusan 27, kewajiban perlindungan data |

**Hitungan kasar beban (ilustrasi, belum diukur).** Jam kerja yang dibutuhkan = profil x 5 menit, ditambah permintaan x 15 menit (periksa 5, tanya izin 5, buka nomor 3, beri tahu 2). Semua menit ini asumsi.

| Permintaan per minggu | Sisa waktu untuk profil dari 8 sampai 16 jam per minggu | 10.000 profil (833 jam) selesai dalam |
|---|---|---|
| 0 | 8 sampai 16 jam | 52 sampai 104 minggu |
| 10 | 5,5 sampai 13,5 jam | 62 sampai 152 minggu |
| 30 | 0,5 sampai 8,5 jam | 98 minggu, sampai hampir tidak berjalan |

Karena FO tidak lagi membantu, seluruh beban ini ada pada petugas UMKM, dan keputusan 6 belum berubah. Ini bukan janji dan bukan tenggat. Katalog tumbuh bertahap, hanya profil yang sudah diperiksa yang tampil, dan waktu nyatanya dibaca dari catatan sistem.

## 5. Statistik, urutan, dan rekomendasi

Pencatatan dilihat, pencarian tanpa hasil, dan klik hubungi memakai satu sakelar. Sakelar mati sampai `docs/KEBIJAKAN_PDP.md` dan halaman privasi terbit. Peninjauan oleh petugas pelindungan data (DPO) disarankan, tetapi bukan syarat dari Bapak/Ibu.

**Yang dihitung.** Dilihat (sekali per pengunjung per hari), disukai (harus masuk, satu suka per akun), permintaan, nomor yang dibuka, dan hasil (belum diketahui, bekerja sama, tidak berlanjut). Petugas dan pemilik usaha tidak ikut terhitung.

**Yang tampil untuk umum.** Angka dilihat dan disukai, termasuk angka kecil dan nol. UMKM yang terbit kurang dari 30 hari diberi label "Baru".

**Cara mengurutkan.** Yang paling cocok dengan kata yang dicari selalu di atas. Di antara yang sama cocoknya, urutannya memakai nilai: 5 x suka + dilihat, dari 90 hari terakhir. Satu suka setara lima kali dilihat, dan angka lama hilang dengan sendirinya. Selama sakelar mati, nilainya hanya dari suka. Nilai dihitung sekali sehari pukul 02.00 WIB. Di halaman pertama, posisi 5 dan 15 diberikan bergiliran kepada UMKM baru yang cocok. Yang nilainya sama diacak setiap hari. NIB, izin nomor, dan jumlah perusahaan peminat tidak memengaruhi urutan.

**Rekomendasi.** Pengunjung mendapat hasil sesuai kata yang dicari dan "UMKM serupa". Perusahaan mendapat "UMKM untuk kebutuhan Anda" sesuai kategori dan daerah yang ia tulis. Rekomendasi tidak disusun dari riwayat klik, karena kebijakan privasi LMH melarang profil perilaku otomatis.

**Laporan petugas.** Profil per status, dilihat, disukai, jumlah pencarian tanpa hasil per kategori dan daerah (tanpa kata yang diketik), permintaan per status, perusahaan peminat, lama menunggu (internal), dan hasil. Bisa diunduh tanpa nomor UMKM.

## 6. Supaya ringan

- Pencarian, aturan izin, dan pencatatan dikerjakan di database.
- Hasil 20 per halaman. Katalog umum disimpan sebentar (cache) tanpa nomor apa pun.
- Foto dimuat langsung dari sumbernya atau dari R2.
- Urutan dihitung jadwal otomatis di database (pg_cron), bukan setiap halaman dibuka.
- Catatan mentah disimpan 7 hari, catatan harian 95 hari, ringkasan bulanan 24 bulan.
- Perkiraan pada 10.000 profil: data profil sekitar 40 MB, statistik paling banyak 50 MB, dari 500 MB database bersama. Belum diukur. Bila ruang menipis, sakelar pencatatan dimatikan lebih dulu.

## 7. Risiko

| Risiko | Akibat | Yang dilakukan |
|---|---|---|
| Waktu petugas tidak cukup, karena semua kerja ada padanya dan permintaan tidak dibatasi | Antrean menumpuk, katalog tumbuh lambat | Waktu nyata dibaca dari catatan; Bapak/Ibu bisa menambah waktu petugas |
| Satu orang menyetujui sekaligus membuka nomor | Kesalahan atau penyalahgunaan baru ketahuan belakangan | Pemeriksaan izin oleh sistem, jejak otomatis, FO bisa melihat jejak. **Ini tidak setara dengan pemeriksaan dua orang.** |
| HP pribadi menyimpan data | Saat izin ditanyakan, nomor UMKM dan nomor pemohon masuk riwayat chat petugas. LMH tidak bisa menghapusnya | Keputusan 35 mengurangi, tidak menghilangkan |
| Isi chat di luar jejak | LMH tidak bisa membuktikan isi chat, atau apakah petugas menulis nomor dengan tangan | Laporan pengguna dan jejak tindakan di LMH |
| Petugas pindah tugas | Riwayat chat tetap di HP-nya | Status hidup di LMH, tanda petugas dicabut admin. Usulan: diminta menghapus chat kerja, tidak bisa dibuktikan |
| Penipu mengaku petugas | Nomor pribadi tidak bisa dikenali sebagai nomor instansi | Usulan: akun menampilkan nama petugas dan empat angka terakhir, pesan memuat kode yang bisa dicek di akun |
| Nomor tertulis di deskripsi atau foto | Nomor terbuka untuk umum | Peringatan otomatis, pemeriksaan foto, tombol laporkan |
| Perusahaan palsu | Kerugian UMKM | Setiap permintaan diperiksa, peringatan di setiap pesan |
| Isi foto dari tautan luar berganti | Gambar tidak pantas tampil | Tombol laporkan, petugas menyembunyikan |
| Ruang database habis | Fitur lain LMH terganggu | Catatan mentah pendek, sakelar pencatatan dimatikan lebih dulu |

**Yang hilang akibat batas yang dipotong**

| Batas yang dipotong | Yang hilang |
|---|---|
| Masa berlaku 14 hari dan status ditahan | Permintaan yang menunggu izin bisa diam lama tanpa pengingat otomatis. |
| Setujui dan kirim terpisah | Tidak ada yang melihat permintaan untuk kedua kali sebelum nomor terbuka. |
| Kunci 30 menit | Dua petugas bisa sebentar melihat butir yang sama; ambil alih tercatat. |
| Batas 30 akses per hari | Penyalahgunaan baca nomor hanya ketahuan belakangan dari jejak. |
| Batas per fitur (suka, laporan) | Penyalahgunaan pelan di bawah batas laju tidak tertahan. |
| Blokir perusahaan (ditunda) | Perusahaan nakal masih bisa mengajukan; petugas menolak satu per satu. |
| Porsi waktu untuk pendaftaran | Pendaftaran UMKM bersaing dengan permintaan perusahaan hanya berdasarkan umur. |

## 8. Yang masih perlu diputuskan

Tidak ada lagi pertanyaan terbuka: semua sudah dijawab lewat keputusan 19 sampai 36. Setelah tiga bulan berjalan, kami meninjau bobot urutan, masa simpan catatan, waktu nyata petugas, jumlah permintaan per akun, dan apakah angka nol di profil membuat UMKM baru kecil hati. Satu hal sengaja belum diputuskan dan tidak dibangun: rekomendasi "Serupa dengan yang Anda sukai", karena perlu perubahan kebijakan privasi.

## 9. Dokumen lain

| Dokumen | Isi | Pembaca |
|---|---|---|
| `KEBUTUHAN.md` | 45 kebutuhan bernomor dan daftar "Later" | Pengembang, penguji |
| `ALUR-DAN-PERAN.md` | Peran, alur, status, kasus khusus, teks pesan | Pengembang, petugas |
| `STATISTIK-REKOMENDASI-PRODUK.md` | Statistik, urutan, rekomendasi | Pengembang, pemilik |
| `SISTEM.md` | Rancangan data, hak akses, foto | Pengembang |
| `SISTEM-STATISTIK.md` | Rancangan teknis statistik | Pengembang |
| `MIGRASI-RILIS-UJI.md` | Marketplace lama, urutan rilis, pengujian | Pengembang |

Keenamnya berbahasa Inggris atas arahan Bapak/Ibu.

## 10. Istilah

| Istilah | Arti |
|---|---|
| Katalog | Daftar UMKM yang bisa dicari pengunjung |
| Profil UMKM | Halaman satu UMKM di katalog |
| Permintaan | Permintaan perusahaan untuk mendapat nomor satu UMKM untuk satu kebutuhan |
| Izin nomor | Persetujuan UMKM agar nomornya diberikan kepada perusahaan yang sudah diperiksa |
| Sakelar pencatatan | Satu tombol pengaturan untuk pencatatan perilaku pengunjung |
| Cache | Simpanan sebentar halaman katalog, tanpa nomor |
| R2 | Gudang foto milik Cloudflare yang dipakai LMH |
| pg_cron | Jadwal otomatis di dalam database |

## 11. Hasil audit dokumen

Dua auditor memeriksa dokumen sebelumnya secara silang. Temuan utamanya: tahap A sempat menjanjikan pertemuan padahal alat membagi nomor baru ada di tahap B, dan menyembunyikan kolom nomor belum cukup karena nomor bisa tertulis di deskripsi atau foto. Keduanya sudah diperbaiki.

## 12. Catatan revisi

| Sumber | Bagian yang berubah |
|---|---|
| Keputusan 19 sampai 28 | 2, 5, 8 |
| Keputusan 29 sampai 35 | 1, 2, 3, 4, 7 |
| Keputusan 36 | Seluruh dokumen dipadatkan; tambah "Kerja petugas dalam satu hari", "Aturan yang tersisa", "Yang hilang" |
