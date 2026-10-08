# Usulan Model Role LMH — Admin / Front Office / Petugas

Bahan untuk diskusi dengan CEO. Disusun dari dua inventaris (`inv-ui.md`, `inv-server.md`) plus pemeriksaan ulang kode. Tidak ada kode atau database yang diubah.
Tanda **[ASUMSI]** = belum dibuktikan, perlu dicek saat implementasi.

---

## 0. Ringkasan untuk CEO (1 menit baca)

1. **Tiga role sudah cukup.** Admin = pengatur sistem. FO = penjaga operasional harian di semua layanan. Petugas = melayani pengunjung **hanya untuk layanannya sendiri**. Tidak perlu role baru. Yang perlu ditambah adalah **akun admin kedua sebagai cadangan** (saat ini hanya ada 1 admin).
2. **Pembatasan sekarang kebanyakan hanya di tampilan.** Siapa pun yang login, termasuk pengunjung tanpa akun, bisa langsung meminta database melakukan beberapa aksi berbahaya. Contohnya: menonaktifkan akun admin, membuka antrean layanan, atau memunculkan nomor palsu di layar TV. Ini harus ditutup **lebih dulu** (Tahap 0), sebelum kita merapikan menu.
3. **Jadwal, libur, buka/tutup layanan, dan jawaban bot hanya boleh diubah Admin.** Petugas cukup melihat jadwal, lalu "mengajukan perubahan". FO hanya boleh **menutup atau membuka layanan untuk hari ini** saat darurat, wajib dengan alasan, dan tercatat.
4. **Ada fitur yang belum ada sama sekali:** halaman "Kelola Layanan" untuk mengatur layanan mana yang tampil di layar TV dan halaman utama. Juga halaman "Kelola Akun Layanan" untuk mengubah nama, nomor HP, dan email, melihat akun yang belum pernah login, dan mengatur ulang akses.
5. **Fitur "Ganti PIC" saat ini rusak.** Akun baru tidak tersambung ke layanan. Fitur "Aktifkan kembali" juga kemungkinan selalu gagal. Keduanya diganti dengan alur ubah email yang aman.
6. **Satu bentrokan kebijakan harus diputuskan.** Dokumen resmi proyek mewajibkan akun **pribadi** (`docs/KEBIJAKAN_AKUN_MITRA.md:7`), sedangkan arahan CEO memakai akun **bersama per layanan**. Lihat Keputusan K1.

---

## 1. Prinsip desain (dasar semua tabel di bawah)

| # | Prinsip | Artinya dalam praktik |
|---|---|---|
| P1 | **Database adalah hakim terakhir** | Setiap aturan di matriks harus ditegakkan oleh database dan server. Tampilan (menu, tombol) hanya *mencerminkan* aturan itu. Menyembunyikan tombol tidak dihitung sebagai pengamanan. |
| P2 | **Lingkup layanan** | Petugas selalu terikat pada satu layanan (`petugas.layanan_id`). FO dan Admin bekerja lintas layanan. |
| P3 | **Akun nonaktif = tidak ada akses**, di semua lapis dan seketika | Saat ini tidak berlaku (lihat Temuan S5). |
| P4 | **Perubahan SOP hanya oleh Admin** | Petugas mengajukan perubahan. FO hanya boleh melakukan aksi darurat untuk hari ini, dengan alasan dan jejak audit. |
| P5 | **Setiap perubahan konfigurasi dan akun tercatat** | Tercatat siapa, kapan, nilai lama → nilai baru, dan alasannya. |
| P6 | **Fungsi bot tidak dipotong** | Pembatasan role hanya mengatur *siapa yang mengelola* bot, bukan *apa yang bisa dilakukan* bot. |

Legenda nilai: **—** tidak ada · **Lihat** · **Lihat-L** (lihat untuk layanannya saja) · **Kelola-L** (kelola untuk layanannya saja) · **Kelola** (semua layanan) · **Ajukan** (boleh mengusulkan, berlaku setelah Admin menyetujui; lihat bagian 3) · **Darurat** (aksi khusus hari ini, wajib alasan dan tercatat).

---

## 2. Katalog kemampuan + matriks usulan

Kode kemampuan (A1, B1, …) dipakai di bagian lain dokumen. Kolom "Kini" menunjukkan kondisi nyata saat ini, sebagai pembanding.

### A. Konfigurasi sistem & tampilan publik

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| A1 | Kelola daftar layanan (nama, tipe, aktif, prefiks nomor, nomor loket, penyerta) | Kelola | Lihat | Lihat-L | Struktur layanan adalah konfigurasi sistem, jadi milik Admin. | Kolom sudah ada di DB (`202607290013_kunjungan_tiket.sql:11-21`), **tetapi belum ada halamannya**. Petugas bisa mengubah semua kolom layanannya lewat jalur langsung ke database (S6). |
| A2 | Atur tampilan layanan: tampil/segera hadir/sembunyi di halaman utama & check-in, **tampil di layar TV**, punya antrean/chat | Kelola | Lihat | — | Apa yang dilihat publik adalah keputusan institusi. | `status_tampilan`, `punya_antrean`, `punya_chat` ada di DB tetapi **tidak dipakai kode**. Layar TV menampilkan semua layanan aktif (`202607300022_wp29_layar_token.sql:58`). Belum ada pengaturan "tampil di TV". |
| A3 | Pengaturan situs (WA, FOILA, alamat, jam, email) | Kelola | — | — | Kontak resmi institusi. | Sesuai (admin saja). |
| A4 | Konten halaman utama (landing) | Kelola | — | — | Konten publik resmi. | Sesuai. |
| A5 | Token layar TV (buat/cabut) | Kelola | Lihat | — | FO perlu tahu layar mana yang aktif bila TV bermasalah. Menerbitkan token tetap tugas Admin. | Admin saja. |
| A6 | Kontak resmi per layanan (PIC, WA, alamat kantor mitra) | Kelola | Lihat | Lihat-L | FO memakainya untuk mengalihkan pengunjung saat layanan tutup. | Tabel `layanan_kontak` ada (`202607290012…sql:10-24`), tanpa halaman. |
| A7 | Standar pelayanan (isi halaman /standar-pelayanan) | Kelola | — | Lihat-L | Dokumen SOP resmi. | Tabel ada, tanpa halaman admin. |
| A8 | Pengaturan penyedia AI (urutan model, kuota harian; **kunci API tetap di server**) | Kelola | — | — | Penting untuk rencana ganti ke LLM gratis. Tanpa ini, setiap ganti model harus lewat programmer. | Hanya lewat variabel lingkungan (`lib/llm/registry.ts`). **Opsional, Tahap 5.** |

### B. Jadwal & SOP layanan (area sensitif, lihat bagian 3)

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| B1 | Jadwal mingguan (hari & jam buka) | Kelola | Lihat | Lihat-L + **Ajukan** | Jadwal mengikuti SOP resmi, jadi petugas tidak boleh mengubah langsung. | Menu tampil untuk 3 role. Petugas layanan PTSP bisa menulis jadwal **semua** layanan. FO bisa menulis di DB walau tampilannya "hanya lihat" (`jadwal/page.tsx:70`, `202607290009…sql:35-43`). |
| B2 | Libur khusus per layanan | Kelola | Lihat | Lihat-L + **Ajukan** | Sama dengan B1. | Sama dengan B1. |
| B3 | Hari libur nasional | Kelola | Lihat | Lihat | Berlaku untuk semua layanan. | Tabel ada, tanpa halaman. |
| B4 | Jadwal standby & pengecualian | Kelola | Lihat | Lihat-L + **Ajukan** | Bagian dari jadwal resmi. | FO bisa menulis di DB, tanpa halaman. |
| B5 | Tutup/buka layanan **hari ini saja** (mis. petugas sakit, sistem mitra mati) | Kelola | **Darurat** | — | FO adalah penjaga operasional harian. Perubahan ini tidak menyentuh jadwal resmi. | Tabel `layanan_hari` ditulis FO/admin, tanpa halaman. Saat ini juga terbuka otomatis lewat absensi. |

### C. Antrean & pelayanan

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| C1 | Lihat daftar kunjungan semua layanan | Kelola | Kelola | Lihat-L | Petugas cukup melihat pengunjung layanannya. | Database memberi petugas akses baca **semua** kunjungan (`kunjungan_tiket.sql:125-127`). |
| C2 | Scan QR reservasi (hadir/tolak) | Kelola | Kelola | Kelola-L | Bila reservasi datang langsung ke meja mitra, petugas boleh mencatat kehadirannya. | Menu: admin+FO. **FO tanpa layanan ditolak DB** (M1). |
| C3 | Daftarkan pengunjung walk-in | Kelola | Kelola | Kelola-L | Pengunjung sering datang langsung ke meja layanan. | Petugas sudah terkunci ke layanannya (`antrian/page.tsx:363`). |
| C4 | Panggil / mulai / selesaikan nomor antrean | Kelola | Kelola | Kelola-L | Inti tugas petugas. FO mengambil alih bila petugas berhalangan. | Fungsi panggil tanpa cek apa pun (S2). FO tanpa layanan ditolak saat mulai/selesai (M1). |
| C5 | Isi & finalisasi data pendataan pelayanan | Kelola | Kelola | Kelola-L | Data substantif layanan diisi oleh yang melayani. | FO bisa finalisasi tetapi **tidak bisa menyimpan draf** (M2). |
| C6 | Ubah data yang sudah terkunci (setelah finalisasi) | Kelola | — | — | Koreksi data resmi butuh otoritas tertinggi dan jejak audit. | Sesuai. Tetapi petugas bisa mengunci sendiri lewat jalur langsung (S8). |
| C7 | Buku tamu | Kelola | Kelola | — | Tamu kantor, bukan pelayanan mitra. | Tabel ada (FO/admin), tanpa halaman. |

### D. Absensi petugas (gerbang antrean)

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| D1 | Absen diri (ajukan hadir, catat pulang) | — | — | Kelola-L (diri sendiri) | Kehadiran petugas membuka antrean layanannya. | Ada. |
| D2 | Catat absensi petugas lain (+ foto wajah) | Kelola | Kelola | — | FO memverifikasi kehadiran fisik di lokasi. | **Rusak di produksi**: migrasi foto belum diterapkan (S12). |
| D3 | Setujui / tolak absensi | Kelola | Kelola | — | Petugas tidak boleh menyetujui dirinya sendiri. | FO menekan "setujui" → **tidak berefek tetapi tampil "berhasil"** (M1). Sebaliknya petugas **bisa menyetujui dirinya sendiri** lewat jalur langsung (S3). |
| D4 | Lihat rekap absensi | Kelola | Kelola | Lihat-L (diri sendiri) | Privasi antar-petugas. | Sesuai. |

### E. Operasional chat

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| E1 | Lihat & balas chat | Kelola | Kelola | Kelola-L | Petugas menjawab pertanyaan layanannya. FO menangani lintas layanan. | Sesuai di server. |
| E2 | Ambil alih / kembalikan ke bot / selesaikan sesi | Kelola | Kelola | Kelola-L | Ambil alih sudah cukup untuk "membungkam" bot di satu percakapan tanpa mematikan bot. | Aturan hanya di server, longgar di database (S9). |
| E3 | Rebut sesi yang sedang dipegang petugas lain | Kelola | Kelola | — | Wewenang supervisor. | Sesuai di server, longgar di database. |
| E4 | Minta draf balasan AI | Kelola | Kelola | Kelola-L | Membantu kecepatan menjawab. | **FO ditolak** walau tombolnya tampil (`chat/ai/draft/route.ts:42`). |

### F. Pengetahuan bot (FAQ, dokumen peraturan, kualitas AI)

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| F1 | Hidup/matikan bot per layanan | Kelola | Lihat | Lihat-L | Mematikan bot = memotong fungsi bot, jadi keputusan Admin. Untuk menangani satu percakapan, cukup pakai "Ambil alih" (E2). | Petugas bisa mengubahnya, dan sekaligus semua kolom layanannya (S6). |
| F2 | Tambah/ubah FAQ per layanan | Kelola | Lihat | Lihat-L + **Ajukan** (usulan berstatus draf) | Petugas paling paham isi layanannya, tetapi jawaban bot adalah pernyataan resmi institusi. | Petugas langsung menerbitkan. Pemrosesan otomatis gagal untuk petugas sehingga FAQ tersimpan tanpa "indeks makna" (`faq/page.tsx:243`, `faq/embed/route.ts:43`). |
| F3 | Hapus / nonaktifkan FAQ | Kelola | — | — | Bersifat merusak. | Petugas bisa (RLS `faq_petugas_all`). |
| F4 | Sinonim FAQ | Kelola | — | — | Penyetelan bot. | Tanpa halaman. |
| F5 | Dokumen peraturan (unggah, cabut) | Kelola | — | — | Sumber hukum resmi. | Admin. **Catatan:** kode bot saat ini **tidak memakai** dokumen peraturan (tidak ada pemanggilan `match_dokumen` di `src/`; `chat/ai/route.ts` hanya memakai FAQ). [Perlu konfirmasi apakah ini disengaja.] |
| F6 | Log AI chat (tinjau tanya-jawab bot) | Kelola | — | — | Bisa memuat data pribadi pengunjung. | Sesuai. |

### G. Rekap & laporan

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| G1 | Dashboard ringkasan hari ini | Kelola | Lihat | — | FO butuh gambaran lintas layanan. Petugas cukup halaman Antrian. | Admin saja. FO dialihkan ke halaman lain. |
| G2 | Lihat rekap harian/bulanan | Kelola | Kelola | Lihat-L | Mitra perlu melapor ke instansinya. | Petugas bisa membaca rekap **semua** layanan di database (`wp30_rekap_harian.sql:34-37`). |
| G3 | Ekspor Excel | Kelola | Kelola | Lihat-L | Sama dengan G2. Ekspor tercatat di audit. | Tab umum/OSS/perizinan tidak disaring per layanan di route (`export/route.ts:94-95`). |
| G4 | Hitung ulang rekap (rollup) | Kelola | Kelola | — | Aksi teknis. | Tombol tampil untuk petugas, tetapi ditolak saat diklik. |

### H. Pengaduan & integritas

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| H1 | Lihat pengaduan jalur layanan | Kelola | — (opsi: Lihat, lihat K3) | — | Sesuai arahan CEO: pengaduan adalah ranah Admin. Admin meneruskan ke mitra bila perlu. | Menu tampil untuk 3 role. Petugas melihat pengaduan layanannya. |
| H2 | Ubah status pengaduan jalur layanan | Kelola | — (opsi: Kelola) | — | Sama dengan H1. | Petugas: route menerima tetapi database diam-diam menolak, sehingga "sukses palsu" (M3). |
| H3 | Jalur integritas (lihat & ubah) | Kelola | — | — | Rahasia, menyangkut perilaku pegawai. | Admin saja di server, tetapi **tab-nya tampil untuk semua role** (`pengaduan/page.tsx:126`). |

### I. SKM / IKM

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| I1 | Lihat nilai IKM | Kelola | Lihat | Lihat-L | Angka IKM memang publik (/transparansi). Bagi petugas, ini umpan balik kinerja. | Semua role melihat semua layanan. |
| I2 | Lihat saran/respons rinci (tanpa identitas responden) | Kelola | Lihat | Lihat-L | Bahan perbaikan layanan. | FO tanpa layanan tidak bisa membaca (M4). |

### J. UMKM, Investasi, Gallery

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| J1 | Kelola, verifikasi & terbitkan listing UMKM, pemilik, link edit | Kelola | — | — | Moderasi konten publik. | Database mengizinkan petugas menambah draf listing dan mengunggah foto. |
| J2 | Investment Gallery (unggah, urut, hapus) | Kelola | — | — | Konten publik resmi. | Sesuai. |
| J3 | Lead investasi (lihat, ubah status) | Kelola | — | — | Berisi data pribadi calon investor. | **Petugas bisa membaca lead** di database (`investasi_lead_select_staff`). |

### K. Manajemen akun & role

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| K1 | Lihat daftar akun (nama, layanan, no HP, status, terakhir login) | Kelola | Lihat | — | FO perlu menelepon petugas yang belum datang. | Admin saja. Kolom no HP belum ada. |
| K2 | Buat/undang akun | Kelola | — | — | Menentukan siapa yang masuk sistem. | Admin, termasuk admin yang **sudah dinonaktifkan** (S5). |
| K3 | Ubah nama, no HP, layanan | Kelola | — | — | Data akun layanan dikelola terpusat. | Nama & layanan bisa diubah. No HP belum ada. |
| K4 | Ubah role | Kelola | — | — | Eskalasi hak akses. | Sesuai. |
| K5 | Ganti email login (pergantian PIC) | Kelola | — | — | Lihat bagian 5. | **Rusak**: akun baru tidak tersambung (S10). |
| K6 | Nonaktifkan akun | Kelola | — (lihat K7) | — | Menghentikan layanan mitra adalah keputusan Admin. | FO boleh menonaktifkan **siapa saja termasuk admin** (`status/route.ts:56`). **Siapa pun yang login** bisa lewat jalur langsung (S1). |
| K7 | Aktifkan kembali / atur ulang akses / akhiri sesi | Kelola | — | — | Pemulihan akses. | "Aktifkan" kemungkinan selalu gagal (S11). |
| K8 | Lihat profil akun sendiri | Lihat | Lihat | Lihat (diri sendiri) | Transparansi. Perubahan lewat Admin. | Tidak ada halaman. |

### L. Tata kelola data & audit

| Kode | Kemampuan | Admin | FO | Petugas | Alasan singkat | Kini |
|---|---|---|---|---|---|---|
| L1 | Riwayat perubahan (audit log) | Kelola | — | — | Pengawasan. | Hanya 20 entri terakhir di halaman Tata Kelola Data. Staf bisa **menulis entri audit palsu** atas nama sendiri (S14). |
| L2 | Dashboard PDP / persetujuan data | Kelola | — | — | Kepatuhan UU PDP. | Sesuai. |
| L3 | Log error / kesehatan sistem | Kelola | — | — | Teknis. | Sesuai. |

### 2b. Sel Petugas yang tidak "—": alasan kuat, keterangan di layar, dan pagar pengaman

| Kode | Alasan kuat | Keterangan siap pakai di layar | Pagar pengaman (ditegakkan DB/server) |
|---|---|---|---|
| A1, A6, A7 (Lihat-L) | Petugas harus tahu nomor loket, prefiks, dan kontak resmi layanannya. | "Data layanan Anda dikelola oleh Admin DPMPTSP. Hubungi Admin bila ada yang keliru." | Baca saja. Hapus izin petugas mengubah tabel `layanan`. |
| B1, B2, B4 (Lihat-L + Ajukan) | Petugas yang paling tahu bila ada cuti atau perubahan jam. Tetapi jadwal resmi mengikuti SOP. | "Jadwal ini ditetapkan Admin sesuai SOP dan jadwal resmi. Perubahan hanya berlaku setelah disetujui Admin. Gunakan tombol **Ajukan Perubahan**." | Petugas tidak punya hak tulis jadwal. Pengajuan disimpan terpisah dan hanya bisa diterapkan Admin. |
| B3 (Lihat) | Perlu tahu hari libur nasional. | — | Baca saja. |
| C1 (Lihat-L) | Melihat pengunjung yang akan dilayaninya. | "Menampilkan kunjungan untuk layanan **{nama layanan}** saja." | Database menyaring per layanan (perbaiki `kunjungan_staff_select`). |
| C2, C3, C4, C5 (Kelola-L) | Inti pekerjaan melayani. | "Anda melayani antrean **{nama layanan}**. Pengunjung layanan lain diatur oleh Front Office." | Setiap aksi dicek ulang di database: petugas aktif + tiket milik layanannya. Data terkunci tidak bisa diubah. |
| D1 (diri sendiri) | Kehadiran membuka antrean. | "Tekan **Saya Sudah Hadir**. Antrean layanan Anda dibuka setelah Front Office memverifikasi kehadiran Anda." | Petugas hanya bisa mengajukan (status menunggu). Persetujuan hanya oleh FO/Admin. Jam diambil dari server. |
| D4 (diri sendiri) | Riwayat kehadiran pribadi. | — | Sudah sesuai. |
| E1, E2, E4 (Kelola-L) | Menjawab pertanyaan spesifik layanannya. | "Chat yang tampil hanya untuk layanan **{nama layanan}**. Setelah Anda ambil alih, bot berhenti menjawab di percakapan ini saja." | Aturan "harus ambil alih dulu" dan "tidak boleh merebut sesi orang lain" dipindah ke database. |
| F1 (Lihat-L) | Tahu apakah bot aktif untuk layanannya. | "Status bot layanan Anda: **Aktif**. Pengaturan bot dikelola Admin." | Baca saja. |
| F2 (Lihat-L + Ajukan) | Petugas yang paling paham isi FAQ. | "FAQ yang Anda tulis disimpan sebagai **usulan** dan baru dipakai bot setelah ditinjau Admin." | FAQ usulan petugas selalu tersimpan nonaktif. Hanya Admin yang bisa mengaktifkan. Petugas tidak bisa menghapus. |
| G2, G3 (Lihat-L) | Laporan kinerja ke instansi mitra. | "Rekap dan ekspor ini hanya berisi data layanan **{nama layanan}**. Setiap ekspor tercatat di log audit." | Server memaksa filter layanan di **semua** tab. Database menyaring tabel rekap per layanan. |
| I1, I2 (Lihat-L) | Umpan balik untuk perbaikan. | "Hasil survei kepuasan untuk layanan Anda. Identitas responden tidak ditampilkan." | Tanpa kolom identitas. |
| K8 (diri sendiri) | Transparansi data diri. | "Data akun dikelola Admin. Bila nomor HP atau email berubah, hubungi Admin." | Baca saja. |

---

## 3. Pola untuk area sensitif SOP

Area: jadwal mingguan, libur, standby/pengecualian, buka/tutup hari ini, bot hidup/mati per layanan, isi FAQ.

| Opsi | Cara kerja | Plus | Minus | Besar kerja |
|---|---|---|---|---|
| **A. Admin saja** | Petugas tidak bisa apa-apa di sistem. Permintaan disampaikan lewat WA atau telepon. | Paling sederhana dan paling aman. | Tidak ada jejak permintaan di sistem. Admin bisa jadi bottleneck. | Kecil |
| **B. Ajukan → Admin setujui** | Petugas mengisi formulir. Usulan disimpan di satu tabel `pengajuan_perubahan` (jenis, layanan, isi usulan, status, pengaju, pemutus, alasan). Admin menekan **Setujui**, lalu sistem menerapkan perubahan. | Ada jejak lengkap. Petugas tetap berperan. Sesuai SOP. | Butuh tabel + 2 layar baru. | Sedang |
| **C. Petugas ubah langsung + notifikasi** | Langsung berlaku. Admin ditinjau belakangan. | Cepat. | **Melanggar prinsip SOP.** Perubahan salah langsung terlihat publik. | Kecil |
| **D. FO darurat hari ini** | FO menekan "Tutup layanan hari ini" atau "Buka" dengan alasan wajib. Hanya berlaku untuk hari ini. Admin otomatis diberi tahu. | Operasional tetap jalan tanpa mengubah jadwal resmi. | Perlu disiplin alasan. | Kecil |

**Rekomendasi:** pakai **A + D sekarang** (Tahap 1–3), lalu **B di Tahap 4**.
- B dipakai untuk jadwal, libur, dan standby. Untuk FAQ cukup "FAQ usulan berstatus nonaktif", tidak perlu tabel baru.
- Opsi C ditolak.
- Bot hidup/mati tetap Admin saja. "Ambil alih" sudah menyelesaikan kebutuhan harian.
- [ASUMSI] Volume perubahan jadwal rendah (beberapa kali per bulan). Bila ternyata tinggi, majukan B.

---

## 4. Peta temuan keamanan (yang harus ditutup agar matriks benar-benar berlaku)

"Jalur langsung" = memanggil database memakai sesi login sendiri, tanpa melewati tampilan. Pengunjung bisa login anonim, jadi **"siapa pun yang login" = siapa pun di internet**.

### P0 — Tutup segera (bisa disalahgunakan orang luar atau merusak operasional)

| ID | Temuan | Dampak nyata | Bukti |
|---|---|---|---|
| S1 | Fungsi `petugas_set_nonaktif` tidak memeriksa siapa pemanggilnya dan terbuka untuk semua yang login | Siapa pun bisa **menonaktifkan admin satu-satunya**, sehingga sistem terkunci. ID petugas bisa diketahui pengunjung lewat sesi chat yang diambil alih. | `202607290004_petugas_aktif.sql:25-48`; inv-server T1 |
| S2 | `catat_absensi`, `catat_pulang`, `panggil_tiket`, `terbit_tiket`, `terbit_nomor_antrean`, `skm_rr_tambah` tanpa cek role | Siapa pun bisa membuka antrean layanan, memalsukan kehadiran, "membakar" nomor antrean, memicu panggilan, dan mengubah statistik SKM. | `202607290011_absensi_gerbang.sql:54-93`; inv-server C |
| S3 | Petugas bisa menyetujui absensinya sendiri: tulis langsung ke tabel tanpa batas kolom, **atau** panggil `catat_absensi` dengan sumber `'fo'` yang otomatis "approved" | Gerbang absensi (yang membuka antrean) tidak berfungsi. | `202607140004…sql:644-648`; `absensi_gerbang.sql:75` |
| S4 | Aturan simpan `kunjungan` dan `tiket_antrean` berbunyi "selalu boleh" (`WITH CHECK (true)`) untuk publik | Siapa pun bisa membuat tiket palsu yang **langsung tampil di layar TV publik**. | inv-server T4 |
| S6 | Petugas bisa mengubah **semua kolom** layanannya, termasuk `is_ptsp`. Petugas layanan PTSP bisa menulis jadwal **semua** layanan | Petugas mana pun bisa menaikkan haknya sendiri, lalu mengubah jadwal seluruh layanan. | inv-server T6; `202607280001_layanan_jadwal.sql:89-96` |

### P1 — Sebelum matriks baru diluncurkan

| ID | Temuan | Dampak | Bukti |
|---|---|---|---|
| S5 | Petugas nonaktif masih lolos | Fungsi bantu `get_my_layanan_id()` dan `is_ptsp_staff()` tidak memeriksa status aktif, sehingga chat, tiket, FAQ, jadwal, dan pengaduan tetap bisa diakses. Gerbang halaman membaca role dari token login sampai token kedaluwarsa. Admin nonaktif masih bisa **mengundang admin baru**. | inv-server T3; `invite/route.ts:47-55` |
| S7 | FO tidak cocok dengan database | FO menyetujui absensi tanpa efek tetapi tampil "berhasil" (M1). Scan QR dan mulai/selesai layanan ditolak untuk FO tanpa layanan (2 dari 3 akun FO). Draf pendataan ditolak (M2). Draf AI ditolak. | inv-server M1, M2; `chat/ai/draft/route.ts:42` |
| S8 | Petugas bisa langsung membuat data pendataan **terkunci**, melewati proses finalisasi. Petugas bisa mengubah kunjungan layanan lain. | Integritas data. | inv-server T7 |
| S9 | Aturan chat (wajib ambil alih, tidak boleh merebut) hanya ada di server, longgar di database | Petugas bisa merebut sesi lewat jalur langsung. | inv-server T7 |
| S10 | **"Ganti PIC" rusak.** Alur ini mengundang email baru sebagai *akun auth baru*, tetapi baris `petugas` tetap menunjuk akun lama. Pemegang baru masuk sebagai *pengunjung* biasa. Pemegang lama hanya dikeluarkan sesinya dan masih bisa login lagi. | Pergantian PIC tidak bekerja. | `petugas/status/route.ts:100-118`; `auth/callback/route.ts:37-45` |
| S11 | "Aktifkan kembali" memanggil fungsi yang mensyaratkan pemanggil admin, tetapi lewat kunci server yang tidak membawa identitas pengguna, sehingga hampir pasti selalu ditolak | Akun yang dinonaktifkan tidak bisa dipulihkan dari layar. [ASUMSI: belum diuji di produksi] | `status/route.ts:89`; `202607290004…sql:58` |
| S12 | Migrasi `202608310003_absensi_foto_fo.sql` belum diterapkan di produksi | Fitur FO catat absensi + foto **gagal di produksi**. Migrasi ini juga tidak menambah cek role, jadi perlu diperbaiki dulu sebelum diterapkan. | inv-server T9 |
| S13 | Pembatasan halaman per role hanya di browser (`AdminGuard`), tidak di server (`proxy.ts:95-114`) | Data tetap dijaga database, tetapi halaman terlarang tetap bisa dibuka. Petugas bisa membaca lead investasi, rekap semua layanan, dan menulis foto UMKM. | inv-ui §0; inv-server M6 |

### P2 — Perapihan

| ID | Temuan |
|---|---|
| S14 | Staf bisa menulis entri audit buatan sendiri. Audit seharusnya hanya ditulis oleh pemicu (trigger) di database. |
| S15 | `buat_pengaduan` / `lacak_pengaduan` bisa dipanggil langsung tanpa batas percobaan (batasan saat ini hanya di memori server). |
| S16 | `match_dokumen` terbuka untuk semua yang login, padahal tidak dipakai kode, jadi bisa dicabut. Data layar TV bisa dibaca tanpa token, tetapi hanya angka agregat (diterima). |
| S17 | Tampilan yang menjanjikan hal yang tidak ada: tab Integritas tampil untuk semua role, tombol Rollup tampil untuk petugas, petugas mengubah pengaduan dapat "sukses palsu" (M3). |
| S18 | Pemilik UMKM bisa mengubah semua kolom inquiry. Inquiry tidak dicek apakah listing-nya tayang. Perbandingan rahasia cron di `faq/embed` tidak timing-safe. |
| S19 | 1 dari 3 akun FO punya `layanan_id`. FO seharusnya lintas layanan; kolom ini dikosongkan agar perilakunya konsisten. |

### Strategi penegakan — satu pola, tiga lapis

1. **Database (hakim)**
   - Satu fungsi bantu `staf_saya()` mengembalikan `(id, role, layanan_id)` **hanya bila akun aktif**.
   - Satu fungsi `boleh_layanan(p_layanan uuid)` = admin/FO → ya; petugas → hanya bila layanannya sama.
   - `get_my_layanan_id()` dan `is_ptsp_staff()` diperbaiki agar memeriksa status aktif. Satu perubahan ini menutup S5 di semua aturan sekaligus. `is_ptsp_staff` lalu dihapus dari aturan jadwal.
   - Setiap fungsi khusus (SECURITY DEFINER) diawali satu baris cek role + layanan. Fungsi yang hanya dipakai internal (`terbit_tiket`, `terbit_nomor_antrean`, `skm_rr_tambah`, `match_dokumen`) **dicabut izin panggilnya** untuk pengguna. Sudah dicek: tidak ada pemanggilan dari `src/`.
   - Perubahan yang hanya menyentuh sebagian kolom (absensi, layanan, chat) dipindah ke fungsi khusus, sehingga pengguna tidak lagi menulis tabel langsung.
2. **Server (API)**
   - Satu helper `requireStaff({ roles, layananId })` di `src/lib/` (perluasan dari `canAccessPelayananStaff`, `lib/pelayanan.ts:38-47`) yang **selalu membaca status aktif dari database**, bukan dari token.
   - Semua route memakai helper ini sebelum menyentuh kunci server.
   - `proxy.ts` ikut memanggil `canAccessAdminPath` sehingga halaman terlarang ditolak di server.
3. **Tampilan**
   - `admin-nav.ts` diperbarui sesuai matriks dan tetap menjadi sumber tunggal untuk menu.
   - Keterangan dari bagian 2b dipasang di layar.
4. **Bukti**
   - Setiap sel matriks yang bernilai "—" atau "-L" punya satu tes perilaku di `npm run test:rls`: coba aksi terlarang → harus ditolak.
   - Catatan: perintah ini **menyentuh DB produksi** (di dalam transaksi yang dibatalkan), jadi perlu izin CEO setiap kali dijalankan.

---

## 5. Kebutuhan baru

### 5.1 Kelola Akun Layanan (Admin)

| Fitur | Cara aman | Catatan |
|---|---|---|
| Ubah nama, **no HP**, layanan | Tambah kolom `petugas.no_hp` (format dicek di server) | No HP akun dipakai untuk kontak internal FO/Admin. Kontak resmi untuk publik tetap di `layanan_kontak` (A6). Keduanya sengaja dibedakan. |
| **Ganti email** (pergantian PIC) | Hanya di server: `auth.admin.updateUserById(auth_user_id, { email, email_confirm: true })` → akhiri semua sesi lama → kirim tautan atur kata sandi ke email baru → catat di audit (email lama disamarkan). | **ID akun dan riwayat tetap sama**, pemegang lama otomatis tidak bisa masuk. Menggantikan "Ganti PIC" yang rusak (S10). Opsi `email_confirm`/`ban_duration` sudah diverifikasi lewat Context7 (supabase-js `AdminUserAttributes`). Perilaku server Supabase untuk email yang sudah dipakai akun lain akan mengembalikan error, dan wajib ditangani di layar. |
| Nonaktifkan | Status aktif = false **+ akhiri semua sesi + blokir login** (`ban_duration`) | Menutup celah "token masih berlaku" (S5). |
| Aktifkan kembali | Cabut blokir + aktif = true, lewat helper server yang benar | Memperbaiki S11. |
| Atur ulang akses | Akhiri sesi + kirim tautan atur ulang ke email yang terdaftar | Untuk "lupa kata sandi" atau HP hilang. |
| Indikator **"Belum pernah login"** / "Undangan belum diterima" | Server membaca `last_sign_in_at` dan status konfirmasi dari Supabase Auth (cukup daftar beberapa puluh akun; tidak perlu disalin ke tabel) | Tampil sebagai label di daftar akun, beserta tombol "Kirim ulang undangan". |
| Pagar pengaman | Tidak bisa menonaktifkan atau menurunkan **diri sendiri**. Tidak bisa menghilangkan **admin aktif terakhir**. FO tidak pernah bisa menyentuh akun admin. | Penting karena admin aktif saat ini hanya 1. |

### 5.2 Kelola Layanan (Admin) — fitur baru

Satu halaman untuk A1/A2/F1/B5:
- nama, nomor loket, prefiks
- status tampil di halaman utama/check-in (`status_tampilan`)
- **tampil di layar TV** (kolom baru, lalu view `v_layar_antrian` ikut menyaring)
- punya antrean/chat
- bot hidup/mati

FO melihat halaman yang sama dalam mode baca, ditambah tombol **"Tutup hari ini / Buka hari ini"** (Darurat).

### 5.3 Audit log

- Tabel `audit_log` sudah ada. Yang dibutuhkan:
  - penulisan **hanya oleh pemicu (trigger) di database** (menutup S14)
  - cakupan diperluas ke jadwal, libur, layanan, pengaturan situs, landing, FAQ, bot, token layar, akun, dan aksi darurat FO
  - setiap entri menyimpan nilai lama → baru dan alasannya
- Halaman **"Riwayat Perubahan"** untuk Admin dengan filter jenis, layanan, orang, dan tanggal.

---

## 6. Apakah 3 role cukup?

**Ya, cukup.** Alasannya:
- **Auditor / admin baca-saja:** kebutuhannya belum nyata. Pemeriksa (mis. Inspektorat) bisa dilayani dengan ekspor rekap + Riwayat Perubahan. Menambah role berarti melipatgandakan matriks dan tes.
- **Pimpinan (dashboard saja):** bisa ditambah nanti bila diminta. Polanya sama dengan FO "Lihat".
- **Risiko nyata saat ini bukan kurangnya role**, melainkan:
  - **hanya 1 admin aktif** → tambah 1 akun admin cadangan
  - **akun bersama** → tidak bisa dibedakan siapa orang yang bertindak

**Saran untuk akun bersama (bila disetujui, K1):** saat FO mencatat absensi + foto, isi juga **"nama petugas yang bertugas hari ini"**. Dengan begitu, tetap ada jejak orangnya per hari tanpa perlu akun pribadi.

**Petugas layanan PTSP (internal DPMPTSP):** hak istimewa jadwal mereka dicabut. Bila staf DPMPTSP memang perlu mengatur jadwal, berikan role FO atau Admin, bukan pengecualian di dalam role petugas.

---

## 7. Daftar keputusan untuk CEO

| # | Keputusan | Pilihan | Rekomendasi |
|---|---|---|---|
| K1 | Model akun mitra | (a) Akun **bersama** per layanan, sesuai arahan CEO · (b) Akun **pribadi**, sesuai `KEBIJAKAN_AKUN_MITRA.md` | **(a)** Ditambah pencatatan nama petugas bertugas saat absensi. Dokumen kebijakan diperbarui agar tidak bertentangan. |
| K2 | Perubahan jadwal/libur | A Admin saja · B Ajukan→setujui · C Petugas langsung | **A sekarang, B di Tahap 4.** C ditolak. |
| K3 | Pengaduan | (a) Admin saja · (b) FO ikut melihat & menindaklanjuti jalur layanan | **(a)** sesuai arahan CEO. Pertimbangkan (b) bila volume aduan tinggi. |
| K4 | FO boleh tutup/buka layanan **hari ini** saat darurat? | Ya / Tidak | **Ya**, dengan alasan wajib + Admin diberi tahu otomatis. |
| K5 | Siapa boleh mematikan bot per layanan? | Admin · Admin + FO | **Admin saja.** FO dan petugas memakai "Ambil alih" per percakapan. |
| K6 | FAQ dari petugas | (a) Petugas usul, Admin terbitkan · (b) Petugas langsung terbit | **(a)** |
| K7 | FO boleh menonaktifkan akun? | Ya (kecuali admin) · Tidak | **Tidak.** Hanya Admin, dan tambah admin cadangan (K10). |
| K8 | Petugas boleh lihat & ekspor rekap layanannya? | Ya / Tidak | **Ya**, layanannya saja dan tercatat. |
| K9 | Petugas boleh lihat hasil SKM layanannya? | Ya / Tidak | **Ya**, tanpa identitas responden. |
| K10 | Tambah role auditor / akun admin kedua | Role baru · Admin cadangan · Tidak keduanya | **Admin cadangan**, tanpa role baru. |

---

## 8. Urutan kerja bertahap

Semua migrasi menyentuh **DB produksi**, jadi masing-masing perlu persetujuan CEO sebelum diterapkan (aturan proyek).

| Tahap | Isi | Besar |
|---|---|---|
| **0. Keamanan darurat** | S1–S4, S6 + bagian database dari S5:<br>• cek role di semua fungsi khusus; cabut izin fungsi internal<br>• hapus aturan "selalu boleh" pada kunjungan/tiket. [ASUMSI] Check-in tetap jalan karena tiket dibuat oleh pemicu khusus (`sync_visit_dual_write` SECURITY DEFINER, `202607300015…sql:207-212`). **Wajib diuji.**<br>• kunci kolom absensi dan layanan<br>• fungsi bantu memeriksa status aktif<br>• cek status aktif di route yang memakai kunci server<br>Satu migrasi + tes kontrak + tes perilaku. | **Sedang** |
| **1. Matriks inti** | • helper `requireStaff` di semua route<br>• `proxy.ts` menegakkan akses per halaman<br>• `admin-nav.ts` sesuai matriks (Jadwal & Pengaduan hilang dari menu petugas; Dashboard untuk FO)<br>• perbaiki ketidakcocokan FO (S7)<br>• penyaringan per layanan untuk petugas (C1, G2, G3, J3)<br>• perbaiki migrasi foto absensi lalu terapkan (S12)<br>• FAQ petugas menjadi usulan<br>• pasang keterangan layar (2b) | **Besar** |
| **2. Kelola Akun Layanan** | Bagian 5.1: kolom no HP, ganti email aman, nonaktif + blokir, aktifkan, atur ulang akses, label "belum pernah login", pagar admin terakhir, akun admin cadangan | **Sedang** |
| **3. Kelola Layanan** | Bagian 5.2: tampil di layar TV/halaman utama, bot, data layanan. Tombol darurat FO "tutup/buka hari ini". | **Sedang** |
| **4. Pengajuan & Riwayat** | Tabel `pengajuan_perubahan` + layar Ajukan (petugas) / Setujui (Admin) untuk jadwal, libur, standby. Audit via pemicu + halaman Riwayat Perubahan. | **Sedang** |
| **5. Perapihan** | P2 (S14–S19). Pengaturan penyedia AI dari layar, non-rahasia (A8), untuk mendukung ganti ke LLM gratis. Keputusan soal dokumen peraturan yang belum dipakai bot (F5). | **Kecil–Sedang** |

**Catatan rencana ganti LLM:** model role ini tidak memotong fungsi bot sama sekali. Tetapi "indeks makna" FAQ saat ini dibuat dengan model Gemini (3072 dimensi). Bila Gemini diganti, cara pembuatan indeks ini ikut harus dipikirkan. Pencarian teks biasa (`match_faq_teks`) tetap bisa menjadi cadangan. Ini di luar lingkup role dan perlu dibahas terpisah.

## Ketidakpastian yang diakui

- Perilaku aturan database dibaca dari teks aturannya, belum diuji dengan menulis ke produksi (sesuai inventaris).
- S11 dan kebebasan dari efek samping saat menghapus aturan publik kunjungan/tiket **belum diuji**.
- Frekuensi perubahan jadwal dan volume pengaduan diasumsikan rendah.
- Apakah bot memang seharusnya memakai dokumen peraturan (F5) perlu dikonfirmasi ke tim.
