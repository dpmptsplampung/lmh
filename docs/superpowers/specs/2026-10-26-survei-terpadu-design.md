# Survei Terpadu (SPAK + SKM), Saran, dan Pengaduan Terhubung: desain

Tanggal: 2026-10-26. Status: **draf menunggu tinjauan pemilik**. Hasil brainstorming dengan pemilik (semua keputusan di §2 disetujui pemilik di percakapan). Belum ada kode atau migrasi yang ditulis. Rencana implementasi dibuat sesudah spec ini disetujui (skill `writing-plans`).

## 1. Tujuan dan ruang lingkup

Pengunjung yang layanannya sudah selesai memindai **QR di layar staf**, mengisi dua survei (SPAK lalu SKM) dalam wizard HP yang mulus, lalu boleh menyampaikan saran atau pengaduan. Hasilnya tersimpan di tabel terpisah, bisa diunduh Admin dan FO, dan statusnya tampil di antrean dan halaman FO. Pengaduan ditindaklanjuti FO (dengan foto atau dokumen), dipantau pelapor hanya dengan nomor laporan, dan bisa dikirim ke email.

Termasuk: tabel dan RPC baru, wizard, QR dan status untuk staf, unduhan, pengaduan dari wizard, email tindak lanjut, skrip impor data situs lama.
Di luar scope: lihat §14.

## 2. Keputusan yang disepakati

| # | Keputusan |
|---|---|
| 1 | Dua survei berbeda, satu alur wizard, **dua tabel jawaban** (`skm_respons` diperluas, `spak_respons` baru). |
| 2 | Pertanyaan dan rentang jawaban **tidak diubah** dari draf pemilik (lihat Lampiran A). Hanya ejaan: "liar" dan "percaloan". Judul bagian A SPAK dibiarkan. |
| 3 | SKM 11 unsur (9 unsur lama + Transparansi + Integritas). Dasar aturan dan rumus sudah ditetapkan pemilik; IKM = rata-rata unsur yang terisi × 25. |
| 4 | Tautan = token acak terpisah dari `qr_token`, berlaku **32 jam sejak kunjungan selesai**, **hanya ditampilkan sebagai QR di layar staf** (tidak pernah sebagai teks tautan). |
| 5 | QR muncul setelah FO menyelesaikan, atau petugas layanan menekan "selesaikan layanan" (saat `kunjungan.status` menjadi `selesai`). Staf bisa menampilkan ulang QR selama masih berlaku. |
| 6 | Jawaban dikirim **sekali di akhir wizard**, atomik. Terikat ke kunjungan. Pengunjung tidak mengisi data diri. Responden baru **tanpa profil** (tidak ada jenis kelamin atau pendidikan). |
| 7 | Wizard: **5 langkah** (SPAK 3+2, SKM 4+4+3), dua wizard terpisah. Ketuk jawaban terakhir langsung lanjut **tanpa delay**. Jawaban terakhir SKM langsung mengirim. Next dan Back tetap ada. |
| 8 | Layar akhir: **Sampaikan saran**, **Laporkan pengaduan**, atau **Selesai**. Boleh anonim ("Jangan catat data diri saya"). |
| 9 | Pengaduan dari wizard: **satu jalur ke FO** (jalur `layanan`), Admin juga membaca semua. |
| 10 | Pantau pengaduan **hanya dengan nomor laporan** (tanpa nomor HP). Nomor baru 8 karakter acak. |
| 11 | FO menanggapi dengan teks dan lampiran (foto atau dokumen). Tanggapan tampil di halaman pantau dan bisa dikirim ke email pelapor (berisi **tautan**, bukan lampiran langsung). |
| 12 | Unduhan oleh **Admin dan semua FO**. Status sudah/belum isi tampil di `/admin/antrian` dan `/admin/kunjungan`. |
| 13 | Data situs lama diimpor lewat skrip sekali jalan. Nama, telepon, dan email lama **tidak diimpor** (default). |
| 14 | Pengerjaan bertahap: Fase A (survei), B (saran dan pengaduan), C (impor dan cutover). Dashboard pimpinan dibuat kemudian. |

Default yang bisa diubah pemilik: petugas layanan **tidak** membaca SPAK, saran, maupun pengaduan dari wizard; unduhan tanpa nama, HP, dan email; kunjungan yang selesai di FO dinilai sebagai unit "Front Office".

## 3. Alur end-to-end

1. FO mendaftarkan pengunjung (walk-in atau reservasi). Data kunjungan menjadi acuan.
2. FO menyelesaikan (`fo_selesai`), atau petugas layanan menyelesaikan (`layanan_selesai`). Bila tidak ada penanganan yang masih berjalan, `kunjungan.status` menjadi `selesai` (mekanisme yang sudah ada).
3. Trigger pada `kunjungan` membuat baris `survei_undangan` (idempoten). UI staf memanggil `ambil_qr_survei` dan menampilkan dialog QR.
4. Pengunjung memindai QR: `/survei/<token>`. Wizard SPAK lalu SKM. Jawaban terakhir memicu `kirim_survei`.
5. Layar akhir: saran, pengaduan, atau selesai. Pengaduan menghasilkan nomor laporan.
6. FO menindaklanjuti di `/admin/pengaduan`, menanggapi (teks, lampiran, email opsional). Pelapor memantau di `/pengaduan/lacak` dengan nomor.

## 4. Model data

Semua perubahan **aditif** (tanpa menghapus kolom atau data produksi). Migrasi forward baru bernomor di atas `202610260001`, masing-masing dengan test kontrak, rollback di `docs/`, entri `MANIFEST.json`, `docs/MIGRATIONS.md`, dan `docs/analysis/DB-CHANGES.md` (aturan `docs/ATURAN_MIGRASI.md`).

### 4.1 `survei_undangan` (baru)
- `id`, `kunjungan_id` (unik, FK `kunjungan` ON DELETE CASCADE), `token` (unik, 64 karakter heksadesimal dari dua `gen_random_uuid()` (CSPRNG) yang digabung tanpa tanda hubung, sekitar 244 bit entropi, tanpa ekstensi tambahan), `layanan_id` (boleh kosong), `unit` (`layanan` atau `fo`), `dibuat_pada`, `kedaluwarsa_pada` (= `kunjungan.selesai_at` + 32 jam), `diisi_pada`, `saran_dikirim` (bool), `pengaduan_dikirim` (bool).
- `unit` dan `layanan_id` dihitung dari `kunjungan_layanan_skm(kunjungan_id)`; hasil `NULL` berarti `unit = fo`.
- Status turunan, tanpa kolom: `diisi_pada` terisi = Sudah diisi; lewat `kedaluwarsa_pada` = Kedaluwarsa; selain itu Belum diisi. Kunjungan tanpa undangan (belum selesai, batal, no-show, atau sebelum fitur ini) tampil "—".
- Fungsi idempoten `ensure_undangan(kunjungan_id)` dipanggil trigger `AFTER UPDATE` pada `kunjungan` (status menjadi `selesai`) dan oleh `notify_kunjungan_status`, sehingga urutan trigger tidak berpengaruh. Kunjungan lama tidak di-backfill.
- Tanpa akses langsung dari klien. Akses lewat RPC dan view (§5, §6).

### 4.2 `skm_respons` (diperluas)
- Tambah `u10_transparansi`, `u11_integritas` (`smallint`, CHECK 1–4, boleh kosong).
- Tambah `versi` (`smallint`, default 1; baris baru 2), `sumber` (`form_lama` | `wizard` | `impor`, default `form_lama`), `unit` (`layanan` | `fo` | `tidak_diketahui`, default `tidak_diketahui`), `jenis_kelamin` dan `pendidikan` (teks asli, boleh kosong; hanya impor).
- Migrasi menandai baris lama ber-`layanan_id` sebagai `unit = layanan`; yang `layanan_id`-nya kosong tetap `tidak_diketahui` (tidak bisa dibedakan dari FO).
- Nilai: Sangat Baik = 4, Baik = 3, Cukup = 2, Kurang = 1.
- Constraint: `sumber = wizard` mewajibkan `kunjungan_id` terisi dan `versi = 2`. Indeks unik parsial `kunjungan_id` yang ada tetap menjamin satu jawaban per kunjungan.
- Kolom lama `visit_id` dan `saran` tidak dipakai alur baru (diberi komentar).
- `hitung_ikm` tetap kompatibel dan dihitung dari rata-rata unsur terisi × 25. RPC baru `ringkasan_ikm(p_start, p_end)` mengembalikan baris per layanan, "Front Office", dan "Tidak terklasifikasi".
- View `v_skm_petugas` (petugas, tanpa identitas) ditambah `u10` dan `u11`.
- `skm_response_rate` tetap diisi trigger yang ada. Response rate baru (termasuk FO) dihitung dari `survei_undangan`.

### 4.3 `spak_respons` (baru)
- `id`, `kunjungan_id` (unik, boleh kosong untuk impor), `layanan_id`, `unit`, `sumber` (`wizard` | `impor`), `p1_tanpa_diskriminasi`, `p2_tanpa_kecurangan`, `p3_tanpa_imbalan`, `p4_tanpa_pungli`, `p5_tanpa_percaloan` (`smallint` NOT NULL, CHECK 1–6; 6 = Sangat Setuju), `jenis_kelamin`, `pendidikan` (impor saja), `created_at`.

### 4.4 `saran` (baru)
- `id`, `isi` (1–2000 karakter), `layanan_id`, `unit`, `kunjungan_id` (kosong bila anonim), `pelapor_nama` (kosong bila anonim), `sumber` (`wizard` | `impor`), `created_at`.

### 4.5 Pengaduan (diperluas)
- `pengaduan` (ada): tambah `sumber` (`web` default | `wizard` | `impor`), `kunjungan_id` (kosong bila anonim; ON DELETE SET NULL), `pelapor_nama`, `pelapor_email`. Pengaduan dari wizard selalu `jalur = layanan` dan tidak memakai kolom `kontak` (nomor laporan adalah kunci pantau); nomor HP pengunjung tetap terlihat FO lewat kunjungan terkait. SLA 3 dan 14 hari kerja, riwayat, dan cron eskalasi dipakai ulang.
- Nomor baru untuk pengaduan wizard: `generate_nomor_laporan()` = `P` + 8 karakter dari alfabet 31 karakter yang sama dengan generator lama, dengan percobaan ulang bila bentrok. Tampilan `P-XXXX-XXXX`; input boleh dengan atau tanpa tanda hubung dan huruf besar atau kecil.
- `pengaduan_tanggapan` (baru): `id`, `pengaduan_id` (FK CASCADE), `isi` (1–2000), `status_baru` (boleh kosong, nilai status pengaduan), `kirim_email` (bool), `email_dikirim_at`, `dibuat_oleh` (FK `petugas`), `created_at`. Catatan internal tetap di `pengaduan_riwayat.catatan`.
- `pengaduan_lampiran` (baru): `id`, `tanggapan_id` (FK CASCADE), `storage_path` (unik), `nama_asli` (≤ 200), `mime`, `ukuran`, `created_at`. Disimpan di bucket **privat baru** `pengaduan-tanggapan` (terpisah dari `pengaduan-bukti`), tanpa policy storage untuk klien.

## 5. RPC dan API

| Nama | Pemanggil | Fungsi |
|---|---|---|
| `get_survei_context(token)` | anon (RPC langsung) | status (`ok`, `kedaluwarsa`, `sudah_diisi`, `tidak_valid`), label unit, batas waktu, `bisa_saran`, `bisa_pengaduan`, identitas **tersamar** (nama, HP, email) untuk pratinjau |
| `POST /api/survei/kirim` → `kirim_survei(token, spak jsonb, skm jsonb)` | anon via route | satu transaksi: kunci undangan, cek belum terisi dan belum kedaluwarsa (jam database), validasi ketat (kunci lengkap, bilangan bulat, SPAK 1–6, SKM 1–4, kunci asing ditolak), sisipkan `spak_respons` dan `skm_respons`, isi `diisi_pada`. Hasil: `submitted`, `invalid`, `expired`, `duplicate`, `not_found` |
| `POST /api/survei/saran` → `kirim_saran(token, isi, anonim)` | anon via route | syarat survei sudah terkirim; satu kali per undangan; berlaku sampai `kedaluwarsa_pada` atau 30 menit setelah `diisi_pada`, mana yang lebih lama |
| `POST /api/survei/pengaduan` → `kirim_pengaduan(token, isi, anonim)` | anon via route | sama; membuat pengaduan `jalur = layanan`, nomor laporan, riwayat awal; email "diterima" bila ada email dan tidak anonim |
| `ambil_qr_survei(kunjungan_id)` | staf | penjaga `boleh_kunjungan`; mengembalikan status, dan token hanya bila belum diisi dan belum kedaluwarsa |
| view `v_survei_status` | staf | status per kunjungan (Admin dan FO semua, petugas sesuai `boleh_kunjungan`) |
| `lacak_pengaduan(nomor)` dan `tanggapan_pengaduan(nomor)` | anon via route | status, riwayat publik, dan tanggapan (hanya yang untuk pelapor). Menggantikan varian yang meminta kontak |
| `GET /api/pengaduan/lacak/lampiran` | anon via route | memverifikasi nomor lalu menerbitkan tautan bertanda tangan berumur 60 detik, dengan baris audit (pola `/api/investment-docs/signed-url`) |
| `tanggapi_pengaduan(...)` dan `POST /api/admin/pengaduan/[id]/tanggapan` (multipart) | Admin, FO | route memvalidasi berkas lalu mengunggah ke bucket, RPC menyisipkan tanggapan, lampiran, perubahan status, dan riwayat secara atomik; bila RPC gagal, berkas yang sudah terunggah dihapus |
| `GET /api/admin/survei/export` | Admin, FO | unduhan XLSX (§9) |

- Semua RPC anon `SECURITY DEFINER`, `search_path` tetap, `REVOKE` dari `PUBLIC`, lalu `GRANT` eksplisit.
- Penulisan dari anon lewat route handler (zod, log `logServerEvent`), seperti `/api/skm/submit`. Di Fase A route kirim cukup mengandalkan token yang tak tertebak dan batas satu kali per undangan. Di Fase B pembatasan laju berbasis IP untuk saran, pengaduan, dan pantau memakai fungsi dan tabel baru yang dipanggil service role (`check_anon_rate` tidak cocok karena hanya untuk pengguna terautentikasi), menggantikan bucket memori per instance di route lacak.
- Berkas tanggapan: JPG, PNG, WEBP, PDF, DOCX, XLSX; maksimal 5 MB per berkas dan 3 berkas per tanggapan; jenis diperiksa dari isi berkas (bukan hanya ekstensi); nama penyimpanan diacak; unduhan dokumen dengan `Content-Disposition: attachment`.

## 6. Hak akses

| Objek | Admin | FO | Petugas layanan | Anonim |
|---|---|---|---|---|
| `survei_undangan` | via RPC dan view | via RPC dan view | view sesuai `boleh_kunjungan` | tidak ada |
| `skm_respons` | baca | baca | `v_skm_petugas` (tanpa identitas) | tidak ada |
| `spak_respons` | baca | baca | **tidak** | tidak ada |
| `saran` | baca | baca | **tidak** | tidak ada |
| `pengaduan` (sumber `wizard`) | baca, ubah | baca, ubah | **tidak** (predikat policy petugas ditambah `sumber <> 'wizard'`) | tidak ada |
| `pengaduan_tanggapan`, `pengaduan_lampiran` | baca, tulis via RPC | baca, tulis via RPC | tidak | hanya lewat RPC dan route pantau |

- Semua policy baru `TO authenticated` (ada penjaga umum di test kontrak `standar_pelayanan_rls.test.ts` untuk pola policy yang memanggil `get_my_role()` tanpa `TO`).
- Tidak ada tulis langsung dari klien ke tabel jawaban, saran, atau pengaduan.
- Anonim: tanpa `kunjungan_id`, nama, HP, dan email; hanya unit dan waktu. Korelasi lewat jam tetap mungkin dan diterima.

## 7. Antarmuka

### 7.1 Wizard `/survei/<token>`
- Mobile-first, kolom tunggal (maks. 480 px di layar lebar), target ketuk ≥ 48 px, nyaman di lebar 320 px.
- Pertanyaan, label skala, dan pembagian langkah ada di satu berkas `src/lib/survei/pertanyaan.ts` (sumber tunggal untuk wizard, validasi, dan uji).
- Langkah: SPAK (3 soal, 2 soal), SKM (4, 4, 3 unsur). Penanda "Survei 1 dari 2" dan "Survei 2 dari 2".
- SPAK: baris 6 kotak angka dengan legenda skala dan label jawaban terpilih. SKM: satu baris 4 segmen berlabel (Sangat Baik, Baik, Cukup, Kurang).
- **Tanpa delay**: ketukan jawaban terakhir di sebuah langkah langsung pindah ke langkah berikutnya. Dalam satu langkah, setelah sebuah soal dijawab layar menggulir ke soal berikutnya yang belum dijawab. Kembali ke langkah yang sudah terjawab tidak memicu auto-lanjut sampai jawaban diubah. Semua soal wajib. Next aktif hanya bila langkah lengkap. Tombol Back HP berfungsi sebagai Back langkah.
- Jawaban terakhir SKM langsung memanggil `kirim_survei` (spinner; gagal jaringan menampilkan `ErrorRetry` dengan jawaban tetap di layar).
- Aksesibilitas: kelompok radio berlabel; fokus pindah ke judul langkah dengan pengumuman "Langkah 2 dari 5"; auto-lanjut hanya untuk ketukan atau klik (pilihan lewat keyboard memakai Next); pengunjung diberi tahu di awal bahwa halaman otomatis lanjut; animasi mati bila `prefers-reduced-motion`.
- Jawaban sementara di `sessionStorage`, dibersihkan setelah terkirim. Tidak ada antrean offline.
- Status `kedaluwarsa`, `sudah_diisi`, `tidak_valid` tampil sebagai pesan ramah tanpa kata "token".

### 7.2 Layar akhir
- "Terima kasih, jawaban Anda sudah terkirim." / "Ada masukan untuk kami, atau hal kurang baik yang ingin Anda laporkan?" / tombol **Sampaikan saran**, **Laporkan pengaduan**, **Tidak ada, selesai**.
- Formulir satu kolom isi dan kotak "Jangan catat data diri saya" (tidak dicentang bawaan) dengan pratinjau data tersamar yang akan dicatat.
- Pengaduan terkirim: nomor laporan besar, petunjuk menyimpan nomor, dan tautan `/pengaduan/lacak`. Bila email ada, disebutkan bahwa salinan dikirim ke email. Bila anonim, dijelaskan bahwa nomor adalah satu-satunya cara memantau.

### 7.3 Staf
- Dialog QR setelah `fo_selesai` atau `layanan_selesai` berhasil dan kunjungan menjadi selesai (nama layanan, "berlaku sampai ...").
- Lencana status ("Belum diisi", "Sudah diisi", "Kedaluwarsa") dan tombol "Tampilkan QR" di `/admin/antrian` dan `/admin/kunjungan`; penempatan di halaman FO lain dipastikan saat implementasi.

### 7.4 `/admin/skm`
- Tab IKM (ada, memakai `ringkasan_ikm`), SPAK (rata-rata per pernyataan per unit), Saran; tombol Unduh. Tab SPAK dan Saran hanya untuk Admin dan FO (petugas tetap hanya SKM per layanannya).

### 7.5 `/admin/pengaduan`
- Menampilkan sumber, data diri (bila tidak anonim), kolom "Tanggapan untuk pelapor", unggah lampiran (foto atau dokumen), kotak "Kirim juga ke email pelapor" (aktif bila email ada dan tidak anonim, dicentang bawaan), dan tombol "Selesaikan sekarang" (status selesai dan tanggapan dalam satu langkah).
- Peringatan di layar FO: tanggapan dan lampiran bisa dilihat siapa pun yang memegang nomor laporan, jangan cantumkan data pribadi.

### 7.6 `/pengaduan/lacak`
- Hanya satu isian: nomor laporan. Menampilkan status, riwayat publik, tanggapan, dan lampiran (unduh lewat tautan berumur pendek). Nomor yang salah selalu dijawab "tidak ditemukan". Teks di halaman `/pengaduan` yang menyebut kontak untuk pelacakan, atau menyebut pengaduan anonim tidak bisa dilacak, disesuaikan karena kini semua pengaduan dipantau dengan nomor.

## 8. Email

- Lewat `queue_notifikasi` (kanal `email`, jalur Resend yang ada), hanya bila `pelapor_email` ada dan pengaduan tidak anonim: diterima, diproses, selesai, ditolak (membawa tanggapan terakhir bila ada), dan setiap tanggapan yang dicentang kirim email.
- Isi email: teks tanggapan dan tautan ke `/pengaduan/lacak` dengan nomor laporan; **lampiran tidak disertakan langsung**.
- Kunci idempotensi per kejadian (pengaduan, status, atau tanggapan). Tidak pernah dikirim untuk `sumber = impor`.
- `notify_kunjungan_status` diperbarui: email dan push survei memakai token undangan dan URL `/survei/<token>` sebagai jalur tambahan. Tautan lama `/skm?token=` (berbasis `qr_token`) tetap berfungsi untuk email yang sudah terkirim.

## 9. Unduhan

- `GET /api/admin/survei/export` untuk Admin dan FO. Filter periode (WIB) dan unit. Satu file XLSX dengan sheet SPAK, SKM, Saran, Ringkasan (termasuk response rate dari `survei_undangan`), dan Legenda skala. Memakai pola ExcelJS di `src/lib/rekap` dan penjaga CSV di `src/lib/csv.ts`.
- Header SPAK memuat teks pernyataan lengkap. Kolom identitas hanya: tanggal kunjungan, unit, kategori pengunjung, dan kode kunjungan. Tanpa nama, HP, dan email.

## 10. Impor data situs lama

- Sumber (hasil pengamatan halaman publik situs lama): SKM lama (jenis kelamin, pendidikan, nama dan telepon opsional, U1–U11), SPAK lama (Google Form: nama, HP, jenis kelamin, pendidikan, penilaian 1–6), Saran dan Pengaduan lama (nama, email, jenis pesan, pesan). Tidak ada data unit.
- Skrip sekali jalan `scripts/import-survei-lama.mjs`, masukan berupa berkas CSV hasil ekspor (bukan koneksi ke situs lama). Mode `--dry-run` bawaan; `--apply --yes` menulis dalam satu transaksi; idempoten lewat hash baris; melaporkan jumlah per tabel.
- Tujuan: SKM ke `skm_respons` (`sumber = impor`, `versi = 2`, `unit = tidak_diketahui`, jenis kelamin dan pendidikan sebagai teks asli); SPAK ke `spak_respons`; saran ke `saran`; pengaduan ke `pengaduan` (`sumber = impor`, status `selesai`, riwayat "diimpor dari sistem lama", tanpa email keluar). `created_at` memakai tanggal asli bila ada.
- Nama, telepon, dan email lama tidak diimpor (default).
- Skrip menyentuh DB produksi, jadi dijalankan pemilik setelah konfirmasi, dry-run dulu. Pengujian hanya lokal (PGlite) dengan CSV contoh.

## 11. Fase pengerjaan

- **Fase A:** `survei_undangan` dan trigger, perluasan `skm_respons`, `spak_respons`, RPC context dan kirim, route kirim, wizard, dialog QR, lencana status, unduhan, tab di `/admin/skm`.
- **Fase B:** `saran`, perluasan pengaduan, tanggapan dan lampiran, route dan RPC saran dan pengaduan, layar akhir, `/admin/pengaduan` dan `/pengaduan/lacak` baru, email.
- **Fase C:** skrip impor, cutover dari situs lama.
- Tiap fase punya rencana implementasi dan migrasinya sendiri. Fase B bergantung pada A. Dashboard pimpinan dapat dibangun kapan saja sesudah A.

## 12. Pengujian

- **Kontrak statis migrasi** (pola `supabase/migrations/*.test.ts`): bentuk tabel, CHECK, daftar RPC dan hak EXECUTE, `search_path`, policy `TO authenticated`, rollback, manifest. Rentang CHECK sama dengan konfigurasi `pertanyaan.ts`.
- **Perilaku RLS dan RPC secara lokal** di PGlite (Postgres WASM, tanpa DB produksi): anon tidak bisa membaca tabel, `kirim_survei` atomik dan menolak kedaluwarsa, duplikat, dan payload tak valid, saran dan pengaduan anonim tidak menyimpan identitas, pelapor tidak bisa melihat catatan internal. `npm run test:rls` terhubung ke produksi, jadi tidak dipakai.
- **Komponen**: auto-lanjut, Back, keyboard tidak auto-lanjut, pemulihan `sessionStorage`, isi payload, layar akhir, dialog QR, lencana status.
- **Golden**: teks pertanyaan, label skala, dan pembagian langkah sama dengan Lampiran A.
- **API**: validasi zod, pembatasan laju, jenis dan ukuran berkas, kegagalan RPC yang menghapus berkas terunggah.
- **Impor**: CSV contoh, dry-run tidak menulis, idempoten saat diulang.

## 13. Risiko dan catatan

- Nomor laporan adalah satu-satunya kunci pantau: dikuatkan menjadi 8 karakter acak, dibatasi laju, dan jawaban seragam. Tanggapan publik hanya yang ditandai untuk pelapor.
- Laporan tentang FO dibaca FO (keputusan pemilik). Admin membaca semua.
- Pengaduan anonim tidak menyimpan identitas, tetapi waktu pengiriman dapat dikorelasikan dengan waktu selesai kunjungan.
- Migrasi `202610260001` (perbaikan RLS `standar_pelayanan`) belum diterapkan. Migrasi survei harus memakai `TO authenticated` pada policy baru agar tidak terkena masalah yang sama.
- Pelaksanaan menyentuh `notify_kunjungan_status` (fungsi besar dari `202610140007`): diganti dengan `CREATE OR REPLACE` penuh dan penjaga prasyarat seperti migrasi 0013 dan 0014.
- CSP: tautan bertanda tangan berasal dari origin Supabase yang sudah ada di `img-src`; unduhan dokumen tidak memerlukan origin baru. Dipastikan lagi saat implementasi.

## 14. Di luar scope

- Dashboard pimpinan (role baca-saja baru lewat `src/lib/admin-nav.ts` dan view ringkasan).
- Realisasi Investasi (slideshow di situs lama).
- Jalur pengaduan **integritas** di halaman `/pengaduan` yang berdiri sendiri (tetap seperti sekarang).
- Pengiriman tautan lewat WhatsApp.
- Profil responden pada data baru.
- Masalah RLS `layanan_kontak` (butuh keputusan pemilik terpisah).
- Penghapusan halaman `/skm` lama dan situs survei lama.

## Lampiran A: teks survei (sumber untuk `pertanyaan.ts` dan uji golden)

Kapitalisasi awal kalimat diseragamkan; kata-kata tidak diubah kecuali dua ejaan yang disetujui (liar, percaloan).

**Survey Persepsi Anti Korupsi.** Instruksi: "Berikan penilaian Anda dari skala 1-6 dengan keterangan sebagai berikut". Skala: 1 Sangat Tidak Setuju, 2 Tidak Setuju, 3 Kurang Setuju, 4 Cukup Setuju, 5 Setuju, 6 Sangat Setuju. Judul bagian: "A. PERTANYAAN TERKAIT SURVEY PERSEPSI KUALITAS PELAYANAN" (dibiarkan).
1. Tidak ada diskriminasi pelayanan pada unit layanan ini
2. Tidak ada pelayanan diluar prosedur/kecurangan pelayanan pada unit layanan ini
3. Tidak ada penerimaan imbalan uang/barang/fasilitas diluar ketentuan yang berlaku pada unit layanan ini
4. Tidak ada pungutan liar (pungli) pada unit layanan ini
5. Tidak ada percaloan/perantara tidak resmi pada unit layanan ini

**Survey Kepuasan Masyarakat.** Jawaban: Sangat Baik (4), Baik (3), Cukup (2), Kurang (1).
1. Persyaratan Pelayanan
2. Prosedur Pelayanan
3. Waktu Pelayanan
4. Tarif Pelayanan
5. Produk/Hasil Pelayanan
6. Kemampuan Petugas Pelayanan
7. Perilaku Petugas Pelayanan
8. Kualitas Sarana dan Prasarana
9. Mekanisme Pengaduan
10. Transparansi Pelayanan
11. Integritas Petugas Pelayanan

**Pembagian langkah:** SPAK 1–3 dan 4–5; SKM 1–4, 5–8, dan 9–11.
