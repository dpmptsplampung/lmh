# Usulan Role LMH — Bagian 2 (revisi setelah keputusan CEO)

Lanjutan dari `docs/RBAC_USULAN_DRAFT.md` (selanjutnya "draf"). Isi draf yang tidak berubah **tidak diulang**.
Tidak ada kode atau database yang diubah. **[ASUMSI]** = belum dibuktikan, wajib dicek saat implementasi.
Ukuran kerja: **Kecil** ≈ ≤1 hari kerja, **Sedang** ≈ 2–4 hari, **Besar** ≈ 1–2 minggu (1 orang, termasuk tes).

---

## Ringkasan 1 menit untuk CEO

1. **Ada satu keputusan yang bertentangan (K1).** CEO memilih "akun pribadi per orang", tetapi juga menulis "helpdesk-oss bisa login ganda" (akun bersama). Desain di bawah **mendukung keduanya dengan teknologi yang sama**. CEO tinggal memilih per jenis akun (lihat F1).
2. **Login pakai nama pengguna (username) bisa dibuat** tanpa mengganti sistem login. Caranya: setiap username diam-diam dipasangkan ke "alamat email internal" yang tidak pernah dipakai untuk mengirim surat. Email asli disimpan terpisah sebagai **email notifikasi** dan bisa diubah sendiri oleh pemilik akun.
3. **Konsol Pengaturan untuk Admin bisa dibuat aman.** Admin bisa mengganti model AI, urutan cadangan, kunci API, atau memakai gateway, lalu **menekan tombol UJI sebelum mengaktifkan**. Kunci API disimpan terenkripsi dan tidak pernah tampil utuh lagi.
4. **Ditemukan 3 hal yang "terlihat jalan padahal tidak":**
   - tombol "matikan bot" hanya berlaku di layar pengunjung, server tetap menjawab;
   - "mode akhir pekan" bot tidak mengenal hari libur nasional;
   - pemberitahuan "akun dinonaktifkan" ke Admin tidak pernah terkirim.
5. **Urutan kerja tetap: keamanan dulu (Tahap 0), baru fitur baru.** Semua perubahan database produksi menunggu persetujuan CEO.

---

## A. Matriks revisi (hanya sel yang berubah dari draf)

Legenda sama dengan draf. **Baru** = kemampuan yang belum ada di draf.

| Kode | Kemampuan | Admin | FO | Petugas | Sebelumnya (draf) | Alasan perubahan |
|---|---|---|---|---|---|---|
| B1, B2, B4 | Jadwal mingguan, libur khusus, standby | Kelola | Lihat (semua layanan) | **Lihat-L** (tanpa "Ajukan") | Petugas: Lihat-L + Ajukan | K2: hanya Admin yang mengubah. Fitur "Ajukan perubahan" (draf §3 opsi B) **ditunda**. Permintaan disampaikan lewat WA/telepon. |
| B3 | Hari libur nasional | Kelola | Lihat | Lihat | sama | Tidak berubah, tetapi **halamannya wajib dibuat** (K2 meminta FO/petugas *melihat* libur). |
| B6 **Baru** | Pengumuman "besok/hari ini libur/tutup" di dasbor & sidebar | Lihat | Lihat | Lihat-L | — | K2. Tampil otomatis dari jadwal, libur nasional, libur khusus, dan tutup darurat. |
| B5 | Tutup/buka layanan hari ini | Kelola | **Darurat (alasan wajib, tanpa notifikasi ke Admin)** | — | Darurat + Admin diberi tahu | K4 [? tafsiran]. Jejak audit **tetap** dicatat dan terlihat di Riwayat Perubahan. |
| E4 | Minta draf balasan AI | Kelola | **Kelola** | Kelola-L | sama | Tetap, tetapi sekarang wajib diperbaiki karena server menolak FO (`chat/ai/draft/route.ts:42`). |
| F1 | Bot hidup/mati per layanan | Kelola | Lihat | Lihat-L | sama | K5 dikonfirmasi. **Temuan baru:** server bot tidak memeriksa `chatbot_aktif`. Status ini hanya dibaca layar pengunjung (`src/app/chat/page.tsx:411`, tidak ada pemakaian di `src/app/api/`). Harus ditegakkan di `api/chat/ai`. |
| F2 | Tambah/ubah FAQ layanannya | Kelola | Lihat | **Kelola-L, terbit langsung** | Lihat-L + Ajukan | K6. Teks peringatan wajib, lihat A.2. Server harus mengizinkan petugas membuat "indeks makna" FAQ layanannya. Saat ini ditolak (`admin/faq/embed/route.ts:43`), sehingga FAQ petugas tidak dikenali pencarian makna. |
| F3 | Hapus/nonaktifkan FAQ | Kelola | — | **Nonaktifkan-L** (bukan hapus permanen) | — | Konsekuensi K6. Petugas yang boleh menerbitkan juga harus bisa menarik jawabannya yang salah. Hapus permanen tetap hanya Admin. |
| F7 **Baru** | Ruang lingkup jawaban bot per layanan (K11) | Kelola | Lihat | Lihat-L | — | K11 (nanti). Dipasang di halaman Kelola Layanan, lihat B.3. |
| F8 **Baru** | Coba tanya bot (uji FAQ sebelum/sesudah terbit) | Kelola | Kelola | Kelola-L | — | Karena FAQ petugas terbit langsung (K6), petugas perlu sarana mencoba jawaban bot. Tidak disimpan ke log chat publik. |
| G1 | Dasbor hari ini | Kelola | **Lihat (versi FO)** | **Lihat-L (versi petugas)** | Petugas: — | K2 meminta info "besok libur" di dasbor. Dasbor petugas berisi: status absen, antrean layanannya, chat menunggu, jadwal 7 hari, libur. |
| G2, G3 | Rekap & ekspor | Kelola | Kelola | Lihat-L / Ekspor-L | sama | K8 dikonfirmasi. Saringan layanan harus dipaksa di **semua tab** (`export/route.ts:94-95`). |
| G4 | Hitung ulang rekap | Kelola | Kelola | — | sama | Tombol disembunyikan untuk petugas (sekarang tampil lalu ditolak). |
| H1, H2 | Pengaduan jalur layanan | Kelola | **Kelola (semua layanan)** | **—** | FO: — | K3. **[ASUMSI]** Petugas tidak melihat pengaduan sama sekali. Admin/FO meneruskan bila perlu. Kini petugas bisa melihat pengaduan layanannya, dan ini **dicabut**. Lihat F3. |
| H3 | Jalur integritas | Kelola | — | — | sama | Asumsi K3: tetap Admin saja. Tab disembunyikan untuk non-admin (`pengaduan/page.tsx:126`). |
| I1, I2 | SKM layanannya | Kelola | Lihat | Lihat-L | sama | K9 dikonfirmasi. FO tanpa layanan perlu akses baca semua respons (sekarang ditolak DB, M4). |
| K6 | Nonaktifkan akun | Kelola | **—** | — | sama | K7 dikonfirmasi. Izin FO di `petugas/status/route.ts:56` **dicabut**. |
| K8 | Profil diri | **Kelola diri** | **Kelola diri** | **Kelola diri** | Lihat saja | Arahan baru (1). Bisa mengubah: nama tampilan, no HP, email notifikasi (dengan verifikasi), kata sandi. Tidak bisa mengubah: username, role, layanan, status. |
| K9 **Baru** | Atur ulang kata sandi orang lain | Kelola | — | — | — | Pengganti "lupa kata sandi" karena email login bersifat internal (lihat C). |
| K10 **Baru** | Ubah username | Kelola | — | — | — | Username adalah identitas login. Perubahan oleh Admin, tercatat di audit. |
| K11 **Baru** | Daftar operator bertugas (hanya varian B, akun bersama) | Kelola | Lihat | Kelola-L (akun sendiri) | — | Agar tetap tercatat **siapa orangnya** di balik akun bersama (lihat C.9). |
| A8 | Konsol Pengaturan & AI (model, kunci API, gateway, uji) | **Kelola** | — | — | Opsional Tahap 5 | Arahan baru (2). Dinaikkan prioritasnya. Desain di D. |
| A9 **Baru** | Template email/pesan (undangan, pengingat standby) | Kelola | — | — | — | Teks kini tertanam di kode/SQL (lihat B.4). |
| L4 **Baru** | Riwayat percobaan login & sesi aktif per akun | Kelola | — | Lihat diri | — | Kompensasi karena Supabase gratis tidak punya kunci-akun otomatis (lihat C.5). |

### A.1 Dampak pada menu (`src/lib/admin-nav.ts`)

| Menu | Admin | FO | Petugas | Berubah dari sekarang |
|---|---|---|---|---|
| Dasbor | ya | **ya** (versi FO) | **ya** (versi petugas) | FO & petugas tidak lagi dialihkan (`admin/page.tsx:67-83`) |
| Jadwal & Libur | ya (ubah) | ya (lihat) | ya (lihat, layanannya) | Petugas PTSP kehilangan hak ubah |
| Kelola Layanan **(baru)** | ya | ya (lihat + tombol darurat hari ini) | — | Halaman baru |
| Kelola FAQ | ya | — | ya | Ditambah peringatan + "Coba tanya bot" |
| Pengaduan | ya | ya (tanpa tab Integritas) | **—** | Petugas kehilangan menu |
| Profil Saya **(baru)** | ya | ya | ya | Halaman baru `/admin/profil` (di menu akun, bukan sidebar utama) |
| Konsol Pengaturan **(baru)** | ya | — | — | Gabungan "Pengaturan" lama + AI + email + template |
| Riwayat Perubahan **(baru)** | ya | — | — | Halaman baru |
| Kelola Akun (dulu "Kelola Petugas") | ya | ya (lihat daftar + no HP, tanpa tombol) | — | FO hanya baca |

### A.2 Teks peringatan siap pakai di layar

| Tempat | Teks |
|---|---|
| Form FAQ (petugas), di atas tombol Simpan, **wajib dicentang sekali per sesi** | "⚠ **FAQ yang Anda simpan langsung dipakai bot untuk menjawab warga.** Isi, ketepatan, dan dasar hukumnya menjadi **tanggung jawab Anda sebagai petugas layanan {nama layanan}**. Setiap perubahan tercatat atas nama akun Anda. Bila ragu, gunakan tombol **Coba tanya bot** dulu." Kotak centang: "Saya memahami dan bertanggung jawab atas isi FAQ ini." |
| Daftar FAQ (petugas) | "Menampilkan FAQ layanan {nama layanan}. Anda dapat menonaktifkan FAQ yang keliru. Penghapusan permanen hanya oleh Admin." |
| FAQ, varian B (akun bersama) | Ditambah: "Tercatat atas nama operator bertugas: **{nama operator}**." |
| Tombol darurat FO "Tutup hari ini" | "Layanan {nama} akan **ditutup untuk hari ini saja** ({tanggal}). Warga tidak bisa mengambil nomor baru. Reservasi hari ini tetap tercatat dan perlu dihubungi. Alasan wajib diisi dan tercatat di Riwayat Perubahan." |
| Jadwal (FO/petugas) | "Jadwal ini ditetapkan Admin sesuai SOP. Bila ada perubahan (cuti, jam berubah), hubungi Admin." |
| Banner sidebar (B6) | "📅 **Besok ({hari, tanggal}) libur: {nama libur}.** Layanan tidak menerima antrean." / "⚠ Hari ini layanan **{nama}** ditutup sementara: {alasan}." |
| Konsol Pengaturan, kolom kunci API | "Kunci tersimpan terenkripsi dan **tidak akan ditampilkan lagi**. Untuk mengganti, tempel kunci baru." |
| Profil, email notifikasi | "Email ini hanya untuk menerima pemberitahuan dan tautan atur ulang kata sandi. Email ini **bukan** nama pengguna untuk masuk." |

---

## B. Analisis celah fitur: "jangan ada yang terlewat"

### B.1 Hari kerja nyata per role → apa yang belum ada

Prioritas: **P1** = mengganggu operasional / keputusan CEO, **P2** = penting, **P3** = bagus bila ada.

**Front Office**

| Waktu | Kegiatan | Kondisi sekarang | Fitur yang kurang | Prio | Besar |
|---|---|---|---|---|---|
| 07.30 | Buka hari: cek layanan mana yang buka, siapa yang dijadwalkan standby, jumlah reservasi | FO dialihkan ke Kunjungan. Dasbor hanya untuk Admin. | **Dasbor FO "Hari ini"**: status buka/tutup per layanan, petugas sudah/belum absen, reservasi per layanan, chat menunggu, layar TV aktif | P1 | Sedang |
| 07.30 | Tahu bahwa besok libur | Tidak ada | **Banner libur** (B6) dari `hari_libur` + `layanan_libur` + jadwal. Bisa memakai RPC `is_layanan_buka_jadwal` yang sudah dipakai `me/reservasi` | P1 | Kecil |
| 08.00 | Catat absensi petugas + foto, setujui ajuan | Setujui = "sukses palsu" (M1). Foto gagal di produksi (S12). | Perbaikan (Tahap 0/1). Ditambah **daftar kontak petugas (no HP)** untuk menelepon yang belum datang. | P1 | Sedang |
| 08.00–15.00 | Scan QR, walk-in, panggil/mulai/selesai | FO tanpa layanan ditolak DB (M1/M2) | Perbaikan aturan DB untuk FO | P1 | Sedang |
| sepanjang hari | Chat lintas layanan, ambil alih | Draf AI ditolak untuk FO | Perbaikan + izin FO | P2 | Kecil |
| darurat | Petugas sakit, sistem mitra mati → tutup layanan hari ini | Tabel `layanan_hari` ada, tanpa halaman | **Tombol darurat tutup/buka hari ini** + alasan + tampil di halaman check-in & layar TV + daftar reservasi hari itu untuk dihubungi | P1 | Sedang |
| darurat | Layar TV mati / token hilang | Hanya Admin yang melihat | Daftar layar (lihat saja) | P3 | Kecil |
| sepanjang hari | Pengaduan jalur layanan (K3) | API sudah mengizinkan FO. Tab integritas tampil keliru. | Rapikan tampilan + indikator batas waktu (SLA) | P2 | Kecil |
| sepanjang hari | Buku tamu kantor | Tabel `buku_tamu` ada, tanpa halaman | Halaman buku tamu (perlu konfirmasi CEO apakah dipakai) | P3 | Sedang |
| 15.30 | Tutup hari: sisa antrean, rekap | Ada otomatis: `antrean_tidak_terlayani_akhir_hari` 08:35 UTC = 15:35 WIB, rollup 17:05 UTC = 00:05 WIB | **Ringkasan tutup hari** (sisa antrean, absen pulang, chat terbuka) + tombol rollup (sudah ada) | P2 | Kecil |
| kapan saja | Ganti kata sandi, isi no HP/email | Tidak ada | **Profil Saya** | P1 | Sedang (bagian C) |

**Petugas layanan**

| Kegiatan | Kondisi sekarang | Fitur yang kurang | Prio | Besar |
|---|---|---|---|---|
| Tahu jadwal standby & libur | Menu Jadwal ada, tetapi petugas PTSP bisa mengubah semua layanan | Jadwal mode lihat + **dasbor petugas** (jadwal 7 hari, "besok libur", "besok standby: n reservasi") | P1 | Sedang |
| Absen hadir/pulang | Ada, tetapi bisa menyetujui diri sendiri (S3) | Perbaikan Tahap 0 + teks "antrean dibuka setelah FO verifikasi" | P1 | (Tahap 0) |
| Melayani antrean & isi pendataan | Ada | — | — | — |
| Chat layanannya | Ada | Notifikasi suara/push saat chat eskalasi masuk. **[ASUMSI]** Sekarang hanya ada badge di sidebar. | P2 | Sedang |
| Tulis FAQ (K6) | Terbit tanpa indeks makna (embed 403) | Izinkan embed-L, **peringatan tanggung jawab**, **Coba tanya bot**, nonaktifkan-L | P1 | Sedang |
| Lihat rekap/SKM layanannya | Bocor ke layanan lain di beberapa tab | Saringan wajib di server/DB | P1 | (Tahap 1) |
| Terima pengingat standby | Email dikirim ke **kontak layanan** (`layanan_kontak`, fungsi `email_layanan`, `202607290012…sql:37-44`), bukan ke akun petugas | Opsi: kirim juga ke email notifikasi akun yang terverifikasi | P2 | Kecil |
| Profil, ganti kata sandi | Tidak ada | Profil Saya | P1 | (bagian C) |
| Kotak notifikasi di dalam aplikasi | Tabel `notifikasi` punya `tujuan_user_id`, tetapi halaman hanya untuk pengunjung (`/me/notifications`) | **Lonceng notifikasi staf** di header admin | P3 | Sedang |

**Admin**

| Kegiatan | Kondisi sekarang | Fitur yang kurang | Prio | Besar |
|---|---|---|---|---|
| Atur layanan (nama, loket, prefiks, tampil di TV/landing, bot, ruang lingkup bot) | Kolom ada, tanpa halaman | **Kelola Layanan** (draf §5.2) + mode ruang lingkup bot (K11) | P1 | Sedang |
| Jadwal, libur nasional, standby/pengecualian, kontak layanan, standar pelayanan | Hanya jadwal mingguan & libur khusus punya halaman | **Halaman libur nasional**, **standby/pengecualian**, **kontak layanan**, **standar pelayanan** | P2 | Sedang (4 halaman CRUD kecil) |
| Akun: buat, username, reset sandi, nonaktif/aktif, ganti PIC | Ganti PIC rusak, aktifkan kembali kemungkinan gagal (S10/S11) | **Kelola Akun** (draf §5.1 + bagian C) | P1 | Sedang–Besar |
| Konten publik | Pengaturan situs & landing ada | Digabung ke Konsol Pengaturan + riwayat versi | P3 | Kecil |
| AI: model, kunci, kuota, uji | Hanya lewat env + deploy | **Konsol AI** (bagian D) | P1 (arahan CEO) | Besar |
| Pantau pemakaian & kualitas bot | Log AI ada, tanpa kolom penyedia/latensi (`202607140003…sql:43-53`) | Tambah `provider`, `latensi_ms` ke log + grafik pemakaian per penyedia | P2 | Kecil |
| Laporan | Rekap ada | — | — | — |
| Audit | 20 entri terakhir saja, bisa dipalsukan staf (S14) | **Riwayat Perubahan** dengan filter (draf §5.3) | P2 | Sedang |
| Tahu bila ada percobaan bobol | Tidak ada | Daftar login gagal per akun (dari log Auth Supabase, dibaca server). **[ASUMSI]** Tabel `auth.audit_log_entries` terbaca oleh service role. | P3 | Kecil |

**Temuan baru yang ditemukan saat menelusuri (bukan sekadar fitur kurang)**

| # | Temuan | Bukti | Dampak |
|---|---|---|---|
| N1 | Server bot tidak memeriksa `chatbot_aktif`. "Bot mati" hanya berlaku di tampilan pengunjung. | `src/app/chat/page.tsx:411` (klien). `grep chatbot src/app/api` = kosong. | K5 tidak benar-benar ditegakkan. Pemanggil langsung tetap mendapat jawaban bot. |
| N2 | "Mode akhir pekan" bot hanya mengenal Sabtu/Minggu. Hari libur nasional, libur khusus, dan tutup darurat tidak dikenali. | `api/chat/ai/route.ts:123` (`isWeekendWIB`), `:293` | Pada libur nasional, bot tetap menjanjikan petugas akan membalas. |
| N3 | Pemberitahuan "akun dinonaktifkan" ke Admin dibuat dengan `tujuan_email: null`, lalu dilewati oleh pengirim notifikasi. | `petugas/status/route.ts:70-79`, `notif/send/route.ts:157-158` | Pemberitahuan tidak pernah terkirim. |
| N4 | Draf balasan AI untuk petugas hanya memakai Gemini, tanpa rantai cadangan. | `chat/ai/draft/route.ts:91-140` | Bila Gemini mati atau kuotanya habis, fitur draf mati. Konsol AI (D) harus mencakup jalur ini. |
| N5 | Kuota harian & pemutus arus LLM disimpan di memori **per instance** serverless. | `llm/registry.ts:204` (`globalStates`) | Batas 200/hari bisa terlampaui karena setiap instance Vercel menghitung sendiri. Untuk konsol (D) perlu penghitung di DB. |
| N6 | Email undangan menulis "Layanan Maju Hub" (seharusnya "Lampung Maju Hub"). | `invite/route.ts:199` | Kosmetik. Akan teratasi lewat template (A9). |
| N7 | Auth Hook memasang role ke token tanpa memeriksa status aktif. | `202607140004…sql:24-50` | Memperkuat temuan S5/S13 di draf: `proxy.ts:98-110` percaya role di token. |

### B.2 Inventaris hal yang sekarang tertanam di kode / env / migrasi

Kolom "Layak CMS?":
- **Ya**: aman jadi pengaturan Admin.
- **Ya-uji**: boleh, tetapi wajib lewat draf → uji → aktifkan.
- **Tidak**: tetap di env/kode.
- **Rahasia**: boleh diganti dari layar, tetapi hanya tulis-saja dan terenkripsi.

| Hal | Lokasi sekarang | Layak CMS? | Catatan keamanan |
|---|---|---|---|
| Nama, urutan, dan model penyedia LLM chat | env `LLM_CHAT_PROVIDERS`, `GEMINI_MODEL` (`registry.ts:42-73`, `gemini.ts:28`) | **Ya-uji** | Env tetap jadi cadangan bila DB gagal |
| Kunci API LLM (Gemini, Groq, OpenRouter, Mistral, gateway) | env (`env/server.ts:35-43`) | **Rahasia** | Tidak pernah dikirim ke browser |
| Base URL penyedia / gateway | kode (`registry.ts:31-40`) + env `*_BASE_URL` | **Ya-uji** | Wajib dijaga dari SSRF (D.6). Preset `ollama` http://127.0.0.1 dibuang dari pilihan layar. |
| Kuota harian LLM, ambang gagal, masa jeda | env `LLM_DAILY_LIMIT`, konstanta `registry.ts:27-29` | **Ya** | Batas bawah/atas divalidasi |
| Model embedding FAQ (3072) & dokumen (768) | kode `chat/ai/route.ts:249`, `gemini.ts:57-65` | **Tidak** (hanya tampil, terkunci) | Terikat kolom DB. Lihat D.8. |
| Prompt sistem bot | kode `gemini.ts:7-19` | **Ya-uji** | Bagian "BATASAN" (anti-mengarang) dikunci di kode. Admin hanya mengubah bagian "gaya & sapaan". Mencegah bot dijadikan alat lain. |
| Teks mode akhir pekan, sapaan, "informasi layanan", jawaban gagal | kode `chat/ai/route.ts:44-45, :293, :297, :300` | **Ya-uji** | Sama dengan prompt sistem |
| Ambang kemiripan FAQ (0,7), ambang FTS (0,15), jumlah FAQ diambil (5/3) | `chat/ai/route.ts:21, :31, :215, :257` | **Ya-uji** | Batas 0,3–0,95. Perubahan diuji dengan "Coba tanya bot". |
| Pola sapaan | `chat/ai/route.ts:277-279` (regex) | **Tidak** | Regex dari layar berisiko pola yang sangat lambat (ReDoS). Cukup daftar kata. Prioritas rendah. |
| Batas laju bot (10/60 dtk), pengaduan (5/menit), lacak (10/menit), link edit UMKM (3/60 dtk), gambar galeri (30/menit) | `chat/ai/route.ts:26-27`, `pengaduan/route.ts:17-18`, `lacak/route.ts:14-15`, `request-edit-link/route.ts:30-31`, `page-image/route.ts:16-17` | **Ya**, dengan batas bawah/atas | Pengaman anti-penyalahgunaan. Tidak boleh 0/tak terbatas. |
| Batas unggah PDF (50 MB / 50 halaman), potongan dokumen (1500/100) | `upload/route.ts:6-7`, `dokumen/embed/route.ts:11-12` | Ya (rendah) | Batas atas keras tetap di kode (free tier Vercel: memori/waktu) |
| Nomor WA, pesan WA, FOILA, alamat, jam, email kontak | `site_settings` (sudah CMS) + cadangan di `constants.ts:98-103`, `site-settings.ts:8-15` | **Sudah** | Tabel ini **terbaca publik** (RLS `site_settings` S untuk anon, inv-server §B). **Jangan pernah** simpan rahasia di sini. |
| Nama layanan | `constants.ts:4-12` (harus cocok dengan data awal DB), dipakai sebagai cadangan di `chat/page.tsx:254` | **Ya**, sumbernya tabel `layanan` | Hapus konstanta setelah Kelola Layanan ada |
| Kategori UMKM, kategori pengunjung | `constants.ts:51-69` | **Tidak** (untuk sekarang) | Kategori pengunjung harus cocok dengan CHECK di DB. Perubahan = migrasi. |
| 9 unsur SKM + skala 1–4 | `skm/page.tsx:26-41` | **Label saja: Ya**. Jumlah unsur: **Tidak**. | Kolom DB `u1..u9` tetap. Unsur mengikuti PermenPANRB, jadi jumlahnya jangan diubah. |
| Template email undangan | `invite/route.ts:197-202` | **Ya** (A9) | Isi di-escape (`email-html.ts`). Tautan aksi disisipkan sistem, bukan diketik Admin. |
| Template pengingat standby (H-1, pagi, eskalasi) | SQL `202607290012…sql:115-120` | **Ya** (A9) | Isian `{layanan}`, `{tanggal}`, `{jumlah}` diganti sistem |
| Pengirim email (`RESEND_FROM`) | env + cadangan `invite/route.ts:193` | Ya (alamat), harus domain terverifikasi Resend | Uji kirim sebelum aktif |
| Jam pengingat standby (`notif_h1_sore` 09:00 UTC = 16:00 WIB, `notif_h0_pagi` 00:00 UTC = 07:00 WIB) | migrasi `202607290012…sql:169-173` | **Ya-uji (hanya 2 jam ini)** | Lewat fungsi khusus yang memanggil `cron.alter_job`. Waktu ditampilkan dalam WIB. |
| Jadwal pg_cron lain (anonimisasi 02:00 UTC, prune, rollup 17:05 UTC, alpa otomatis tiap 5 mnt, no-show 08:45 UTC, akhir hari 08:35 UTC, bekukan jadwal 16:00 UTC, UMKM kedaluwarsa, eskalasi pengaduan) | migrasi `202607140005…`, `…290005`, `…290011`, `…300017`, `…300020`, `…300024`, `…310002`, `…290007` | **Tidak** | Menyangkut retensi data (UU PDP) & integritas rekap. Tampilkan saja (lihat-saja). |
| Masa simpan data (anonimisasi, prune log AI) | fungsi SQL | **Tidak** | Kebijakan PDP, perlu SK. Bukan klik. |
| Kunci Supabase, service role, `CRON_SECRET`, VAPID, kunci induk enkripsi | env | **Tidak** (selamanya env) | Ini "kunci rumah". Bila disimpan di DB, rantainya melingkar. |
| CSP (`connect-src`) | `next.config.ts:22` | **Tidak** | Panggilan LLM dari server tidak terkena CSP, jadi gateway baru **tidak** perlu ubah CSP |
| Daftar role (3) | `constants.ts:88-92`, CHECK DB | **Tidak** | K10 |

### B.3 K11 (nanti): bot hanya menjawab dalam ruang lingkup layanan

- **Fakta sekarang:** pencarian FAQ sudah disaring per layanan (`match_faq` dengan `p_layanan_id`, `chat/ai/route.ts:254-257`). Tetapi bila FAQ tidak cocok, bot diberi instruksi "jawab berdasar pedoman layanan publik DPMPTSP" (`:300`). Akibatnya bot **boleh menjawab di luar FAQ**.
- **Usulan:** kolom `layanan.mode_bot`, diatur di halaman Kelola Layanan:
  - `ketat`: hanya FAQ layanan ini. Di luar itu bot menolak dengan sopan, lalu menawarkan petugas atau menyarankan layanan lain yang cocok (nama layanan saja).
  - `umum`: perilaku sekarang.
- Teks penolakan bisa diatur (Ya-uji). Ditegakkan di server, **bukan** di prompt saja. Bila tidak ada FAQ dengan kemiripan ≥ ambang, LLM tidak dipanggil.
- **Besar kerja:** Sedang.

---

## C. Desain login USERNAME

### C.1 Fakta pembatas (terverifikasi Context7, dokumen resmi Supabase)

| Fakta | Sumber | Akibat |
|---|---|---|
| Supabase Auth hanya mengenal email/telepon/OAuth. Tidak ada login username bawaan. | arahan; perilaku umum Supabase | Username harus dipetakan ke email |
| Email bawaan (SMTP Supabase) dibatasi beberapa email per jam. Hanya bisa dinaikkan dengan SMTP sendiri. | docs "going-into-prod", tabel rate limit | Jangan bergantung pada email Supabase. Aplikasi sudah memakai pola `generateLink` + kirim lewat Resend (`invite/route.ts:178-203`), jadi pola ini dipertahankan. |
| Batas masuk/daftar: 30 permintaan per 5 menit **per alamat IP** (bisa diatur) | config.toml `sign_in_sign_ups` | Bila login dilewatkan server, semua pengguna terlihat dari IP Vercel dan berbagi satu batas. Ini alasan opsi 1b (di bawah). |
| **Password Verification Hook** (kunci akun setelah gagal berkali-kali) hanya untuk paket **Teams/Enterprise** | docs auth-hooks (tabel ketersediaan) | Tidak bisa kunci-akun-per-username di Supabase gratis. Diganti kompensasi di C.5. |
| Custom Access Token Hook & Send Email Hook tersedia di **Free** | sama | Auth Hook role tetap bisa dipakai |
| "Single session per user" (membatasi 1 sesi) hanya untuk **Pro ke atas**. Default: **banyak sesi paralel diizinkan**. | blog Supabase "Session Control" | **Login ganda (varian B) sudah jalan otomatis** di paket gratis, tanpa kerja tambahan |
| Ganti kata sandi bisa meminta "reauthentication" (kode ke email) bila opsi *Secure password change* aktif | error code `reauthentication_needed` | Opsi itu harus **dimatikan**, karena email login bersifat sintetis. Verifikasi diganti dengan meminta kata sandi lama. |

### C.2 Pilihan desain

| Opsi | Cara | Plus | Minus | Nilai |
|---|---|---|---|---|
| **1a. Peta di server** | Tabel `username → auth_user_id`. Route `/api/auth/login` mencari email lalu login dari server. | Email internal bisa acak | Semua login lewat IP Vercel, sehingga batas 30/5 menit dipakai bersama. Penyerang bisa "mengunci" semua staf dengan spam. **[ASUMSI]** Belum terbukti Supabase memakai IP asli dari header Vercel. Server juga harus mengurus cookie sesi. | Cadangan |
| **1b. Email sintetis deterministik** (direkomendasikan) | Email login = `{username}@staf.lmh.internal`. **[ASUMSI]** Domain final dipilih saat implementasi; harus domain tanpa kotak surat yang tidak bisa didaftarkan orang lain. Browser cukup menambah akhiran lalu memanggil `signInWithPassword` seperti sekarang (`login/page.tsx:68-71`). | Perubahan terkecil. Batas per IP tetap per pengguna asli. Tidak ada route baru untuk login. Pesan galat Supabase sama untuk "username tidak ada" dan "sandi salah", jadi tidak membocorkan daftar akun. | Ganti username = ganti email login (Admin, lewat server). Email sintetis tidak boleh pernah dikirimi surat oleh Supabase. | **Pilih** |
| 2. Login via nomor HP | Auth telepon Supabase | — | Butuh penyedia SMS berbayar | Tolak |
| 3. Sistem login sendiri (tanda tangan JWT sendiri) | — | Bebas | Besar, rawan keamanan, keluar dari pola Supabase | Tolak |

### C.3 Data (rekomendasi 1b)

Tambahan kolom pada `petugas` (satu migrasi; tidak perlu tabel baru):

| Kolom | Tipe | Aturan |
|---|---|---|
| `username` | text UNIQUE NOT NULL | Pola `^[a-z0-9][a-z0-9.-]{2,31}$`. Huruf kecil, disimpan & dibandingkan dalam huruf kecil. Daftar terlarang: `admin`, `root`, `support`, dll. |
| `no_hp` | text | Format dicek di server (draf §5.1) |
| `email_notifikasi` | text | Email asli, boleh kosong |
| `email_notifikasi_terverifikasi_at` | timestamptz | Kosong = belum terverifikasi. Tidak dipakai untuk kirim selain email verifikasi. |
| `email_verif_hash`, `email_verif_kedaluwarsa` | text, timestamptz | Hash SHA-256 token sekali pakai, berlaku 30 menit |
| `wajib_ganti_sandi` | boolean default false | Diset saat Admin mengatur ulang sandi |
| `jenis_akun` | text CHECK (`pribadi`,`bersama`) | Untuk varian A/B per akun |

RLS:
- Petugas boleh **membaca** barisnya sendiri (sudah ada).
- Petugas **tidak** boleh menulis tabel langsung. Perubahan profil lewat fungsi/route khusus, karena tabel ini menyimpan role (penting: draf S6, jangan buka celah baru).

### C.4 Alur

| Alur | Langkah | Catatan keamanan |
|---|---|---|
| **Login** | Form operator: "Nama pengguna" + "Kata sandi". Bila input mengandung `@`, dipakai apa adanya (masa transisi untuk 14 akun lama). Selain itu ditambah akhiran domain sintetis, lalu `signInWithPassword` dari browser. Setelah berhasil: bila `wajib_ganti_sandi`, langsung ke halaman ganti sandi. | Pesan galat **seragam**: "Nama pengguna atau kata sandi salah". Sekarang `login/page.tsx:91` menampilkan pesan mentah Supabase. Login Google pengunjung tidak berubah. |
| **Ganti sandi sendiri** | Profil → masukkan sandi lama + sandi baru dua kali → `POST /api/akun/sandi`. Server memverifikasi sandi lama dengan klien sementara (tanpa simpan sesi), lalu `auth.admin.updateUserById(id, { password })`. Opsi kotak centang "Keluarkan perangkat lain". | Minimal 10 karakter. **[ASUMSI]** Atur juga "minimum password length" di dasbor Auth. Batas laju lewat `anon_rate_limit` yang sudah ada (pola `request-edit-link`). Tercatat di audit **tanpa** isi sandi. |
| **Lupa sandi (tanpa email asli)** | Halaman login → "Lupa kata sandi? Hubungi Admin/FO". Admin → Kelola Akun → **Atur ulang sandi**: server membuat sandi sementara acak, ditampilkan **sekali** ke Admin, mengakhiri semua sesi target, dan mengisi `wajib_ganti_sandi = true`. | Admin menyampaikan sandi sementara secara langsung/telepon. Tercatat di audit. Admin tidak bisa mengatur ulang sandinya sendiri lewat jalur ini. |
| **Lupa sandi mandiri (opsional, bila email notifikasi terverifikasi)** | Form "username" → server, dengan jawaban **selalu** "Bila terdaftar & email terverifikasi, tautan dikirim". Server memanggil `generateLink({type:'recovery', email: sintetis})` lalu mengirim tautan ke `email_notifikasi` lewat Resend. Polanya sama dengan undangan sekarang. | Anti-enumerasi + batas laju per username & per IP lewat `anon_rate_limit`. Tautan diarahkan ke halaman atur sandi aplikasi. **[ASUMSI]** Perilaku `generateLink` tanpa mengirim email sudah dipakai di `invite/route.ts:178`. |
| **Ganti email notifikasi** | Profil → isi email → server menyimpan hash token, lalu mengirim tautan verifikasi lewat **Resend** (bukan Supabase) → klik → `email_notifikasi_terverifikasi_at = now()`. | Batas 3 permintaan/jam. Email lama diberi tahu "email notifikasi akun Anda diganti" bila sudah terverifikasi. |
| **Edit profil sendiri** | Boleh: nama tampilan, no HP, email notifikasi, sandi, (varian B) daftar operator. **Tidak boleh**: username, role, layanan, status, jenis akun. | Lewat `POST /api/akun/profil` (zod), bukan tulis tabel langsung |
| **Buat akun (pengganti undangan)** | Admin isi: username, nama, role, layanan, jenis akun, (opsional) email notifikasi. Server menjalankan `auth.admin.createUser({ email: sintetis, password: sementara, email_confirm: true })`, lalu menyisipkan `petugas`. Sandi sementara ditampilkan sekali dan `wajib_ganti_sandi = true`. Bila email notifikasi diisi, dikirim **email sambutan via Resend** (tanpa sandi). | Menggantikan `listUsers({perPage:1000})` (`invite/route.ts:126-129`) yang tidak bisa diskalakan. Email sintetis tidak pernah dikirimi surat oleh Supabase, karena `email_confirm:true` dan tidak ada recover/invite Supabase. Ini mencegah lonjakan "bounce" yang bisa membuat pengiriman email proyek dibatasi. **[ASUMSI]** |
| **Ubah username** | Admin → server menjalankan `updateUserById(id, { email: sintetisBaru, email_confirm: true })` + update `petugas.username` dalam satu alur, lalu mengakhiri sesi target. | Riwayat & ID tetap |
| **Ganti PIC (varian A)** | Buat akun baru untuk orang baru, lalu nonaktifkan akun lama. **Tidak** memindahkan akun. | Jejak tiap orang tetap terpisah. Menggantikan alur rusak S10. |
| **Ganti PIC (varian B)** | Admin mengatur ulang sandi akun bersama + "keluarkan semua perangkat" + perbarui daftar operator | Menutup akses orang lama |

### C.5 Brute-force tanpa Password Verification Hook

| Pengaman | Ada di free? | Keterangan |
|---|---|---|
| Batas Supabase 30 percobaan/5 menit per IP | Ya | Diturunkan, mis. 15. **[ASUMSI]** Dashboard Auth → Rate Limits (perubahan konfigurasi produksi, perlu izin CEO). |
| Sandi minimal 10 karakter + wajib ganti sandi sementara | Ya | |
| Daftar percobaan login gagal per akun di Kelola Akun (L4) | Ya | Dibaca server dari log Auth. **[ASUMSI]** Akses service role ke `auth.audit_log_entries`. |
| Kunci akun otomatis setelah N gagal | **Tidak** (Teams) | Diganti dengan pemantauan + Admin bisa "nonaktif + blokir" (`ban_duration`, draf §5.1) |
| CAPTCHA (Turnstile/hCaptcha) bawaan Supabase | **[ASUMSI]** tersedia di free | Opsional. Butuh CSP baru. Tahap lanjut. |

### C.6 Dampak ke bagian lain

| Bagian | Perubahan |
|---|---|
| Auth Hook `set_user_role_claim` (`202607140004…sql:24-50`) | Isi role **hanya bila `aktif = true`**. Selain itu `pengunjung` (menutup N7). Tidak perlu menambah username ke token. |
| `proxy.ts:95-116` | Tetap memakai role token untuk "lolos cepat", ditambah (draf Tahap 1) cek akses per halaman. Arahkan `wajib_ganti_sandi` ke `/admin/profil?wajib=1`. |
| `/login` | Label "Nama pengguna", `type="text"`, `autocomplete="username"`, pesan galat seragam, tautan "Lupa kata sandi?" |
| Undangan `api/admin/petugas/invite` | Diganti "Buat akun" (C.4). Route lama dihapus setelah migrasi. |
| `auth/callback` | Tidak berubah (untuk Google & tautan recovery) |
| Notifikasi | Pengingat standby tetap ke `layanan_kontak`. Notifikasi pribadi akun (sandi diganti, akun dinonaktifkan, N3) ke `email_notifikasi` terverifikasi. |
| Kebijakan `docs/KEBIJAKAN_AKUN_MITRA.md` | Diperbarui sesuai keputusan F1. Kalimat "magic link ke email pribadi" sudah tidak berlaku untuk staf. |

### C.7 Migrasi 14 akun yang ada (1 admin, 3 FO, 10 petugas: inv-server §0)

1. Admin/CEO mengisi tabel sederhana: nama → username → jenis akun → email asli (bila ada).
2. Skrip satu kali, dijalankan **setelah persetujuan CEO** karena menyentuh Auth produksi:
   - mengisi `petugas.username` dan `jenis_akun`;
   - menjalankan `updateUserById(id, { email: sintetis, email_confirm: true })`;
   - menyalin email lama ke `email_notifikasi` **tanpa** tanda terverifikasi (email lama kebanyakan palsu);
   - **sandi tidak diubah**, sesi aktif tetap berlaku.
3. Masa transisi 2 minggu: kotak login menerima email lama (`@`) **atau** username. **[ASUMSI]** Setelah email login diganti, email lama tidak berlaku lagi, sehingga masa transisi hanya relevan untuk akun yang belum dimigrasi.
4. Uji dulu di 1 akun uji, baru 14 akun.
5. Sediakan skrip pembalik (email lama disimpan di berkas lokal terenkripsi, **tidak** di repo).

### C.8 Batas free tier yang relevan

- Email Supabase bawaan **tidak dipakai** sama sekali untuk staf. Semua email staf lewat Resend, yang sudah dipakai `notif/send` & undangan.
  - **[ASUMSI]** Kuota Resend gratis: perlu cek dasbor Resend. Volume staf kecil (puluhan email/bulan).
- Login ganda: gratis. Batas 1 sesi: tidak tersedia, tetapi memang tidak diperlukan.

### C.9 Varian A vs B: keamanan & akuntabilitas

| Aspek | A. Akun pribadi | B. Akun layanan bersama (`helpdesk-oss`) |
|---|---|---|
| Siapa bertindak | Jelas per orang | Hanya "akun helpdesk-oss", **kecuali** ada pencatatan operator (di bawah) |
| Sandi bocor | Ganti 1 akun | Semua pemakai harus diberi sandi baru |
| Orang keluar dari mitra | Nonaktifkan akunnya | Wajib atur ulang sandi + keluarkan semua perangkat |
| Kepatuhan `KEBIJAKAN_AKUN_MITRA.md` & UU PDP (jejak akses data pribadi) | Patuh | Melanggar kebijakan tertulis. Kebijakan harus direvisi resmi. |
| Kemudahan lapangan | Admin membuat lebih banyak akun | Sederhana bagi mitra yang petugasnya bergiliran |
| Kerja tambahan | — | **Operator bertugas**: setelah login, layar meminta memilih nama dari daftar operator akun itu. Pilihan disimpan di tabel `sesi_operator (petugas_id, session_id, nama_operator, mulai)`. `session_id` diambil dari klaim token Supabase. **[ASUMSI]** Token Supabase memuat klaim `session_id`; cek saat implementasi. Pemicu audit, pesan chat, absensi, dan FAQ menyimpan nama operator lewat `session_id` itu. Besar: **Sedang**. |
| Sisa risiko B | Nama operator **dipilih sendiri**, tidak dibuktikan. Ini cukup untuk jejak administratif, tidak cukup untuk pembuktian hukum. | |

**Rekomendasi (opsi campuran, satu desain):**
- **Admin & FO wajib varian A.** Jumlahnya sedikit, hak aksesnya besar.
- **Akun layanan mitra boleh B,** dengan "operator bertugas" wajib dan absensi foto FO sebagai bukti kehadiran fisik.
- Keputusan akhir di F1.

### C.10 Besar kerja bagian C

| Paket | Besar |
|---|---|
| Migrasi kolom + Auth Hook cek aktif + login username + pesan seragam | Sedang |
| Profil Saya (nama, HP, sandi, email notifikasi + verifikasi Resend) | Sedang |
| Kelola Akun (buat, ubah username, atur ulang sandi, nonaktif/aktif + blokir, label belum login, login gagal) | Sedang–Besar |
| Lupa sandi mandiri lewat email notifikasi | Kecil |
| Varian B: operator bertugas + audit | Sedang |
| Skrip migrasi 14 akun + uji | Kecil (perlu izin CEO) |

---

## D. Konsol Pengaturan Admin (CMS + PENGUJIAN)

### D.1 Prinsip

1. **Env tetap jadi sabuk pengaman.** Bila DB gagal atau pengaturan kosong, sistem memakai env seperti sekarang.
2. **Draf → Uji → Aktifkan → (Rollback).** Pengaturan berisiko (Ya-uji di B.2) tidak bisa diaktifkan sebelum lulus uji, kecuali Admin mencentang "aktifkan tanpa uji" dengan alasan tercatat.
3. **Rahasia hanya tulis.** Rahasia tidak pernah dibaca kembali ke browser, tidak masuk log, tidak masuk audit.
4. **Admin saja**, ditegakkan di DB (RLS) + server, dan bukan hanya menu.
5. **Pakai ulang yang ada**: tetap memakai pemutus arus & rantai cadangan `llm/registry.ts`, `site_settings` untuk konten publik, dan `audit_log`.

### D.2 Model data (2 tabel baru + 1 penghitung)

| Tabel | Kolom inti | Akses |
|---|---|---|
| `pengaturan_versi` | `id`, `kunci` (mis. `llm.rantai_chat`, `bot.ambang`, `email.template.undangan`), `kategori`, `nilai jsonb`, `status` (`draf`/`aktif`/`arsip`), `catatan`, `hasil_uji jsonb`, `diuji_at`, `dibuat_oleh`, `diaktifkan_oleh`, `diaktifkan_at` | RLS: **tidak ada** policy untuk anon/authenticated. Hanya service role lewat route admin. Indeks unik parsial: satu `aktif` per `kunci`. |
| `rahasia` | `id`, `nama` (mis. `llm.groq`), `ciphertext`, `iv`, `tag`, `versi_kunci_induk`, `petunjuk` (4 karakter terakhir), `diubah_oleh`, `diubah_at` | Sama: tanpa policy, `REVOKE ALL` dari anon/authenticated. `nilai jsonb` di pengaturan hanya menyimpan **rujukan** `rahasia.id`, bukan isi. |
| `llm_pemakaian_harian` | `tanggal`, `penyedia_id`, `berhasil`, `gagal`, `token_masuk`, `token_keluar` | Ditambah lewat RPC service-only. Menyelesaikan N5 (kuota per instance). |

- **Riwayat** = baris `arsip`.
- **Rollback** = pilih versi lama → "Aktifkan lagi". Sistem menyalinnya menjadi versi baru, sehingga sejarah tidak pernah ditimpa.
- Perubahan juga dicatat pemicu ke `audit_log` (kunci, versi lama → baru; isi rahasia **tidak**).
- Konten **publik** (WA, alamat, landing) tetap di `site_settings` / `landing_content`, karena tabel itu memang terbaca publik. Konsol hanya menampilkannya di satu tempat.

### D.3 Menyimpan rahasia: Vault vs enkripsi aplikasi

| Aspek | Supabase Vault | AES-256-GCM di aplikasi (kunci induk di env Vercel) |
|---|---|---|
| Tersedia di free tier | **[ASUMSI]** ya (ekstensi `supabase_vault`, dokumentasi tidak menyebut batas paket). Proyek ini **belum** memakainya (`grep vault supabase/migrations` = kosong). | Ya, memakai `node:crypto` bawaan Node 22, tanpa pustaka baru |
| Terenkripsi di disk & cadangan | Ya (kunci akar dijaga Supabase, sumber: blog Vault) | Ya |
| Bila **kunci service role** bocor | Penyerang bisa membaca rahasia lewat fungsi dekripsi yang perlu dibuat agar server bisa membaca | Penyerang hanya mendapat teks acak. Butuh **juga** kunci induk dari Vercel. |
| Bila **akses DB/SQL editor** dipakai orang | `vault.decrypted_secrets` menampilkan teks asli | Hanya teks acak |
| Rotasi kunci | Dikelola Supabase | Manual: kolom `versi_kunci_induk`, skrip enkripsi ulang |
| Kerumitan | Rendah di SQL, tetapi perlu fungsi SECURITY DEFINER khusus service | Rendah: ±40 baris (`encrypt`/`decrypt` + tes) |

**Rekomendasi: AES-256-GCM di aplikasi**, karena memisahkan dua kunci: DB + Vercel. Kunci induk `SETTINGS_MASTER_KEY` (32 byte acak, base64) disimpan di env Vercel Production saja, dan didaftarkan di `env/server.ts` agar wajib & ditolak bila placeholder.

Aturan pakai:
- Kunci API **tidak pernah** dikirim ke browser. Tampil sebagai `••••••••abcd`.
- Formulir hanya punya kolom "Tempel kunci baru".
- Penggantian rahasia meminta **konfirmasi kata sandi Admin** (verifikasi seperti C.4).

### D.4 Cache di Vercel serverless & cadangan

- Pembaca `getPengaturan(kunci)` di server: memori per instance, **TTL 60 detik**.
- Saat DB gagal: pakai nilai terakhir di memori; bila tidak ada, pakai env/konstanta lama.
- Layar menulis: "Perubahan berlaku paling lambat ±1 menit." Tidak perlu invalidasi lintas instance (YAGNI).
- Rahasia didekripsi saat dipakai, disimpan di memori instance paling lama 60 detik, dan tidak pernah di-log (`logServerEvent` hanya nama penyedia).

### D.5 Penyedia LLM & gateway

**Struktur nilai `llm.rantai_chat`:** urutan daftar = urutan prioritas. Setiap entri berisi:

`{ id, label, jenis: "gemini-sdk" | "openai-compatible", base_url, model, rahasia_id, aktif, kuota_harian, suhu, batas_waktu_ms }`

Daftar preset (base URL terisi otomatis, bisa disunting bila "URL kustom" diizinkan):

| Preset | Base URL | Status verifikasi |
|---|---|---|
| Gemini (SDK) | bawaan SDK | dipakai sekarang |
| Gemini (OpenAI-compatible) | `https://generativelanguage.googleapis.com/v1beta/openai` | ada di kode (`registry.ts:33`) |
| Groq | `https://api.groq.com/openai/v1` | ada di kode |
| OpenRouter | `https://openrouter.ai/api/v1` | ada di kode |
| Mistral | `https://api.mistral.ai/v1` | ada di kode |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh/v1` | **[ASUMSI]** belum diverifikasi di sesi ini, cek dokumen resmi saat implementasi |
| Cloudflare AI Gateway | `https://gateway.ai.cloudflare.com/v1/{akun}/{gateway}/compat` | **[ASUMSI]** sama |
| LiteLLM (milik sendiri) | URL https milik instansi | butuh "URL kustom" |

**Dampak kode (pakai ulang, bukan tulis ulang):**
- `parseChatProviderSpec` (`registry.ts:45-73`) dipertahankan untuk jalur env.
- Ditambah satu fungsi kecil yang mengubah `llm.rantai_chat` menjadi `ProviderSpec[]` dengan `apiKey` langsung, karena kini `apiKeyEnv` dibaca dari `process.env` di `registry.ts:134,188`.
- `generateWithFallback` cukup menerima daftar spesifikasi itu. `canAttempt`/`recordFailure`/`MAX_FAIL_STREAK`/`COOLDOWN_MS` tidak disentuh.
- Kuota harian dicek terhadap `llm_pemakaian_harian` (DB), bukan hanya memori.
- Jalur draf AI petugas (N4) ikut memakai fungsi yang sama.

**Urutan & cadangan dari layar:**
- Seret-urutkan baris dan sakelar aktif.
- Kolom status langsung: hari ini terpakai X/kuota, gagal terakhir, sedang "jeda pemutus arus" sampai jam berapa. **[ASUMSI]** Status jeda bersifat per instance, jadi ditampilkan sebagai "terakhir terlihat".
- Tombol "Uji seluruh rantai" mensimulasikan penyedia #1 gagal, untuk membuktikan cadangan bekerja.

### D.6 Penjagaan SSRF untuk base URL

Wajib di server, saat simpan **dan** saat pakai:

1. Hanya `https:`. Tolak `http`, `file`, IP literal, port selain 443 (kecuali allowlist).
2. Resolusi DNS (`node:dns/promises`), lalu tolak bila alamat termasuk:
   - jaringan privat/loopback/link-local: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 (termasuk metadata 169.254.169.254), ::1, fc00::/7, fe80::/10;
   - 0.0.0.0, 100.64/10.
3. `fetch` dengan `redirect: 'manual'`, sehingga pengalihan dianggap gagal.
4. Batas waktu (mis. 15 dtk) dan batas ukuran jawaban.
5. **Allowlist host** (default **aktif**): hanya host preset. "URL kustom" harus dinyalakan khusus oleh Admin + tercatat.
   - Allowlist ini juga menutup celah *DNS rebinding*, yang tidak bisa ditutup sepenuhnya oleh `fetch` bawaan.
6. Pesan galat ke layar dipotong, tanpa header atau kunci (memakai pola `failCause` yang sudah memotong 200 karakter, `registry.ts:9-11`).

### D.7 Tombol UJI per pengaturan

| Uji | Apa yang dilakukan | Ditampilkan |
|---|---|---|
| **LLM (per penyedia)** | Satu panggilan langsung ke penyedia itu (tanpa rantai) dengan prompt mini "Balas dengan satu kata: SIAP", memakai nilai **draf** termasuk kunci draf | Lulus/gagal, kode HTTP, latensi (ms), cuplikan jawaban, token masuk/keluar (field `usage` bila ada), perkiraan biaya bila Admin mengisi harga per 1 juta token (opsional), sisa kuota internal hari ini |
| **Uji rantai** | Jalankan rantai dengan penyedia #1 dipaksa gagal | Penyedia mana yang menjawab |
| **Coba tanya bot** | Pertanyaan contoh + pilih layanan → jalur `api/chat/ai` mode kering (tidak menyimpan pesan/sesi, tidak eskalasi) | Jawaban, FAQ yang dipakai, skor kemiripan, penyedia, latensi |
| **Embedding** | Embed kata "uji" dengan model terpasang | Panjang vektor **harus 3072** (FAQ). Bila tidak cocok, merah besar "TIDAK COCOK DENGAN DATABASE". |
| **Email (Resend)** | Kirim email uji **hanya ke email notifikasi terverifikasi milik Admin sendiri** (tidak boleh alamat bebas, agar tidak jadi alat spam) | ID kirim Resend / galat |
| **Push** | Kirim notifikasi uji ke langganan push milik Admin sendiri | Jumlah perangkat berhasil/gagal |
| **Template** | Pratinjau dengan data contoh | HTML hasil (sudah di-escape) |
| **Jam pengingat** | Tampilkan "berikutnya berjalan: {tanggal jam WIB}" | — |

Semua uji tercatat di `hasil_uji` + batas laju, mis. 20 uji/jam/admin, agar kuota vendor tidak terbakar.

### D.8 Embedding terikat model: konsekuensi bila diganti

- **Fakta:**
  - kolom FAQ `vector(3072)` (`202608080002_faq_embedding_3072.sql`) diisi `gemini-embedding-001`;
  - model kueri **ditulis langsung di kode** (`chat/ai/route.ts:249`);
  - dokumen peraturan `vector(768)` (`202607300023…sql:34`, `gemini.ts:58`).
- Vektor dari dua model berbeda **tidak bisa dibandingkan**, sekalipun dimensinya sama. Mengganti model di layar tanpa langkah lain membuat pencarian makna **diam-diam salah**: skor acak, lalu bot menjawab dari FAQ yang keliru.
- Bila dimensi berbeda: perlu **migrasi kolom** + hapus semua vektor + indeks ulang. Migrasi 3072 sebelumnya sudah melakukan ini.
- **Keputusan desain:**
  - di konsol, model embedding **hanya tampil (terkunci)** + tombol Uji embedding;
  - penggantian model = pekerjaan terpisah: migrasi + "indeks ulang semua FAQ" (route embed yang ada) + pengalihan serentak;
  - selama masa itu bot tetap jalan lewat pencarian teks `match_faq_teks` (jalur cadangan sudah ada, `chat/ai/route.ts:212-216, :263-269`).
- Ganti **model chat** (Gemini → Groq dsb.) **tidak** memengaruhi embedding. Tetapi bila kunci Gemini dicabut seluruhnya, pencarian makna mati dan bot turun ke pencarian teks.
- **[ASUMSI]** Status `text-embedding-004` di Google perlu dicek. Komentar migrasi menyebut "gemini-embedding-004", sedangkan `gemini.ts:62` melarang nama itu. Ada ketidakkonsistenan dokumentasi.

### D.9 Rancangan layar (wireframe teks)

```
Konsol Pengaturan                                   [Riwayat] [Admin saja]
┌ Tab: Umum | Kecerdasan Buatan | Bot | Email & Notifikasi | Batas & Keamanan | Jadwal Otomatis (lihat) ┐

[Kecerdasan Buatan]
 Rantai penyedia chat  (berlaku ≤1 menit setelah diaktifkan)        Status: AKTIF v7 · Draf v8 ●
 ┌──┬──────────────┬────────────────────────┬──────────┬────────┬────────────┬──────────┬────────┐
 │≡ │ Penyedia     │ Model                  │ Kunci    │ Kuota  │ Hari ini   │ Status   │ Aksi   │
 │≡1│ Gemini (SDK) │ gemini-flash-latest    │ ••••a1b2 │ 200    │ 37/200     │ ● sehat  │ [Uji]  │
 │≡2│ Groq         │ llama-3.3-70b-versatile│ ••••9c0d │ 500    │ 0/500      │ ● sehat  │ [Uji]  │
 │≡3│ OpenRouter ▾ │ ________               │ [Tempel] │ 100    │ —          │ ○ belum  │ [Uji]  │
 └──┴──────────────┴────────────────────────┴──────────┴────────┴────────────┴──────────┴────────┘
 [+ Tambah penyedia ▾ preset/gateway]   ☐ Izinkan URL kustom (berisiko, tercatat)
 Model embedding FAQ: gemini-embedding-001 · 3072 dimensi  🔒 terkunci   [Uji embedding]
 Hasil uji draf v8: Gemini ✔ 820 ms · Groq ✔ 410 ms · OpenRouter ✖ 401 kunci salah
 [Uji seluruh rantai]   [Simpan draf]   [Aktifkan v8]  (nonaktif sampai semua penyedia aktif lulus)

[Bot]
 Ambang kemiripan FAQ [0.70]  Ambang teks [0.15]  Jumlah FAQ [5]
 Gaya & sapaan (boleh diubah) [textarea]   Aturan anti-mengarang: 🔒 dikunci sistem
 Teks saat gangguan [textarea]   Teks mode libur [textarea]
 [Coba tanya bot: pilih layanan ▾ | pertanyaan ____ | Kirim]  → jawaban · FAQ dipakai · skor · penyedia

[Riwayat]  v8 draf (Admin A, 10:02) · v7 aktif (Admin A, 2 Okt) [Lihat beda] · v6 arsip [Aktifkan lagi]
```

### D.10 Besar kerja bagian D

| Paket | Besar |
|---|---|
| Tabel `pengaturan_versi` + `rahasia` + enkripsi + pembaca ber-cache + cadangan env | Sedang |
| Konsol AI (rantai, kunci, preset/gateway, SSRF, uji, penghitung DB, log provider/latensi) | Besar |
| Tab Bot (ambang, teks, Coba tanya bot) + K11 mode ketat | Sedang |
| Tab Email & Notifikasi (template, uji Resend/push, jam pengingat) | Sedang |
| Tab Batas & Keamanan (rate limit dengan batas aman) | Kecil |
| Riwayat/rollback umum (sekali bangun untuk semua tab) | Kecil |

---

## E. Rencana tahap revisi

Simbol **[DB]** = menerapkan migrasi/skrip ke DB/Auth **produksi** → perlu persetujuan CEO per kali. Juga `npm run test:rls` menyentuh produksi (draf §4).

| Tahap | Isi | Bergantung pada | Besar | Risiko utama | [DB] |
|---|---|---|---|---|---|
| **0. Keamanan darurat** | Draf Tahap 0 (S1–S4, S6, S5-DB) **+ N7** (Auth Hook cek aktif) | — | Sedang | Menghapus izin "selalu boleh" kunjungan/tiket bisa memutus check-in (wajib diuji) | Ya |
| **1. Matriks inti (versi revisi A)** | Draf Tahap 1, disesuaikan:<br>• FO pengaduan<br>• petugas tanpa pengaduan<br>• FAQ petugas terbit langsung + embed-L + peringatan<br>• FO draf AI<br>• K7 cabut izin FO<br>• **N1 bot mati ditegakkan server**<br>• N3 | 0 | Besar | Banyak file. Bagi per domain (lihat paralel). | Ya |
| **2. Akun & login username** | C.3–C.7: kolom, login, Profil Saya, Kelola Akun, atur ulang sandi, migrasi 14 akun. Varian B bila dipilih. | 0 (Auth Hook), keputusan F1 | Besar | Salah migrasi = staf tak bisa masuk. Wajib uji 1 akun + skrip pembalik. | **Ya (Auth produksi)** |
| **3. Operasional harian** | Kelola Layanan (+K11 kolom `mode_bot`), tombol darurat FO, **banner libur (B6)**, dasbor FO & petugas, halaman libur nasional/standby/kontak/standar (lihat & kelola Admin), N2 (mode libur bot membaca jadwal) | 1 | Besar | Dasbor = banyak kueri. Jaga kuota egress free tier dengan RPC agregat, bukan banyak query. | Ya |
| **4. Konsol Pengaturan** | D.2–D.9. Urutan dalam tahap: inti data+rahasia → AI → Bot → Email → Batas | 1 (Admin-only kokoh). Bisa paralel dengan 3. | Besar | Rahasia & SSRF: wajib tinjauan keamanan (code-reviewer) sebelum aktif | Ya + **env baru `SETTINGS_MASTER_KEY` di Vercel** |
| **5. Riwayat & perapihan** | Riwayat Perubahan (audit via pemicu, S14), login gagal (L4), lonceng notifikasi staf, buku tamu (bila disetujui), P2 draf (S15–S19), dokumen peraturan untuk bot (F5) | 1–4 | Sedang | — | Ya |
| **Ditunda** | Pengajuan perubahan jadwal oleh petugas (draf §3 B), CAPTCHA login, ganti model embedding | — | — | — | — |

**Paralel tanpa tabrakan berkas** (satu penulis per berkas, sesuai AGENTS.md):

| Tahap | backend-dev | frontend-dev | tester | code-reviewer |
|---|---|---|---|---|
| 0 | satu migrasi baru + tes kontrak statis | — (tidak ada UI) | tes perilaku `test:rls` (izin CEO) | tinjau migrasi |
| 1 | migrasi RLS + `src/lib/` helper `requireStaff` + route `api/**` | `admin-nav.ts`, halaman `admin/**` (teks & tombol). Kontrak API disepakati dulu. | tes per sel matriks | tinjau |
| 2 | migrasi kolom, `api/akun/*`, `api/admin/akun/*`, skrip migrasi | `login/page.tsx`, `admin/profil`, `admin/petugas/*` | uji alur login/ganti/atur ulang sandi | tinjau keamanan Auth |
| 3 ∥ 4 | **backend-dev A**: RPC dasbor/libur/darurat (Tahap 3). **backend-dev B**: `lib/settings/*`, `lib/llm/registry.ts`, `api/admin/pengaturan/*` (Tahap 4). Berkas tidak bersinggungan. Titik temu satu-satunya `chat/ai/route.ts` (N2, K11, rantai), dipegang **satu** pemilik bergiliran. | frontend A: dasbor/kelola layanan. frontend B: konsol. | uji uji-coba (tombol UJI) & SSRF | tinjau rahasia/SSRF |

---

## F. Pertanyaan terbuka untuk CEO (8)

| # | Pertanyaan | Pilihan | Rekomendasi |
|---|---|---|---|
| F1 | **Model akun (K1 bertentangan).** Akun pribadi atau akun layanan bersama (`helpdesk-oss`, login ganda)? | (a) Semua pribadi, sesuai kebijakan tertulis · (b) Semua boleh bersama · (c) **Campuran**: Admin & FO pribadi, akun mitra boleh bersama dengan "operator bertugas" wajib | **(c).** Kebijakan `KEBIJAKAN_AKUN_MITRA.md` direvisi resmi. |
| F2 | K4: benarkah Admin **tidak** perlu diberi tahu saat FO menutup/membuka layanan hari ini? (Jejak tetap tercatat.) | Ya, cukup tercatat · Tidak, kirim pemberitahuan | **Cukup tercatat**, plus muncul di banner semua staf (B6), sehingga Admin tetap melihat |
| F3 | K3: petugas **sama sekali tidak** melihat pengaduan tentang layanannya? | Tidak melihat · Lihat saja (tanpa ubah status) | **Lihat saja**, tanpa identitas pelapor. Bahan perbaikan layanan. Bila CEO ingin ketat: tidak melihat. |
| F4 | Lupa kata sandi | (a) Hanya diatur ulang Admin · (b) (a) + mandiri lewat email notifikasi terverifikasi | **(b)** |
| F5 | K10 & risiko 1 admin: bila satu-satunya Admin lupa sandi, hanya programmer yang bisa memulihkan lewat skrip | (a) Tetap 1 admin · (b) Buat 1 akun admin cadangan dipegang pejabat lain (bukan role baru) | **(b)**. Tidak menambah role, hanya menambah 1 akun. |
| F6 | Konsol AI: boleh Admin memakai **URL gateway kustom** (mis. LiteLLM milik sendiri), atau hanya penyedia/gateway dari daftar? | Daftar saja · Daftar + kustom dengan izin khusus | **Daftar saja dulu.** Kustom dibuka bila benar-benar ada gateway instansi. |
| F7 | K11 mode bot "ketat" (hanya FAQ layanan) dipakai **otomatis** untuk semua layanan mitra? | Ketat untuk semua · Diatur per layanan, default umum | **Per layanan, default ketat untuk layanan mitra** (BPJS, Bank Lampung, Halal), umum untuk Helpdesk DPMPTSP |
| F8 | Fitur yang tabelnya ada tetapi tak berhalaman: **buku tamu** dan **dokumen peraturan untuk bot** (dokumen sudah diunggah tetapi tidak dipakai bot). Dikerjakan? | Keduanya · Salah satu · Tidak | **Dokumen peraturan: ya** di Tahap 5 (menambah mutu jawaban). **Buku tamu: hanya bila FO memang mencatat tamu kantor.** |

---

## Ketidakpastian yang diakui

- Klaim Supabase yang terverifikasi lewat Context7: batas email bawaan, batas login per IP, ketersediaan hook per paket, kontrol sesi Pro-only, fungsi Vault.
- Yang **belum** terverifikasi:
  - Vault di free tier;
  - klaim `session_id` di token;
  - akses service role ke `auth.audit_log_entries`;
  - base URL Vercel/Cloudflare AI Gateway;
  - CAPTCHA di free tier;
  - kuota Resend;
  - domain email sintetis yang diterima validasi Supabase;
  - apakah Supabase memakai IP asli di balik server Vercel (opsi 1a).
- Semua perilaku RLS/fungsi tetap berasal dari pembacaan teks (inventaris), belum diuji tulis di produksi.
- Volume perubahan pengaturan, jadwal, dan pengaduan diasumsikan rendah.
