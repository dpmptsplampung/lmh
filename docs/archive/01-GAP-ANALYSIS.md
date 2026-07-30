# 01 — GAP ANALYSIS (FASE B)

> **Satu baris untuk SETIAP ID keputusan** di `LMH-AGENT-SPEC.md` Bagian 3 (total 122 ID), diverifikasi terhadap kode & basis data nyata.
> Dibuat untuk memenuhi **Bagian 8.2**. Dasar bukti: `docs/analysis/00-CODE-INVENTORY.md` dan `docs/analysis/schema-live-snapshot.json` (read-only, 29 Jul 2026).
>
> **Kode status:** `SUDAH` · `SEBAGIAN` · `BELUM` · `BERTENTANGAN` · `TUNDA`.
> **Ukuran celah:** `XS` `S` `M` `L` `XL`. **Live?** = menyentuh data live.
> Bukti `skema-live`/`data-live` merujuk ke snapshot DB; selebihnya `path:baris` atau nama migrasi.

---

## 3.1 SVC — Struktur Layanan

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| SVC-01 | 11 layanan seragam (semua punya loket+antrean+chat), BPN coming soon | Live hanya 10 layanan; BPN tidak ada; Matchmaking & Investment Gallery masih `tipe=modul_publik` (dianggap tanpa antrean) | data-live; `me/reservasi/page.tsx:89` | BERTENTANGAN | L | Warga tidak bisa antre/chat di 2 layanan internal; daftar layanan tidak sesuai kenyataan kantor | Ya | SVC-02, SVC-03 |
| SVC-02 | Coming Soon = status tampilan (aktif\|coming_soon\|nonaktif) | Hanya ada `aktif` boolean; tidak ada status `coming_soon` | `202607140002:9`; skema-live | BELUM | S | BPN tidak bisa ditampilkan "segera hadir"; layanan baru langsung tampil penuh atau tidak sama sekali | Ya | — |
| SVC-03 | Ganti `layanan.tipe` → `penyerta` + bendera kemampuan | `tipe` masih dipakai, mencampur penyelenggara & kemampuan; UI reservasi memfilter `neq('tipe','modul_publik')` | `202607140002:8`; `me/reservasi/page.tsx:89` | BERTENTANGAN | M | Tidak bisa menyatakan "layanan DPMPTSP tanpa jadwal standby"; logika cabang per layanan rapuh | Ya | SVC-02 |
| SVC-04 | Satu layanan satu `nomor_loket` (tanpa tabel loket) | Kolom `nomor_loket` tidak ada | skema-live | BELUM | XS | Layar TV & panggilan suara tidak bisa menyebut loket | Ya | — |
| SVC-05 | Nomor antrean berprefiks per layanan, reset harian (WIB) | Kolom `prefiks_antrean` & kolom nomor antrean tidak ada; posisi antrean ad-hoc dari `waktu_masuk` | `202607140002:70-93`; `202607200001:174-204` | BELUM | L | Tidak ada nomor untuk dipanggil/ditampilkan; panggilan suara mustahil | Ya | SVC-04, QUE-06, RPT-07 |
| SVC-06 | Kontak resmi instansi mitra tersimpan | Tabel `layanan_kontak` tidak ada | skema-live | BELUM | S | Saat petugas alpa, warga tidak bisa diarahkan ke kantor asli (melanggar P3) | Ya | NOT-01 |

## 3.2 QUE — Kunjungan & Antrean

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| QUE-01 | Pisah `kunjungan` dari `tiket_antrean` | Satu tabel `visit` mencampur keduanya; tidak ada `kunjungan`/`tiket_antrean` | `202607140002:70-93`; skema-live | BERTENTANGAN | XL | Pengunjung multi-layanan dihitung ganda; angka "pengunjung vs layanan" tidak bisa dibedakan | Ya | OPS-01, OPS-02 |
| QUE-02 | Satu kunjungan boleh banyak tiket | Model saat ini 1 baris visit = 1 layanan; tidak bisa multi-tiket per kedatangan | `202607140002:70-93` | BELUM | L | Warga yang butuh 2 layanan harus mengisi data ulang; banyak yang memilih tidak ambil layanan ke-2 | Ya | QUE-01 |
| QUE-03 | Tiket tambahan tanpa isi ulang data (scan QR / FO) | Tidak ada mekanisme menambah tiket ke kunjungan aktif | — (tidak ditemukan) | BELUM | M | Hambatan isi ulang data membuat warga enggan ambil layanan lanjutan | Ya | QUE-01, QUE-02 |
| QUE-04 | Nomor terbit saat check-in di kantor, urut kedatangan | Alur status `terjadwal→menunggu` sudah cocok; nomor belum ada (lihat QUE-06) | `202607140002:82` | SEBAGIAN | M | Keadilan ruang tunggu tidak bisa ditegakkan tanpa nomor urut kedatangan | Ya | QUE-06 |
| QUE-05 | Reservasi maks H+7, tanpa slot jam | Horizon reservasi **30 hari** (`MAX_BOOKING_DAYS = 30`), bertentangan; memang tanpa slot jam | `me/reservasi/page.tsx:31,60` | BERTENTANGAN | S | Reservasi terlalu jauh ke depan meningkatkan no_show dan ketidakpastian jadwal | Ya | SCH-01 |
| QUE-06 | Penomoran antrean atomik di DB + UNIQUE(layanan,tanggal,nomor) | **Bukan race-condition** — fitur nomor belum ada sama sekali; tidak ada kolom nomor & constraint | `202607140002:70-93`; `202607200001:174-204` | BELUM | L | Begitu nomor dibuat tanpa pola atomik, dua check-in bersamaan akan dapat nomor sama → keributan | Ya | SVC-05 |
| QUE-07 | Tiket diklaim sekali (optimistic lock per baris) + `dilayani_oleh` | Status berubah tanpa kunci baris; kolom `dilayani_oleh` tidak ada di `visit` | `admin/antrian/page.tsx:126,150`; skema-live | BELUM | M | Dua petugas bisa melayani tiket sama; tanggung jawab layanan tidak tercatat | Ya | QUE-01 |
| QUE-08 | Status terpisah: `no_show`/`tidak_terlayani`/`batal` | Enum visit tidak punya `tidak_terlayani` (hanya 6 nilai) | `202607140002:82` | BELUM | M | Ketidakhadiran petugas tidak bisa dibedakan dari warga yang tidak datang → angka kepatuhan tidak bisa dipakai menuntut (P2) | Ya | OPS-08, SCH-10 |
| QUE-09 | Antrean sisa saat tutup TETAP dilayani | Tidak ada job yang menghanguskan tiket (bagus), tapi juga belum ada aturan eksplisit "layani sampai habis" | tidak ada cron akhir hari (`vercel.json`; `202607140005:108-136`) | SEBAGIAN | S | Jika nanti ditambah job akhir hari tanpa aturan ini, nomor yang dipegang warga bisa hangus → konflik | Ya | QUE-10, QUE-14 |
| QUE-10 | Batas ambil nomor per layanan (default 30 mnt) | Kolom `batas_ambil_nomor_menit` tidak ada; tidak ada batas pengambilan | skema-live | BELUM | M | Loket berdurasi panjang kelebihan beban menjelang tutup | Ya | QUE-11, SVC-03 |
| QUE-11 | Batas dihitung dari jam tutup EFEKTIF hari itu | Tidak ada konsep "jam tutup efektif per layanan per hari" (`layanan_hari` tidak ada) | skema-live | BELUM | L | Sistem tetap membagikan nomor untuk loket yang sudah kosong/ditutup lebih awal | Ya | QUE-10, SCH-09 |
| QUE-12 | Penolakan setelah batas wajib tawarkan jalan lain | Tidak ada alur penolakan dengan alternatif (reservasi besok + chat) | tidak ditemukan di `/checkin` / `/me/reservasi` | BELUM | M | Pesan "layanan tutup" tanpa lanjutan = cacat P3; warga pulang tanpa solusi | Ya | QUE-10, SCH-01 |
| QUE-13 | Tampilkan estimasi waktu dilayani saat memberi nomor | `mv_estimasi_layanan` + `v_antrian_loket` + `EstimasiAntrean.tsx` ada, tapi tidak ditampilkan "saat nomor diterbitkan" | `EstimasiAntrean.tsx:45`; `me/reservasi/page.tsx:112` | SEBAGIAN | S | Warga menunggu tanpa gambaran; potensi marah saat antrean panjang | Ya | QUE-06 |
| QUE-14 | Simpan jam selesai layanan yang SEBENARNYA per layanan/hari | Tidak ada kolom/tabel pencatat jam selesai aktual per loket | skema-live | BELUM | M | Tidak ada bukti berbasis angka bahwa kapasitas loket kurang | Ya | QUE-09 |
| QUE-15 | Reservasi tanpa check-in → `no_show` otomatis | Tidak ada pg_cron untuk ini; status `terjadwal` menumpuk (data-live: 2 `terjadwal` menggantung) | `vercel.json`; `202607140005:108-136`; data-live | BELUM | M | Status `terjadwal` menumpuk selamanya; rekap tidak pernah benar | Ya | RPT-07 |
| QUE-16 | Kuota harian DITUNDA, siapkan kolom `kuota_harian` nullable | Kolom tidak ada; sesuai keputusan, logika tidak dibangun | skema-live | TUNDA | XS | — (sengaja ditunda; hanya siapkan kolom) | Ya | — |
| QUE-17 | Tombol "panggil ulang" | Tidak ada mekanisme panggil ulang di dashboard antrean | `admin/antrian/page.tsx` (tidak ada) | BELUM | S | Warga yang tidak mendengar panggilan terlewati → keributan di ruang tunggu | Ya | QUE-06 |
| QUE-18 | Prioritas kelompok rentan: MANUAL FO, tanpa fitur (usulan penanda belum disetujui) | Tidak ada fitur prioritas — sesuai keputusan; usulan penanda dicatat sebagai OPEN-QUESTION | — | TUNDA | XS | Waktu tunggu anomali tidak bisa dijelaskan; tidak ada bukti pelayanan kelompok rentan untuk penilaian ZI | Tidak | — |

## 3.3 SCH — Jadwal Standby & Absensi

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| SCH-01 | Jadwal standby memblokir PENDAFTARAN | Trigger `guard_visit_layanan_buka` memblokir di server + validasi klien ada, TAPI data jadwal P4 belum diisi (semua layanan Senin–Jumat) | `202607280001:99-131`; `me/reservasi/page.tsx:157-159`; data-live | SEBAGIAN | M | Begitu jadwal P4 nyata diisi, pemblokir belum tentu benar karena model 1-baris-per-layanan tidak menangkap pola | Ya | SCH-04 |
| SCH-02 | Absensi = TOMBOL PEMBUKA antrean hari ini | Tidak ada gerbang absensi; antrean dibuka tanpa cek kehadiran | tidak ditemukan; `absensi_petugas` 0 baris (data-live) | BELUM | L | Antrean dibuka untuk loket yang tidak ada orangnya (melanggar P1) | Ya | SCH-08, SCH-10 |
| SCH-03 | Jadwal itu stabil (fakta, bukan fitur) | Fakta yang dikonfirmasi pemilik — menjadi dasar SCH-01; bukan item kerja | spec SCH-03 | SUDAH | — | — | Tidak | — |
| SCH-04 | Jadwal = pola berulang + tabel pengecualian | Ada `layanan_jadwal` (1 baris/layanan, `hari_kerja[]`) + `layanan_libur` (pengecualian), mendekati tapi bukan pola mingguan multi-baris + pengecualian kaya | `202607280001:11-34`; skema-live | SEBAGIAN | M | Perubahan 1–2×/bulan sulit dicatat tanpa merusak pola induk | Ya | SCH-01 |
| SCH-05 | Pembekuan jadwal harian (`jadwal_harian_beku`, tak boleh diubah surut) | Tabel & job pembekuan tidak ada | skema-live; `vercel.json` | BELUM | M | Laporan kepatuhan bisa dianulir dengan mengedit jadwal secara surut (P2) | Ya | SCH-04, RPT-07 |
| SCH-06 | Tombol cepat FO tutup/buka layanan hari ini + alasan | Tidak ada fitur tutup/buka harian; `layanan_libur` hanya bisa diisi admin lewat DB | tidak ditemukan | BELUM | M | Perubahan mendadak (1–2×/bulan) harus menunggu Admin; warga tetap datang ke loket tutup | Ya | RBA-02 |
| SCH-07 | Jadwal dikelola FO & Admin, wajib berjejak | `layanan_jadwal.updated_by` ada tapi tidak ada audit trail perubahan nilai | `202607280001:16`; tidak ada trigger audit khusus jadwal | SEBAGIAN | S | Tidak bisa menelusuri siapa mengubah jadwal dari nilai apa ke nilai apa | Ya | SCH-06 |
| SCH-08 | FO klik hadir; petugas boleh mengajukan; jam dari SERVER, tak bisa mundur | Tabel absensi ada; **jam_masuk diisi dari klien** `new Date().toISOString()`; kolom `sumber/dicatat_oleh` tidak ada | `admin/absensi/page.tsx:121-122`; skema-live | BERTENTANGAN | M | Risiko "absen titipan" — petugas menelepon minta diabsenkan padahal belum datang (P2) | Ya | RBA-02, SCH-02 |
| SCH-09 | Absen keluar otomatis + tombol "petugas sudah pulang" | `jam_pulang` diisi manual klien; tidak ada otomatis akhir jam; tidak ada tombol FO | `admin/absensi/page.tsx:142`; tidak ada job | SEBAGIAN | M | Petugas pulang jam 11 terhitung standby penuh; loket tidak ditutup saat petugas pulang lebih awal | Ya | SCH-02, QUE-11 |
| SCH-10 | Alpa otomatis + email dini ke warga | Status `alpa` tidak ada; tidak ada job/email alpa | `202607200001:75`; `vercel.json` | BELUM | L | Ketidakhadiran tidak terekam sebagai data (melanggar P1); warga berangkat sia-sia | Ya | SCH-02, NOT-04, QUE-08, RPT-07 |
| SCH-11 | Reservasi di luar hari jadwal diblokir dengan penjelasan + jadwal terdekat | Pemblokiran ada, tapi pesan tidak menyebut jadwal terdekat + alternatif (P3) | `me/reservasi/page.tsx:147-159` | SEBAGIAN | S | Warga ditolak tanpa tahu kapan layanan tersedia atau ke mana bertanya | Ya | SCH-01, P3 |

## 3.4 NOT — Notifikasi Petugas & Laporan Kepatuhan

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| NOT-01 | Tabel `layanan_kontak` (email + peran pic\|atasan\|cc + aktif) | Tabel tidak ada; email notifikasi tidak tersimpan per layanan | skema-live | BELUM | M | Eskalasi berjenjang mustahil; notifikasi bergantung pada akun PIC yang bisa berubah | Ya | SVC-06 |
| NOT-02 | Email pengingat hanya jika jadwal ADA ∧ belum absen ∧ sudah ada antrean/reservasi | Tidak ada job pengingat petugas sama sekali | `vercel.json`; tidak ada fungsi terkait | BELUM | M | Petugas tidak diingatkan; kehadiran tidak membaik (P1) | Ya | SCH-10, NOT-01 |
| NOT-03 | Notifikasi juga untuk layanan internal DPMPTSP (Matchmaking, Investment Gallery) | Tidak ada notifikasi ke pegawai internal | tidak ditemukan | BELUM | S | Pegawai internal yang kurang aware tidak tergerak | Ya | NOT-01, NOT-04 |
| NOT-04 | Jadwal kirim & eskalasi berjenjang (H-1→PIC; pagi→PIC; lewat batas→atasan+FO) | Tidak ada eskalasi berjenjang; hanya notifikasi transaksional (visit selesai, dll) | `202607140004:502-594`; tidak ada job eskalasi | BELUM | L | Mengingatkan orang yang sama berulang kali tidak menghasilkan; atasan tidak pernah tahu (P1) | Ya | NOT-01, SCH-10 |
| NOT-05 | Ringkasan harian 1 email/layanan (idempotency_key) | Tabel `notifikasi` + `idempotency_key` sudah ada, tapi belum dipakai untuk ringkasan harian petugas | `202607140003:218-220` | SEBAGIAN | S | Fondasi ada; tinggal bangun pengirim ringkasan | Ya | NOT-04 |
| NOT-06 | 2 varian laporan kepatuhan (internal vs mitra P4) | Tidak ada laporan kepatuhan sama sekali | tidak ditemukan | BELUM | M | Laporan antar-instansi dan laporan disiplin internal tercampur/tidak ada | Ya | NOT-07, RPT-01 |
| NOT-07 | Isi laporan: % hadir, hari alpa, warga terdampak, rata-rata telat; sebut nama layanan | Tidak ada perhitungan metrik kepatuhan | tidak ditemukan | BELUM | M | "Warga terdampak" — senjata paling menekan — tidak tersedia untuk pimpinan (P2) | Ya | SCH-10, RPT-05 |

## 3.5 CHT — Live Chat

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| CHT-01 | Chat = utas persisten + realtime; status `selesai` jadi utas berkelanjutan | `chat_sesi.status` punya `selesai` yang menutup sesi final; tidak ada model utas berkelanjutan per warga-layanan | `202607140003:24` | BERTENTANGAN | L | Warga tidak bisa "tinggal & lanjut" seperti WhatsApp; percakapan terputus | Ya | CHT-02 |
| CHT-02 | Riwayat dibuka di `/me`; petugas lihat riwayat warga yang sama | `/me` ada tapi belum menampilkan riwayat chat lengkap; petugas tidak melihat konteks percakapan sebelumnya | `src/app/me/page.tsx` (tidak ada blok riwayat chat) | SEBAGIAN | M | Petugas menanyakan hal yang sudah dijawab; warga mengulang cerita | Ya | CHT-01 |
| CHT-03 | Bot menjawab lebih dulu | Bot Gemini menjawab via `/api/chat/ai` sebelum petugas | `src/app/api/chat/ai/route.ts` | SEBAGIAN | S | — (fondasi ada; perlu pematangan handover) | Ya | BOT-* |
| CHT-04 | Bot jadi juru bicara jadwal (kapan standby, buka hari ini, jadwal terdekat, cara reservasi) | Bot hanya menjawab dari FAQ; tidak terhubung ke fungsi jadwal `is_layanan_buka` | `src/lib/gemini.ts:7-15`; `202607280001:38-64` | BELUM | M | Pertanyaan paling sering (jadwal) tidak terjawab otomatis; beban FO tidak berkurang | Ya | SCH-01, BOT-05 |
| CHT-05 | Serah terima bot↔petugas dua arah + label jelas | Status `bot`/`eskalasi`/ditangani_oleh ada; label penulis ada, tapi alur aktivasi ulang bot setelah petugas tutup belum jelas | `202607140003:24,28`; `admin/chat/page.tsx` | SEBAGIAN | M | Warga bingung sedang bicara dengan bot atau manusia | Ya | CHT-03 |
| CHT-06 | Chat tetap jalan meski loket fisik tutup | Chat tidak bergantung pada status loket; bot tetap aktif | `src/app/chat/page.tsx` | SEBAGIAN | XS | — (hampir sesuai; perlu pastikan bot menyebut jadwal saat tutup → CHT-04) | Tidak | CHT-04 |
| CHT-07 | Dashboard urut LAMA MENUNGGU + penanda warna | `/admin/chat` tidak mengurutkan berdasarkan lama menunggu balasan | `src/app/admin/chat/page.tsx` (urut waktu pesan) | BELUM | S | Warga yang menunggu 3 jam tenggelam di bawah pesan baru | Ya | CHT-01 |
| CHT-08 | FO pandangan lintas-layanan untuk takeover | Tidak ada role `front_office`; petugas dibatasi `get_my_layanan_id()` | `202607140004:14-22`; `202607140002:19` | BELUM | M | FO tidak bisa menjadi jaring pengaman saat petugas layanan tidak merespons (P1) | Ya | RBA-02 |
| CHT-09 | Notifikasi hanya saat warga tidak sedang aktif di halaman | Tidak ada deteksi "sedang membuka halaman chat" untuk menekan notifikasi | tidak ditemukan | BELUM | M | Notifikasi untuk pesan yang sudah dibaca membuat warga mematikan notifikasi → mekanisme "tinggal & lanjut" rusak | Ya | CHT-01 |
| CHT-10 | Chat wajib login Google | Sudah diterapkan — tombol "Masuk dengan Google" sebelum bertanya | `src/app/chat/page.tsx:712-738` | SUDAH | — | — | Tidak | — |
| CHT-11 | 3 akibat wajib login: FAQ publik tanpa login; preferensi kontak; magic-link cadangan | FAQ publik terpisah tidak ada; preferensi kontak (email/WA lain) belum ada; magic-link ada untuk UMKM tapi belum untuk chat | `src/app/api/umkm/request-edit-link/route.ts` (magic link UMKM); tidak ada preferensi kontak | BELUM | M | Login jadi hambatan; email Google tak dipantau; Google = titik gagal tunggal | Ya | CHT-10 |

## 3.6 BOT — Chatbot Bersumber Dokumen

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| BOT-01 | Tiap layanan 2–3 dokumen peraturan resmi | Tidak ada tabel `dokumen_peraturan` | skema-live | BELUM | L | Bot tidak punya sumber resmi untuk diutip | Ya | BOT-09 |
| BOT-02 | Olah dokumen SEKALI saat unggah (bukan per pertanyaan) | Tidak ada pipeline unggah+embed dokumen; hanya FAQ yang di-embed per baris | `src/app/api/admin/faq/embed/route.ts` | BELUM | L | Mengirim dokumen utuh per pertanyaan = biaya membengkak | Ya | BOT-01, BOT-03 |
| BOT-03 | Potong per pasal/ayat (bukan per karakter) | Tidak ada pemotongan dokumen sama sekali | tidak ditemukan | BELUM | M | Memotong per karakter membelah pasal → bot mengutip separuh syarat (lebih berbahaya dari tidak menjawab) | Ya | BOT-02 |
| BOT-04 | Metadata kutipan per potongan (nomor,tahun,judul,pasal,ayat,halaman) | Tidak ada tabel `dokumen_potongan` / metadata kutipan | skema-live | BELUM | M | Bot tidak bisa menjawab dengan rujukan tepat ("Permen X Pasal 12 ayat 2") | Ya | BOT-03 |
| BOT-05 | 3 aturan main: hanya dari dokumen; mengutip bukan menafsirkan; tidak kutip yang dicabut | System prompt sudah "Zero-Hallucination" + kutip [1][2], tapi belum ada mekanisme status `berlaku/dicabut` (belum ada dokumen) | `src/lib/gemini.ts:7-15` | SEBAGIAN | M | Mengutip aturan yang sudah dicabut — bot paling meyakinkan justru saat paling salah | Ya | BOT-01, BOT-04, CMS-04 |
| BOT-06 | Penanda jenis jawaban ("Informasi resmi" vs "Informasi umum") | Tidak ada kolom/penanda jenis jawaban di skema | skema-live (`chat_pesan`,`chat_ai_log`) | BELUM | S | Kejujuran sumber (pelindung hukum) tidak tampil ke warga | Ya | BOT-05 |
| BOT-07 | 3 bentuk masukan: tempel teks (utama); PDF+pratinjau; tautan JDIH hanya rujukan | Tidak ada jalur masukan dokumen sama sekali | tidak ditemukan | BELUM | M | Tidak ada cara mengisi pengetahuan bot dari dokumen resmi | Ya | BOT-09 |
| BOT-08 | TIDAK perlu OCR | Tidak ada OCR — sesuai keputusan (jangan dibangun) | — | SUDAH | — | — | Tidak | — |
| BOT-09 | Petugas unggah dokumen langsung aktif + 6 pengaman | Tidak ada fitur unggah dokumen oleh petugas | tidak ditemukan | BELUM | L | Pengetahuan bot tidak pernah terisi oleh pemiliknya | Ya | BOT-01, RBA-02 |
| BOT-10 | FAQ petugas langsung aktif + 4 pengaman (penulis+tanggal, daftar terbaru, riwayat versi, re-embed) | FAQ petugas langsung aktif ada (RLS `faq_petugas_all`), tapi 4 pengaman belum lengkap: tidak ada nama penulis/riwayat versi/daftar terbaru | `202607280003:5-7`; `admin/chat/faq/page.tsx` | SEBAGIAN | M | FAQ salah tayang tanpa jejak; tidak bisa dikembalikan | Ya | BOT-11 |
| BOT-11 | Embedding FAQ diperbarui saat FAQ diubah | **BUG AKTIF:** embed hanya proses `embedding IS NULL`; edit FAQ tidak me-null-kan embedding; kolom `embedding_updated_at` tidak ada | `embed/route.ts:63`; `faq/page.tsx:219`; skema-live | BERTENTANGAN | M | Bot menjawab dari versi FAQ yang sudah diperbaiki — gagal senyap tanpa error | Ya | BOT-10 |
| BOT-12 | Pertanyaan tanpa jawaban → usulan FAQ | `chat_ai_log` ada (punya `eskalasi`,`reason`), tapi belum ada fitur daftar usulan FAQ | `202607140003:43-53` | SEBAGIAN | S | Bot tidak makin pintar; petugas tidak punya alasan konkret mengisi FAQ | Tidak | CHT-03 |
| BOT-13 | Kualitas RAG terukur (golden dataset + umpan balik) | Tidak ada golden dataset / tombol umpan balik; ambang `match_faq` 0.7 belum diuji | `202607140004:200-223` | BELUM | M | Mutu bot tidak terukur; ambang bisa terlalu longgar/ketat tanpa diketahui | Tidak | BOT-05 |
| BOT-14 | Model AI tertinggal versi | Chat `gemini-flash-latest`, embedding `text-embedding-004`; **`.env.local:13` menyetel embedding 3072-dim ke kolom 768-dim (mismatch aktif)** | `src/lib/gemini.ts:24,52`; `.env.local:13`; skema-live | BERTENTANGAN | M | Embed baru gagal validasi dimensi → pipeline embed rusak saat dijalankan | Ya | BOT-11 |

## 3.7 CMP — Kanal Pengaduan (kewajiban hukum UU 25/2009)

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| CMP-01 | Kanal pengaduan bernomor tiket + batas waktu | Tidak ada tabel `pengaduan`; tidak ada route pengaduan | skema-live; tidak ada route | BELUM | L | **Kewajiban hukum UU 25/2009 tidak terpenuhi — hal pertama yang dicari penilai eksternal (Ombudsman, ZI/WBK)** | Ya | CMP-05, CMP-06 |
| CMP-02 | FO menerima & meneruskan pengaduan | Tidak ada role FO; tidak ada alur penerusan | `202607140002:19` | BELUM | M | Pengaduan tentang petugas alpa akan masuk ke petugas yang alpa itu sendiri (P1) | Ya | RBA-02, CMP-01 |
| CMP-03 | Batas waktu dihitung sistem (verifikasi 3 hari kerja, penanganan 14 hari kerja) | Tidak ada penghitung SLA; tidak ada tabel hari libur | tidak ditemukan | BELUM | M | Batas waktu yang hanya tertulis tidak pernah ditepati | Ya | CMP-01 |
| CMP-04 | Eskalasi otomatis saat batas terlampaui | Tidak ada mekanisme eskalasi | tidak ditemukan | BELUM | M | Pengaduan menggantung tanpa ada yang menagih | Ya | CMP-03 |
| CMP-05 | Lacak tanpa login (tiket acak + kontak + rate limit) | Tidak ada fitur pelacakan | tidak ditemukan | BELUM | M | Orang yang paling perlu mengadu justru dipaksa membuat akun | Ya | CMP-01 |
| CMP-06 | DUA jalur terpisah: layanan vs integritas (integritas HANYA Admin) | Tidak ada pemisahan jalur | tidak ditemukan | BELUM | L | Pengaduan pungli terbaca oleh yang diadukan → tidak ada yang berani mengadu lagi | Ya | CMP-01, SEC-04 |
| CMP-07 | Lampiran bukti di bucket PRIVAT | Bucket `pengaduan-bukti` tidak ada | `202607140004:753-755` (hanya 2 bucket) | BELUM | S | Bukti pengaduan bocor jika disimpan di bucket publik | Ya | CMP-01 |
| CMP-08 | Tombol "jadikan pengaduan" dari dalam chat | Tidak ada fitur konversi chat → pengaduan | tidak ditemukan | BELUM | S | Keluhan nyata yang masuk lewat chat hilang begitu saja | Ya | CMP-01, CHT-01 |
| CMP-09 | Standar Pelayanan & Maklumat Pelayanan ditayangkan | Tidak ada halaman/tabel `standar_pelayanan` | skema-live; tidak ada route | BELUM | M | **Kewajiban hukum UU 25/2009 kedua yang belum ada**; sekaligus bahan pengetahuan bot hilang | Ya | CMS-01 |

## 3.8 GST — Buku Tamu

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| GST-01 | Buku tamu terpisah TOTAL dari antrean | `visit.tujuan='bertemu_seseorang'` masih bercampur di tabel antrean (nama_yang_ditemui, keperluan di `visit`); tabel `buku_tamu` tidak ada | `202607140002:81,84-85`; skema-live | BERTENTANGAN | M | Tamu buku tamu ikut terhitung sebagai kunjungan layanan → angka rekap salah | Ya | QUE-01, OPS-02 |
| GST-02 | Field buku tamu (nama, asal, no HP, menemui siapa, keperluan, waktu, tanda tangan) | Sebagian field ada di `visit` (nama_yang_ditemui, keperluan); tanda tangan & no HP khusus buku tamu belum ada | `202607140002:84-85` | SEBAGIAN | S | — | Ya | GST-01 |
| GST-03 | Tanda tangan = SVG path (BUKAN PNG), privat | Tidak ada kolom/fitur tanda tangan | tidak ditemukan | BELUM | S | PNG 50–200KB × 20rb tamu = 1–4GB; SVG path 40–50× lebih efisien | Ya | GST-01 |
| GST-04 | Buku tamu = fitur FO (tablet-friendly) | Tidak ada UI buku tamu untuk FO | tidak ditemukan | BELUM | S | FO mencatat tamu di kertas; data tidak terkumpul | Ya | GST-01, RBA-02 |

## 3.9 MMK — Matchmaking UMKM

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| MMK-01 | Pengusul: pengunjung login DAN petugas, keduanya lewat review | Listing bisa dibuat petugas (`dibuat_oleh`) & ada review admin, tapi jalur pengunjung-login mengusulkan belum jelas | `202607140003:73`; `admin/umkm/page.tsx` | SEBAGIAN | M | UMKM yang ditemui petugas di lapangan tidak masuk sistem | Ya | MMK-02 |
| MMK-02 | Verifikasi 3 lapis (kelengkapan, legalitas NIB/NPWP, kontak aktif) | Review hanya terima/tolak; tidak ada checklist 3 lapis | `admin/umkm/page.tsx` | BELUM | M | Listing tidak terverifikasi merusak kepercayaan seluruh fitur | Ya | MMK-04, MMK-05 |
| MMK-03 | Tambah status `perlu_perbaikan` + catatan alasan | Enum status tidak punya `perlu_perbaikan`; tidak ada kolom `catatan_review` | `202607140003:70`; skema-live | BELUM | S | UMKM yang hanya kurang lengkap ditolak → menyerah | Ya | OPS-08 |
| MMK-04 | Field legalitas (NIB,NPWP,badan usaha) di bucket PRIVAT; jangan tampilkan NIB/NPWP ke publik | Kolom legalitas & bucket `umkm-legalitas` tidak ada | skema-live; `202607140004:753-755` | BELUM | M | Menaruh berkas legalitas di `umkm-photos` (publik) = kebocoran data | Ya | MMK-02 |
| MMK-05 | Simpan JEJAK verifikasi (siapa, apa, kapan, cara) | Tabel `umkm_verifikasi_jejak` tidak ada | skema-live | BELUM | S | Saat ada masalah UMKM, tidak bisa menjawab "siapa yang memverifikasi?" | Ya | MMK-02 |
| MMK-06 | Verifikasi kontak: email otomatis (magic-link), telepon manual tercatat; jangan tayangkan yang belum terverifikasi | Magic-link edit sudah ada, tapi tidak ada penanda "kontak terverifikasi" yang menghalangi tayang | `src/app/api/umkm/request-edit-link/route.ts` | SEBAGIAN | M | Listing dengan nomor mati merusak kepercayaan | Ya | MMK-02 |
| MMK-07 | Masa berlaku 6 bulan + pengingat 2 minggu (expired belum pernah terjadi) | Status `expired` ada di enum TAPI tidak ada kolom `berlaku_sampai` & tidak ada cron yang mengubahnya | `202607140003:70`; skema-live; `vercel.json` | BERTENTANGAN | S | Listing hidup selamanya; direktori penuh data mati | Ya | RPT-07 |
| MMK-08 | Perubahan field kritikal pasca-tayang wajib review ulang (pakai `snapshot_approved`) | `snapshot_approved` ada TAPI belum dipakai untuk deteksi perubahan field kritikal | `202607140003:71`; `umkm/edit/[id]/page.tsx` | SEBAGIAN | M | Listing bisa lolos review sebagai "katering" lalu diubah jadi hal lain setelah tayang | Ya | MMK-03 |
| MMK-09 | Klausul penafian publik wajib ada | Tidak ada teks penafian di halaman `/umkm` | `src/app/umkm/page.tsx` (tidak ada) | BELUM | XS | Saat ada sengketa transaksi, pihak yang dirugikan akan datang ke DPMPTSP | Ya | CMS-01 |

## 3.10 INV — Investment Gallery & Peta Potensi

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| INV-01 | Peta potensi cukup login (tidak perlu persetujuan) | Gallery investasi publik; lead butuh login; belum ada "peta potensi" terpisah sebagai fitur | `src/app/gallery/page.tsx:484-493` | SEBAGIAN | M | — | Ya | RBA-11 |
| INV-02 | Gerbang login = kontrol atribusi (catat siapa lihat potensi/dokumen apa → lead) | Tabel `jejak_minat_investasi` tidak ada; perilaku tidak dicatat | skema-live | BELUM | M | Calon investor berkualitas (yang menghabiskan waktu di peta) tidak terdeteksi | Ya | INV-01 |
| INV-03 | Gerbang profil RINGAN (nama, instansi, bidang minat) | `ProfileCompletenessGate.tsx` ada (~13.7KB) — perlu diverifikasi apakah sudah ringan atau kelebihan field | `src/components/ProfileCompletenessGate.tsx` | SEBAGIAN | XS | Setiap field tambahan mengurangi volume calon investor | Tidak | — |
| INV-04 | Dokumen IPRO watermark dibakar di server per permintaan (login→nama+email; anonim→waktu+sesi) | Watermark dibakar via sharp, TAPI isi = `DPMPTSP-LAMPUNG \| ipHash \| timestamp` (bukan nama+email untuk login) | `page-image/route.ts:185,190-193` | BERTENTANGAN | M | Watermark tidak bisa melacak kebocoran ke orang tertentu — hanya ke IP | Ya | SEC-05 |
| INV-05 | Catatan jujur batas watermark (bukan fitur) | Pedoman konseptual — bukan item kerja | spec INV-05 | SUDAH | — | — | Tidak | — |
| INV-06 | Pencatatan perilaku wajib diungkap (privacy + consent_log) | Halaman kebijakan privasi ada, tapi belum mengungkap pencatatan perilaku peta (fitur itu sendiri belum ada) | `src/app/kebijakan-privasi/page.tsx` | SEBAGIAN | S | Mencatat perilaku tanpa memberi tahu = pelanggaran; risiko berganda di situs pemerintah | Ya | INV-02 |

## 3.11 DSP — Layar Antrean TV

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| DSP-01 | Grid semua loket (nama, antrean dilayani, sisa antrean, running text) | `/layar-antrian` menampilkan kartu per layanan + sisa antrean, tapi belum ada "sedang dilayani" besar & running text | `src/app/layar-antrian/page.tsx` | SEBAGIAN | M | Nomor tidak terbaca dari jarak 5 m → fitur tidak berguna | Tidak | QUE-06 |
| DSP-02 | Penyambungan ulang + polling cadangan + penanda "diperbarui" | Ada realtime channel + pesan gagal, tapi tidak ada polling cadangan & penanda waktu yang selalu terlihat | `layar-antrian/page.tsx:37,92` | SEBAGIAN | M | Layar diam menampilkan data lama lebih berbahaya dari layar kosong | Tidak | — |
| DSP-03 | Tahan menyala berhari-hari (reload berkala, sembunyi kursor, fullscreen, cegah tidur) | Tidak ada mekanisme ketahanan jangka panjang | tidak ditemukan | BELUM | S | Layar macet/bocor memori setelah berminggu-minggu | Tidak | — |
| DSP-04 | Loket tutup ditampilkan JELAS + jadwal | Tidak ada tampilan "Tidak melayani hari ini" + jadwal | tidak ditemukan | BELUM | S | Warga menunggu tanpa harapan di loket tutup | Tidak | SCH-01 |
| DSP-05 | Running text dikelola dari dashboard Admin | Tidak ada running text & pengelolaannya | tidak ditemukan | BELUM | S | Pengumuman di layar harus mengubah kode | Tidak | CMS-01 |
| DSP-06 | JANGAN tampilkan nama warga, hanya nomor | `v_antrian_loket` TIDAK membawa kolom nama (hanya agregat) — aman secara struktur, tapi nomor antrean belum ada | `202607280005:7-41`; skema-live view | SEBAGIAN | S | Satu `SELECT *` yang tidak hati-hati = pengungkapan data pribadi di layar publik | Ya | QUE-06 |
| DSP-07 | URL layar bertoken tanpa login | `/layar-antrian` publik TANPA token; tabel `layar_token` tidak ada | `layar-antrian/page.tsx:1`; skema-live | BELUM | S | Siapa pun bisa membaca status antrean; tidak bisa dicabut per perangkat | Tidak | — |
| DSP-08 | Suara panggilan BELUM DIPUTUSKAN (TUNDA; rancang agar menerbitkan peristiwa "nomor dipanggil") | Tidak ada mekanisme pemanggilan yang menerbitkan peristiwa | tidak ditemukan | TUNDA | S | — (keputusan ditunda; rancang hook peristiwa) | Tidak | QUE-17 |

## 3.12 RPT — Rekap, Laporan & Data

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| RPT-01 | Satu lapisan metrik, 4 penyajian (PDF, Excel, dashboard, email) | Dashboard ada (recharts), tapi tidak ada lapisan metrik terpadu; tidak ada PDF/Excel/email | `src/app/admin/page.tsx` | BELUM | L | Angka berbeda antara dashboard & PDF → seluruh sistem kehilangan kredibilitas | Ya | RPT-05 |
| RPT-02 | 4 kelompok konsumen laporan (FO, pimpinan, penilai, layanan) | Hanya ada dashboard admin tunggal | `src/app/admin/page.tsx` | BELUM | M | Kebutuhan penilai eksternal (bukti resmi) tidak terlayani | Ya | RPT-01 |
| RPT-03 | Definisi metrik tunggal terdokumentasi | Tidak ada dokumen definisi metrik | tidak ditemukan | BELUM | S | Penilai bertanya "bagaimana angka dihitung" → jawaban "tergantung halaman" = kegagalan | Tidak | RPT-01 |
| RPT-04 | Snapshot PDF resmi (nomor, periode, waktu cetak, pencetak; isi dibekukan) | Tidak ada tabel `laporan_snapshot` / fitur cetak PDF | skema-live | BELUM | M | Laporan untuk penilai tidak bisa ditelusuri kembali; angka berubah saat dicetak ulang | Ya | RPT-01 |
| RPT-05 | Rollup agregat harian per layanan (`rekap_harian_layanan`) | Tidak ada tabel rollup; rekap dihitung dari data mentah | skema-live | BELUM | M | Rekap setahun di atas data mentah akan timeout dalam 2 tahun — tepat saat penilai menunggu | Ya | RPT-07 |
| RPT-06 | Ekspor ber-PII dibatasi + dicatat di `audit_log` | Tidak ada fitur ekspor; `audit_log` ada tapi tidak mencatat ekspor | `202607140003:148-157` | BELUM | M | Ekspor Excel ber-PII = cara termudah data bocor tanpa jejak | Ya | RPT-01 |
| RPT-07 | SEMUA batas hari pakai Asia/Jakarta | **BUG AKTIF:** "hari ini" dihitung UTC di ≥7 lokasi klien; view DB sudah WIB → inkonsisten | lihat 00-CODE-INVENTORY §A.7 (7 baris bukti) | BERTENTANGAN | M | "Hari" berakhir 07.00 WIB — angka salah setiap hari, membingungkan untuk didiagnosis | Ya | — |
| RPT-08 | Rekap kustom rentang tanggal | Filter tanggal ada di beberapa halaman, tapi tidak ada rekap rentang bebas terpadu | `admin/kunjungan/page.tsx:40` | SEBAGIAN | S | — | Ya | RPT-01 |

## 3.13 SRV — Survei & Ulasan

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| SRV-01 | Fitur survei DITUNDA | SKM sudah ada & berjalan; pengembangan lanjutan ditunda — sesuai | `202607140003:172-187` | TUNDA | — | — | Tidak | — |
| SRV-02 | JANGAN tambah survei berpola `u1..u9`; bangun mesin generik di samping SKM | Aturan larangan (pedoman), bukan item kerja; SKM masih pola u1..u9 | `202607140003:172-187` | SUDAH | — | — | Tidak | SRV-01 |
| SRV-03 | Catat response rate SKM sekarang (murah, data tak bisa dibuat surut) | Tidak ada pencatatan berapa yang dilayani vs berapa yang mengisi | tidak ditemukan | BELUM | XS | Penilai selalu menanyakan response rate; datanya tidak bisa dibuat surut → hilang selamanya | Ya | — |
| SRV-04 | Google Maps = tautan + input manual bulanan, JANGAN pakai API berbayar | Tidak ada tombol ulasan / input manual | tidak ditemukan | BELUM | XS | — (ditunda bersama SRV-01) | Tidak | SRV-01 |

## 3.14 RBA — Peran & Hak Akses

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| RBA-01 | 5 peran (Admin, FO, Petugas, Pengunjung login, Pengunjung anonim) | Hanya 2 role teknis (`admin`,`petugas`) + `pengunjung`; FO belum ada | `202607140002:19`; `202607140004:36` | SEBAGIAN | L | Wewenang lintas-layanan FO tidak bisa diwakili | Ya | RBA-02 |
| RBA-02 | `petugas.role` + nilai `front_office` | Enum CHECK hanya `petugas\|admin`; `front_office` tidak ada di DB & kode | `202607140002:19`; `src/lib/constants.ts:87-90`; `src/lib/admin-nav.ts:5` | BERTENTANGAN | M | FO tidak punya identitas peran → semua wewenang FO (absensi, takeover, buku tamu, pengaduan) terblokir | Ya | OPS-08 |
| RBA-03 | Satu petugas satu layanan (JANGAN banyak-ke-banyak) | `petugas.layanan_id` tunggal — sesuai | `202607140002:17` | SUDAH | — | — | Tidak | — |
| RBA-04 | Loket bebas tanpa penguncian sesi (cukup kunci baris tiket) | Tidak ada penguncian sesi (bagus), tapi kunci baris tiket juga belum ada (tiket belum ada) | lihat QUE-07 | SEBAGIAN | S | — | Ya | QUE-07 |
| RBA-05 | Pembuatan akun HANYA oleh Admin | Invite petugas dibatasi admin | `src/app/api/admin/petugas/invite/route.ts:53-55` | SUDAH | — | — | Tidak | — |
| RBA-06 | Kolom aktif/nonaktif pada `petugas` | Kolom `aktif`/`nonaktif_sejak` tidak ada; satu-satunya cara menghentikan akses = hapus baris (menghancurkan riwayat) | skema-live | BELUM | XS | Menghapus petugas = kehilangan jejak siapa melayani/membalas/menulis apa | Ya | RBA-08 |
| RBA-07 | Akun diwariskan saat PIC ganti — **KLARIFIKASI PENGGUNA: satu layanan satu akun; saat PIC ganti cukup reset password oleh Admin** | Belum ada tindakan resmi pergantian pemegang akun / reset password Admin di dashboard | tidak ditemukan | BELUM | M | Pemegang lama masih bisa login & membaca chat warga setelah diganti (risiko diterima, pengaman wajib) | Ya | RBA-06, NOT-01 |
| RBA-08 | FO boleh MENONAKTIFKAN akun (satu arah, wajib alasan, Admin diberi tahu) | Tidak ada fitur nonaktifkan; FO belum ada | tidak ditemukan | BELUM | M | Penyalahgunaan (nonaktif lalu aktif diam-diam) tidak bisa dicegah | Ya | RBA-02, RBA-06 |
| RBA-09 | TIDAK ada peran pimpinan khusus (pimpinan pakai akun Admin tersendiri) | Data-live: 2 admin (Dea, Linda) — belum jelas apakah satu akun khusus pimpinan; tidak ada pemisahan | data-live (`petugas` 2 baris admin) | SEBAGIAN | XS | Berbagi akun Admin = seluruh audit log kehilangan nilai | Tidak | — |
| RBA-10 | Petugas hanya lihat rekap layanannya; FO perlu lintas-layanan | Petugas dibatasi `get_my_layanan_id()` (baik); FO lintas-layanan belum ada (FO belum ada) | `202607140004:14-22` | SEBAGIAN | M | FO tidak bisa memantau operasional lintas layanan | Ya | RBA-02 |
| RBA-11 | Anonim TIDAK boleh lihat peta potensi | Gallery & UMKM publik bisa diakses anonim; "peta potensi" sebagai fitur terpisah belum ada sehingga belum bisa diverifikasi | `src/app/gallery/page.tsx` | SEBAGIAN | S | Data potensi investasi terbuka ke yang tidak seharusnya | Ya | INV-01 |

## 3.15 CMS — Pengelolaan Konten & Pengaturan

| ID | Keputusan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| CMS-01 | Admin boleh ubah banyak pengaturan dari dashboard | `site_settings` + `landing_content` + halaman settings ada; cakupan masih terbatas | `202607140002:39-55`; `admin/settings` | SEBAGIAN | L | Pengaturan penting masih butuh ubah kode | Ya | CMS-05 |
| CMS-02 | Publikasi LANGSUNG TAYANG | Perubahan konten langsung tayang (tidak ada alur persetujuan) — sesuai | `admin/settings/landing` | SEBAGIAN | S | — (syarat: butuh CMS-03 sebagai jaring pengaman) | Ya | CMS-03 |
| CMS-03 | Riwayat versi + tombol kembalikan (syarat CMS-02) | Tabel `konten_versi` tidak ada; tidak ada tombol kembalikan | skema-live | BELUM | M | Salah tempel teks di halaman utama tidak bisa dipulihkan satu klik | Ya | CMS-02 |
| CMS-04 | 4 kelompok TIDAK boleh diubah dari dashboard (penjaga bot, rate limit, retensi PDP, definisi peran) | Tidak ada penanda `boleh_diubah_dashboard`; belum ada mekanisme yang menegakkan larangan | skema-live (`site_settings`) | BELUM | M | Suatu hari ada yang mematikan penjaga bot "biar lebih pintar" → bot mengarang syarat | Ya | CMS-05, BOT-05 |
| CMS-05 | Registry pengaturan bertipe (tipe_nilai, boleh_diubah_dashboard, aturan_validasi) di atas `site_settings` | `site_settings` hanya `key`+`value` teks; belum bertipe | `202607140002:39-43`; skema-live | SEBAGIAN | M | CMS-04 tidak bisa ditegakkan secara struktural | Ya | CMS-04 |

## 3.16 SEC — Temuan Keamanan & Kualitas (audit teknis)

| ID | Temuan | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | CSP masih `Report-Only` | Terkonfirmasi — header `Content-Security-Policy-Report-Only` | `next.config.ts:54` | BERTENTANGAN | S | Kebijakan keamanan hanya melapor, tidak memblokir apa pun | Tidak | — |
| SEC-02 | `check_anon_rate()` bisa dilewati rotasi sesi anon | Chat sudah dimitigasi (CHT-10); walk-in/`umkm_inquiry`/`investasi_lead` masih terbuka | `202607140004:67-81` | SEBAGIAN | M | Rate limit anon tidak efektif untuk jalur non-chat | Ya | CHT-10 |
| SEC-03 | Tidak ada error tracking / alerting / SLO | `logServerEvent` hanya `console.*`; tidak ada Sentry/alerting | `src/lib/observability/logger.ts:63-65` | BELUM | M | Kegagalan hanya diketahui dari keluhan warga | Tidak | OPS-06 |
| SEC-04 | RLS hanya diuji static parsing, bukan perilaku per-peran | 62 file tes, tapi tidak ada tes RLS perilaku | lihat 00-CODE-INVENTORY §A.8 | BELUM | M | Kebijakan RLS belum tentu bekerja seperti yang diyakini | Ya | — |
| SEC-05 | Kebocoran dokumen investasi | Sudah ditutup sebagian (watermark server-side); tinggal identitas watermark | `page-image/route.ts:185-193` | SEBAGIAN | S | — (lihat INV-04) | Ya | INV-04 |
| SEC-06 | Halaman monolitik (`/chat` 37.5KB, `/umkm` 36KB) | Halaman besar memang ada | `src/app/chat/page.tsx`, `src/app/umkm/page.tsx` | SEBAGIAN | L | Sulit diuji & dipelihara | Tidak | OPS-07 |
| SEC-07 | Tidak ada lapisan data (TanStack Query/SWR) | Fetch langsung via supabase client di komponen | berbagai `page.tsx` | BELUM | M | Pola pengambilan data tidak konsisten | Tidak | — |
| SEC-08 | Pipeline re-embedding FAQ tidak terdefinisi | Lihat BOT-11 — bug aktif | `embed/route.ts:63` | BERTENTANGAN | M | Bot menjawab dari versi FAQ lama | Ya | BOT-11 |
| SEC-09 | RAG tanpa golden dataset & umpan balik | Lihat BOT-13 | `202607140004:200-223` | BELUM | M | Mutu bot tidak terukur | Tidak | BOT-13 |
| SEC-10 | Model AI tertinggal versi | Lihat BOT-14 — plus mismatch dimensi embedding | `src/lib/gemini.ts:52`; `.env.local:13` | BERTENTANGAN | M | Embed baru gagal validasi dimensi | Ya | BOT-14 |
| SEC-11 | Cron `*/2` latensi notifikasi 2 menit | Vercel cron notif/send memang `*/2` | `vercel.json:4-5` | SEBAGIAN | XS | Notifikasi bisa telat hingga 2 menit | Tidak | — |
| SEC-12 | Refresh MV tanpa `CONCURRENTLY` | **Sudah benar** — `refresh_estimasi_layanan()` memakai `CONCURRENTLY` | `202607140005:100` | SUDAH | — | — | Tidak | — |
| SEC-13 | Kanal WhatsApp belum ada (biaya) | Belum ada; ditunda | — | TUNDA | M | — | Tidak | — |
| SEC-14 | PDP ada tapi DSAR/DPIA/retensi belum lengkap; PII bisa masuk `audit_log.detail` | `KEBIJAKAN_PDP.md` ada; `audit_log.detail` jsonb bisa membawa PII | `202607140003:153`; `docs/KEBIJAKAN_PDP.md` | SEBAGIAN | M | PII bocor ke log audit | Ya | — |
| SEC-15 | Pelaporan SKM PermenPANRB belum lengkap | `hitung_ikm` ada; response rate belum (lihat SRV-03) | `202607140004:227-244` | SEBAGIAN | S | — | Ya | SRV-03 |
| SEC-16 | Belum ada E2E test | Belum ada; ditunda | — | TUNDA | L | — | Tidak | — |
| SEC-17 | `audit_log` tanpa hash-chain & partisi | Terkonfirmasi; ditunda | `202607140003:148-157` | TUNDA | M | — | Ya | — |
| SEC-18 | PRD sebaiknya dipecah | `docs/PRD.md` masih monolitik; ditunda | `docs/PRD.md` | TUNDA | XS | — | Tidak | — |

## 3.17 OPS — Protokol Perubahan Sistem Live

| ID | Protokol | Kondisi nyata | Bukti | Status | Ukuran | Risiko jika dibiarkan | Live? | Bergantung pada |
|---|---|---|---|---|---|---|---|---|
| OPS-01 | Migrasi aditif 4 langkah (TAMBAH→ISI→PINDAH→HENTIKAN) | Protokol belum terdokumentasi sebagai runbook; migrasi sejauh ini aditif tapi belum ada pola dual-write | `docs/MIGRATIONS.md` | SEBAGIAN | — | Perubahan destruktif pada sistem live | Ya | — |
| OPS-02 | Pemecahan `visit` paling berisiko (urutan wajib) | Belum dimulai; `visit` masih inti | `202607140002:70-93` | BELUM | — | Operasi jantung pada sistem berjalan | Ya | OPS-01 |
| OPS-03 | Jendela penerapan di luar jam layanan | Belum ada runbook jendela penerapan | tidak ditemukan | BELUM | — | Check-in gagal pukul 10.00 → FO mencatat di kertas | Ya | — |
| OPS-04 | Setiap WP punya rencana pengembalian teruji | Belum ada template rollback | tidak ditemukan | BELUM | — | Rollback gagal saat dibutuhkan | Ya | — |
| OPS-05 | Prosedur cadangan manual FO sejak awal | Belum ada prosedur cadangan manual terdokumentasi | tidak ditemukan di `docs/` | BELUM | — | Pelayanan publik berhenti karena satu penerapan gagal | Tidak | — |
| OPS-06 | Observability dipasang SEBELUM kerja besar | Observability belum ada (SEC-03) | `src/lib/observability/logger.ts` | BELUM | — | Mengerjakan pemecahan `visit` dengan mata tertutup | Tidak | SEC-03 |
| OPS-07 | Pemecahan halaman monolitik sambil jalan | Belum ada pedoman; halaman besar masih ada | lihat SEC-06 | SEBAGIAN | — | Refactor besar tanpa imbalan pada sistem live | Tidak | — |
| OPS-08 | Penambahan nilai enum → cari semua pemetaan ekshaustif di TS | Belum ada checklist/daftar lokasi pemetaan enum | tidak ditemukan | BELUM | — | Nilai baru jatuh ke cabang default → tampil kosong/salah label di laporan | Tidak | — |

---

## DAFTAR TEMUAN-BARU
> Masalah yang ditemukan di kode/data dan **tidak** tercakup dalam dokumen spec.

| ID | Temuan | Bukti | Dampak |
|---|---|---|---|
| TB-01 | **Mismatch dimensi embedding:** `.env.local:13` menyetel `GEMINI_EMBEDDING_MODEL=gemini-embedding-001` (3072-dim) sementara kolom `faq_knowledge_base.embedding = vector(768)`. Embed baru akan gagal validasi dimensi. | `.env.local:13`; `src/lib/gemini.ts:50-52`; skema-live | Pipeline embed FAQ rusak saat dijalankan; memperparah BOT-11/BOT-14 |
| TB-02 | **Inkonsistensi timezone klien vs DB:** view `v_antrian_loket` sudah `Asia/Jakarta`, tetapi ≥7 lokasi klien menghitung "hari ini" dengan UTC. Pada 00:00–07:00 WIB layar TV dan dashboard FO menampilkan hari berbeda. | 00-CODE-INVENTORY §A.7 | Angka harian tidak konsisten antar tampilan (bagian dari RPT-07 tapi pola inkonsistensinya temuan tersendiri) |
| TB-03 | **Rate limit `/api/investment-docs/page-image` in-memory** (`new Map()`) — tidak efektif di multi-instance serverless; reset tiap instance. | `page-image/route.ts:15-17` | Pembatas scraping dokumen tidak berfungsi pada deployment nyata |
| TB-04 | **Layar antrean publik tanpa token** — `/layar-antrian` bisa dibuka siapa pun tanpa autentikasi. | `layar-antrian/page.tsx:1` | Status antrean terbaca publik; tidak bisa dicabut per perangkat (bagian dari DSP-07) |
| TB-05 | **Error lint nyata:** `src/app/kebijakan-privasi/page.tsx` mengekspor `POLICY_VERSION` yang bukan entry export valid Next.js. | `src/app/kebijakan-privasi/page.tsx:6` | Build/lint berpotensi gagal (`--max-warnings=0`) |
| TB-06 | **Seed layanan tidak lengkap & nama tidak baku:** live hanya 10 layanan (BPN tidak ada), dan "BALMON" tidak sesuai nama resmi "Balai Monitor SFR" di spec. | data-live | Daftar layanan publik tidak sesuai kenyataan organisasi |
| TB-07 | **Tidak ada petugas layanan sama sekali di live** — hanya 2 admin tanpa `layanan_id`. Fitur absensi & antrean per-petugas belum pernah dipakai nyata. | data-live (`petugas` 2 baris; `absensi_petugas` 0 baris) | Alur petugas belum teruji oleh data nyata; risiko saat petugas mulai diisi |

## DAFTAR BERTENTANGAN
> Tempat di mana kode/data bertentangan dengan keputusan, beserta penilaian mana yang tampak lebih benar.

| ID | Pertentangan | Kode/Data | Keputusan spec | Penilaian |
|---|---|---|---|---|
| BT-01 | Horizon reservasi | `MAX_BOOKING_DAYS = 30` (`me/reservasi/page.tsx:31`) | H+7 (QUE-05) | **Spec lebih benar** — 30 hari meningkatkan no_show & ketidakpastian jadwal |
| BT-02 | Zona waktu "hari ini" | UTC di klien (7 lokasi) | Asia/Jakarta (RPT-07) | **Spec lebih benar** — UTC menggeser hari kerja |
| BT-03 | `layanan.tipe` | `konsultatif\|mitra\|modul_publik`, Matchmaking & Investment Gallery = `modul_publik` | SVC-01/SVC-03: semua layanan punya loket+antrean | **Spec lebih benar** — keduanya dilayani langsung di tempat |
| BT-04 | Jam absensi | Diisi dari klien `new Date().toISOString()` (`absensi/page.tsx:122`) | SCH-08: jam dari SERVER, tak bisa mundur | **Spec lebih benar** — mencegah absen titipan |
| BT-05 | Watermark IPRO | `ipHash+timestamp` (`page-image/route.ts:185`) | INV-04: login→nama+email | **Spec lebih benar** — watermark harus bisa menunjuk orang |
| BT-06 | Akun PIC | `AGENTS.md` + `KEBIJAKAN_AKUN_MITRA.md`: individual account | RBA-07: akun diwariskan | **Diselesaikan oleh pengguna:** satu layanan satu akun; saat PIC ganti cukup **reset password oleh Admin** (akun tidak ganti). Keduanya perlu diselaraskan — `AGENTS.md` perlu diperbarui agar tidak kontradiksi. |
| BT-07 | Sesi chat `selesai` | Menutup sesi final (`202607140003:24`) | CHT-01: utas berkelanjutan | **Spec lebih benar** — chat harus bisa "tinggal & lanjut" |
| BT-08 | `tujuan='bertemu_seseorang'` | Bercampur di `visit` | GST-01: buku tamu terpisah total | **Spec lebih benar** — tamu bukan kunjungan layanan |

## DAFTAR OPEN-QUESTIONS
> Hal yang tidak bisa diputuskan sendiri oleh agent. (OQ-01..07 dari spec + klarifikasi Bagian 11.2.)

| ID | Pertanyaan | Konteks |
|---|---|---|
| OQ-01 | Metode suara panggilan antrean? (rekomendasi: rekaman potongan audio) | DSP-08 — rancang hook peristiwa "nomor dipanggil" tanpa membangun suara |
| OQ-02 | Penanda alasan prioritas kelompok rentan (usulan 1 kolom) — disetujui atau tidak? | QUE-18 — pemilik memilih tanpa fitur; usulan belum dijawab |
| OQ-03 | Nilai pasti batas jam absensi sebelum dinyatakan alpa? | **DIJAWAB:** default **10:00 WIB**, dapat diatur Admin lewat `site_settings` (CMS-05, `boleh_diubah_dashboard=true`) |
| OQ-04 | Jam layanan resmi kantor (buka & tutup)? | **DIJAWAB:** **08:00–15:30**. Koreksi dari data live yang saat ini 08:00–16:00 — disesuaikan saat seed jadwal |
| OQ-05 | Daftar hari libur nasional (untuk hitungan hari kerja)? | **DIJAWAB:** tabel `hari_libur` + **input manual** oleh Admin |
| OQ-06 | Apakah `layanan.tipe` boleh dihentikan setelah SVC-03, dan kapan? | OPS-01 langkah 4 (masih menunggu keputusan saat langkah 4 tiba) |
| OQ-07 | Format nomor tiket pengaduan (harus tak bisa ditebak berurutan)? | **DIJAWAB:** `P` + kode acak (misal `P7K2N9X`). Awalnya diusulkan `P112001230` (berurutan), pemilik memilih acak setelah diingatkan risiko penebakan pada jalur integritas |
| OQ-08 | Keluhan lapangan yang paling sering muncul? | **DIJAWAB:** tidak ada keluhan harian berulang; masalah utama tetap petugas P4 tidak datang (tamu P4 sepi). → Urutan Bagian 9 dipertahankan, tidak ada yang naik ke Fase 0 |
| OQ-09 | Besar tim & anggaran? | **DIJAWAB:** A — tim kecil, anggaran minim. → SEC-03 pakai solusi gratis; SEC-13 WhatsApp tetap TUNDA; BOT-14 hanya dalam kuota gratis Gemini |
| OQ-10 | Target penilaian eksternal & tenggatnya? | **DIJAWAB:** tidak ada tenggat mendesak. Kanal pengaduan/survei/review DPMPTSP saat ini berjalan TERPISAH di luar LMH; LMH sistem baru yang ke depan menyatukan semuanya. → Fase 1 tidak dipercepat; catat kebutuhan migrasi dari kanal lama saat Fase 1 |
| OQ-11 | Pengguna dominan: pengunjung fisik atau digital? | **DIJAWAB:** Seimbang. → Urutan fase tidak berubah |

---

**BERHENTI DI SINI.** Menunggu persetujuan manusia sebelum melanjutkan ke **Fase C (Desain target)**.
