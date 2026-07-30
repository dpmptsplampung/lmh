# 02 — DESAIN TARGET (FASE C)

> Desain per domain, memetakan **setiap ID keputusan** ke rancangan konkret.
> Dibuat untuk memenuhi **Bagian 8.3** dari `LMH-AGENT-SPEC.md`. Dasar: `00-CODE-INVENTORY.md` + `01-GAP-ANALYSIS.md`.
>
> **Prinsip pengikat (P1–P4):** P1 masalah utama = kepatuhan petugas, bukan teknologi · P2 setiap angka harus bisa menuntut seseorang · P3 jangan pernah menolak tanpa menawarkan jalan lain · P4 bot boleh mengutip, tidak boleh menafsirkan.
>
> **Konvensi:** nama tabel/kolom/enum = Bahasa Indonesia; nama file/fungsi/variabel kode = Bahasa Inggris; seluruh batas hari = `Asia/Jakarta`. Migrasi **aditif**; tidak ada penghapusan kolom/tabel/enum (OPS-01).

---

## 0. ARSITEKTUR MENYELURUH (satu paragraf)

LMH tetap satu aplikasi Next.js (App Router) + Supabase. Perubahan terbesar adalah **pemecahan model kunjungan** (`visit` → `kunjungan` + `tiket_antrean`) dan **penambahan lapisan kepatuhan** (jadwal beku, absensi-gerbang, notifikasi berjenjang, laporan kepatuhan). Karena sistem **live**, semua perubahan mengikuti protokol aditif 4 langkah (OPS-01) dan pemecahan `visit` menjadi work package tersendiri paling berisiko (OPS-02). Satu **lapisan metrik tunggal** (`rekap_harian_layanan`) menyuplai dashboard, PDF, Excel, dan email agar angka identik (RPT-01, I-24).

---

## 1. DOMAIN LAYANAN (SVC)

**Masalah:** `layanan.tipe` mencampur penyelenggara & kemampuan; live hanya 10 layanan; tidak ada loket/prefiks/kontak instansi.

**Desain:**
- **SVC-03** — Ganti `tipe` dengan dua dimensi: kolom `penyerta` (`dpmptsp`|`p4`) + bendera boolean `punya_antrean`, `punya_chat`, `punya_jadwal_standby`, `punya_dokumen_peraturan`. Kolom `tipe` **dipertahankan selama transisi** (OPS-01), di-deprecate bertahap.
- **SVC-02** — Tambah `status_tampilan` enum (`aktif`|`coming_soon`|`nonaktif`). BPN di-seed sebagai `coming_soon`: tampil di situs, tidak bisa direservasi/antre/chat.
- **SVC-04** — Tambah `nomor_loket text` pada `layanan`. **JANGAN buat tabel loket.**
- **SVC-05** — Tambah `prefiks_antrean text` (misal `A`,`B`). Format nomor `<PREFIKS>-<URUT>` (misal `A-001`), reset harian WIB. Lihat QUE-06 untuk penomoran atomik.
- **SVC-01** — Seed data 11 layanan sesuai Bagian 2.1 spec (7 P4 + 4 DPMPTSP), koreksi nama "BALMON" → "Balai Monitor SFR", set `penyerta` & bendera yang benar. Matchmaking & Investment Gallery menjadi `penyerta=dpmptsp`, `punya_antrean=true` (bukan `modul_publik`).
- **SVC-06** — Tabel baru `layanan_kontak` (lihat NOT-01) menampung kontak resmi instansi (PIC, telepon/WA, alamat kantor asli, jam layanan instansi, tautan layanan online) untuk pengalihan saat alpa (P3).

---

## 2. DOMAIN KUNJUNGAN & ANTREAN (QUE)

**Masalah paling berisiko (OPS-02).** `visit` mencampur kunjungan & tiket; tidak ada nomor antrean; tidak ada status `tidak_terlayani`.

**Desain:**
- **QUE-01** — Tabel baru `kunjungan` (satu kedatangan/orang/hari) dan `tiket_antrean` (satu nomor/layanan, FK ke `kunjungan`). `visit` dipertahankan sebagai sumber backfill & dual-write selama transisi. Menghasilkan dua angka benar: "120 pengunjung, 143 layanan" (I-03).
- **QUE-02 / QUE-03** — Satu `kunjungan` boleh banyak `tiket_antrean`. Penambahan tiket ke kunjungan aktif hari itu via **scan QR** atau **lewat FO** tanpa isi ulang identitas (cukup pilih layanan tambahan).
- **QUE-04** — Nomor terbit **saat check-in di kantor**, urut kedatangan. Status alur `terjadwal→menunggu→dilayani→selesai` dipertahankan.
- **QUE-06** — Penomoran **atomik di PostgreSQL**: fungsi `terbit_nomor_antrean(p_layanan_id, p_kunjungan_id)` memakai tabel penghitung `antrean_counter(layanan_id, tanggal, nomor_terakhir)` dengan `INSERT ... ON CONFLICT (layanan_id,tanggal) DO UPDATE SET nomor_terakhir = antrean_counter.nomor_terakhir + 1 RETURNING nomor_terakhir`. Jaring pengaman: `UNIQUE (layanan_id, tanggal, nomor)` pada `tiket_antrean` (I-01). **JANGAN** "SELECT MAX+1" di aplikasi.
- **QUE-07** — Klaim tiket sekali: `UPDATE tiket_antrean SET status='dilayani', dilayani_oleh=..., waktu_mulai_layan=now() WHERE id=$1 AND status='menunggu'` lalu periksa baris terpengaruh (optimistic lock, I-02). Kolom `dilayani_oleh uuid` per tiket.
- **QUE-08** — Tambah nilai enum status `tidak_terlayani` (petugas tidak hadir) terpisah dari `no_show` (warga tak datang) & `batal` (dibatalkan warga). Terapkan OPS-08: cari semua pemetaan status di TS.
- **QUE-05** — Ubah horizon reservasi menjadi **H+7** (ganti `MAX_BOOKING_DAYS = 30` → `7`). Tanpa slot jam tetap. Validasi: `tanggal >= hari ini AND <= hari ini+7 AND hari kerja AND ada jadwal` (server-side + klien).
- **QUE-15** — pg_cron akhir jam layanan mengubah reservasi tanpa check-in → `no_show` (batas hari WIB, RPT-07).
- **QUE-09 / QUE-14** — Tiket yang sudah terbit **tetap dilayani** meski lewat jam tutup; catat `jam_selesai_aktual` per layanan/hari di `layanan_hari`. **JANGAN** ada job yang menghanguskan tiket `menunggu`/`dilayani`.
- **QUE-10 / QUE-11** — Kolom `layanan.batas_ambil_nomor_menit int DEFAULT 30`. Tabel `layanan_hari` menyimpan `jam_buka_efektif`, `jam_tutup_efektif`, `jam_selesai_aktual` per layanan/tanggal — diturunkan dari jam default → pengecualian → penutupan manual FO → absen keluar. Batas ambil = `jam_tutup_efektif - batas_ambil_nomor_menit`.
- **QUE-12** — Penolakan setelah batas **wajib** memuat: (a) pengambilan nomor ditutup, (b) tawaran reservasi hari berikutnya yang tersedia, (c) tawaran live chat sekarang (P3).
- **QUE-13** — Saat nomor diterbitkan, tampilkan estimasi waktu dipanggil (pakai `mv_estimasi_layanan`/`v_antrian_loket`), terutama menjelang batas.
- **QUE-16** — (TUNDA) Siapkan kolom `layanan.kuota_harian int NULL`; **JANGAN** bangun logika kuota.
- **QUE-17** — Tombol **panggil ulang** di dashboard petugas: mengubah tiket yang sedang `dilayani` menjadi "dipanggil lagi" (nomor berkedip + peristiwa suara diulang). Mekanisme pemanggilan **menerbitkan peristiwa `nomor_dipanggil`** agar suara (DSP-08) bisa ditambahkan nanti tanpa perubahan struktural.
- **QUE-18** — (TUNDA) Prioritas kelompok rentan manual FO; penanda usulan dicatat di OPEN-QUESTIONS, **jangan diimplementasikan** tanpa persetujuan.

---

## 3. DOMAIN JADWAL & ABSENSI (SCH)

**Masalah:** jadwal P4 belum diisi; tidak ada gerbang absensi; jam absen dari klien; tidak ada pembekuan/alpa.

**Desain:**
- **SCH-03** — (Fakta, bukan fitur) Jadwal standby **stabil** (berubah 1–2×/bulan, tidak terduga). Inilah yang membuat jadwal **layak dipakai sebagai pemblokir** (SCH-01). Jangan merancang berdasarkan asumsi jadwal kacau.
- **SCH-04** — Dua tabel: `jadwal_standby` (pola berulang mingguan per layanan: `hari`, `jam_mulai`, `jam_selesai`) dan `jadwal_pengecualian` (penyimpangan per tanggal: libur/penggantian/jam beda + `alasan`). Migrasi dari `layanan_jadwal`+`layanan_libur` (dipertahankan selama transisi).
- **SCH-01 / SCH-11** — Pendaftaran antrean/reservasi **ditolak** di luar hari jadwal standby. Fungsi bersama **`jadwal_berikutnya(p_layanan_id, p_dari_tanggal)`** mengembalikan tanggal standby terdekat — dipakai halaman reservasi, check-in, bot (CHT-04), dan layar TV (DSP-04). Pesan penolakan menyebut jadwal terdekat + alternatif (P3).
- **SCH-02** — **Gerbang kedua:** untuk **hari ini**, antrean suatu layanan **tidak dibuka** sampai ada absensi tercatat. Hierarki: hari ini kehadiran nyata > jadwal; hari depan pakai jadwal. Terapkan di fungsi penerbitan nomor & validasi reservasi (I-05).
- **SCH-05** — **Pembekuan harian:** pg_cron malam membekukan jadwal esok ke `jadwal_harian_beku` (snapshot per layanan/tanggal). Tabel ini **tidak boleh diubah surut** (kecuali Admin dengan alasan + tercatat di audit). Satu-satunya dasar penilaian hadir/alpa (I-08, P2).
- **SCH-06** — Tombol cepat FO **tutup/buka layanan hari ini** + alasan. Efek langsung ke situs publik, reservasi, layar TV, bot, dan notifikasi ke warga yang sudah reservasi hari itu.
- **SCH-07** — Jadwal dikelola FO & Admin, **wajib berjejak**: trigger audit mencatat siapa mengubah apa, kapan, dari nilai apa ke nilai apa (pakai pola `audit_change()` yang sudah ada).
- **SCH-08** — **Jam dari SERVER, tak bisa mundur** (I-09). Perbaiki `admin/absensi` agar `jam_masuk` diisi `now()` di server (RPC/fungsi DB), bukan `new Date()` klien. Alur utama: petugas lapor FO → FO klik hadir. Alur pendukung: petugas tekan "saya sudah hadir" → permintaan konfirmasi satu klik di FO. Kolom `sumber` (`fo`|`petugas_ajukan`|`otomatis`) + `dicatat_oleh uuid`. Jam absen tampil di laporan bulanan.
- **SCH-09** — Absen keluar **otomatis** di akhir jam layanan + tombol opsional FO "petugas sudah pulang". Jika petugas pulang lebih awal sementara ada antrean → loket **ditutup di sistem**, tiket belum dilayani → `tidak_terlayani`.
- **SCH-10** — **Alpa otomatis:** pada hari berjadwal, jika belum ada absensi sampai batas (contoh 09.00, OQ-03) → status hari itu `alpa`; email dini ke warga yang reservasi (sebelum berangkat) berisi tawaran live chat + kontak instansi (`layanan_kontak`); tiket/reservasi → `tidak_terlayani`; eskalasi ke atasan+FO (NOT-04).

---

## 4. DOMAIN NOTIFIKASI & LAPORAN KEPATUHAN (NOT)

**Desain:**
- **NOT-01** — Tabel `layanan_kontak`: `layanan_id`, `email`, `peran` (`pic`|`atasan`|`cc`), `aktif`, plus kontak resmi instansi (SVC-06). **Email bersifat institusional, tidak berganti meski PIC berubah** — menjawab kebutuhan di balik RBA-07.
- **NOT-02** — Email pengingat petugas **hanya jika KETIGANYA:** ada jadwal hari itu ∧ petugas belum absen ∧ sudah ada antrean/reservasi. **JANGAN** kirim notif setiap ada pendaftar.
- **NOT-03** — Notifikasi juga untuk layanan internal DPMPTSP (Matchmaking, Investment Gallery) karena pegawainya kurang aware.
- **NOT-04** — **Eskalasi berjenjang:** H-1 sore→PIC ("Besok standby, ada N reservasi"); Hari-H pagi sebelum batas→PIC ("Hari ini standby, N reservasi, mohon absen di FO"); setelah batas terlewat→**atasan+FO** ("Layanan X belum ada kehadiran, N warga terdampak"). Diimplementasikan sebagai pg_cron + fungsi yang menulis ke tabel `notifikasi`.
- **NOT-05** — Ringkasan harian 1 email/layanan; `idempotency_key = layanan_id + tanggal + jenis` (sudah ada kolomnya).
- **NOT-06** — **Dua varian laporan kepatuhan:** Internal (Matchmaking/Investment Gallery — jalur ke atasan, bisa masuk penilaian kinerja) vs Mitra P4 (hanya lewat surat pimpinan ke pimpinan instansi). Dua template berbeda.
- **NOT-07** — Isi laporan: % hari hadir dari yang dijadwalkan, jumlah hari alpa, **jumlah warga terdampak** (senjata paling menekan), rata-rata keterlambatan absen. **Sebut nama layanan, bukan nama orang.**

---

## 5. DOMAIN LIVE CHAT (CHT)

**Desain:**
- **CHT-01** — Ubah makna `chat_sesi.status='selesai'` menjadi **utas berkelanjutan** per warga per layanan (bukan penutup final). Warga bisa pergi & kembali melanjutkan utas yang sama. Tambahkan konsep "utas aktif" yang bisa dilanjutkan.
- **CHT-02** — Riwayat chat tampil di `/me`; petugas melihat riwayat percakapan sebelumnya dengan warga yang sama.
- **CHT-03** — Bot menjawab lebih dulu (sudah ada fondasi), petugas masuk kemudian.
- **CHT-04** — Bot menjadi **juru bicara jadwal**: jawab "kapan layanan X standby / buka hari ini / jadwal terdekat / cara reservasi" memakai fungsi `jadwal_berikutnya()` yang sama dengan SCH-01.
- **CHT-05** — Serah terima bot↔petugas dua arah mulus; label "Bot" vs nama petugas tidak ambigu.
- **CHT-06** — Chat tetap jalan meski loket tutup (bot mengakomodasi + menyebut jadwal).
- **CHT-07** — Dashboard `/admin/chat` **diurutkan berdasarkan lama menunggu balasan** (bukan waktu pesan masuk) + penanda warna saat lewat batas.
- **CHT-08** — FO punya pandangan **lintas-layanan** dan bisa takeover chat dari petugas layanan lain (butuh role `front_office`, RBA-02).
- **CHT-09** — Notifikasi hanya saat warga **tidak sedang aktif** di halaman chat (deteksi kehadiran halaman).
- **CHT-10** — (SUDAH) Chat wajib login Google.
- **CHT-11** — Tangani 3 akibat wajib login: sediakan **FAQ publik & jadwal standby tanpa login**; **preferensi kontak** (email lain/WA, fondasi `pengunjung.no_hp` + `ProfileCompletenessGate`); **magic-link email** sebagai cadangan login.

---

## 6. DOMAIN BOT BERSUMBER DOKUMEN (BOT)

**Keputusan arsitektur inti (P4):** RAG bersumber dokumen resmi, bukan pengetahuan umum. Aturan penjaga **tidak boleh** jadi sakelar dashboard (CMS-04).

**Desain:**
- **BOT-01** — Tabel `dokumen_peraturan`: tiap layanan maks **2–3** dokumen resmi (batas **jangan diperlonggar**). Kolom metadata: `nomor`, `tahun`, `judul`, `status` (`berlaku`|`dicabut`), `tanggal_berlaku`, `layanan_id`, `diunggah_oleh`.
- **BOT-02** — Olah dokumen **SEKALI saat unggah**: potong + embed satu kali; saat bertanya hanya cari potongan relevan (murah) lalu kirim potongan itu ke Gemini.
- **BOT-03** — **Potong per pasal/ayat** (struktur hukum), bukan per karakter.
- **BOT-04** — Tabel `dokumen_potongan`: setiap potongan menyimpan `dokumen_id`, `pasal`, `ayat`, `halaman`, `teks`, `embedding vector(768)`, + metadata kutipan (nomor, tahun, judul dari induk).
- **BOT-05** — **3 aturan main:** (1) hanya menjawab dari potongan yang ditemukan — kalau tidak ada, katakan tidak tahu + tawarkan petugas; (2) **mengutip, tidak menafsirkan**; (3) **tidak boleh mengutip dokumen berstatus `dicabut`** (filter di `match_*`). Aturan ini dikunci dari dashboard (CMS-04).
- **BOT-06** — Penanda jenis jawaban ke warga: **"Informasi resmi"** (bersumber dokumen/FAQ, sumber ditampilkan) vs **"Informasi umum, mohon dikonfirmasi ke petugas"** (tidak ditemukan sumber). Tambah kolom `jenis_jawaban` pada pesan bot.
- **BOT-07** — 3 bentuk masukan: **tempel teks (jalur utama, paling andal)**; **PDF digital** (ekstraksi + **pratinjau untuk dikoreksi petugas sebelum aktif**); **tautan JDIH/situs resmi hanya sebagai rujukan tampilan** (bot **TIDAK** membaca situs luar saat menjawab).
- **BOT-08** — (SUDAH) **TIDAK perlu OCR.** Tolak PDF pindaian dengan pesan jelas.
- **BOT-09** — Petugas unggah dokumen **langsung aktif** dengan 6 pengaman: metadata wajib lengkap sebelum aktif; sumber selalu ditampilkan; petugas hanya dokumen layanannya (cocok `get_my_layanan_id()`); pengingat tinjau ulang 6–12 bulan; daftar dokumen terbaru untuk Admin; batas jumlah & ukuran dokumen per layanan.
- **BOT-10** — FAQ petugas **langsung aktif** dengan 4 pengaman: nama penulis+tanggal; daftar "FAQ terbaru diubah" untuk Admin; riwayat versi (bisa dikembalikan); **re-embed saat diubah** (BOT-11).
- **BOT-11** — **Perbaiki bug embedding basi:** tandai FAQ/potongan `perlu_embed_ulang=true` saat teks berubah (set `embedding=NULL` atau kolom penanda), dan jalankan pembaruan lewat **pg_cron** (bukan hanya tombol manual Admin). Ubah endpoint embed agar memproses yang `embedding IS NULL OR perlu_embed_ulang`. Tambah kolom `embedding_updated_at`.
- **BOT-12** — Pertanyaan tanpa jawaban (dari `chat_ai_log` dengan `eskalasi`/`reason`) dikumpulkan menjadi **daftar usulan FAQ** untuk petugas layanan terkait.
- **BOT-13** — **Kualitas terukur:** golden dataset (kumpulan pertanyaan+jawaban benar) + tombol umpan balik (membantu/tidak) pada setiap jawaban bot. Uji ambang `match_faq` 0.7.
- **BOT-14** — **Perbaiki mismatch dimensi lebih dulu:** samakan `GEMINI_EMBEDDING_MODEL` dengan dimensi kolom (768 → `text-embedding-004`, atau migrasi kolom ke 3072 + **embed ulang total**). Peningkatan model embedding = **WP tersendiri** dengan embed ulang seluruh data + verifikasi (embedding dari model berbeda tidak bisa dibandingkan).

---

## 7. DOMAIN PENGADUAN (CMP) — kewajiban hukum UU 25/2009

**Desain:**
- **CMP-01** — Tabel `pengaduan`: `nomor_tiket` (acak, tak berurutan), `jalur` (`layanan`|`integritas`), `isi`, `kontak`, `layanan_id` (opsional), `status`, `batas_verifikasi`, `batas_penanganan`, `anonim boolean`. SLA: verifikasi **3 hari kerja**, penanganan **14 hari kerja** (CMP-03) — penghitung otomatis + penanda warna mendekati batas.
- **CMP-02** — **FO menerima & meneruskan** pengaduan ke layanan terkait (konsisten P1).
- **CMP-03** — "Hari kerja" memperhitungkan Sabtu, Minggu, libur nasional → butuh **tabel hari libur** (bisa berbagi `jadwal_pengecualian`).
- **CMP-04** — **Eskalasi otomatis** saat batas terlampaui → naik ke Admin/pimpinan (bukan mengingatkan pelaksana lagi).
- **CMP-05** — **Pelacakan tanpa login:** nomor tiket **acak tak berurutan** + kombinasi kontak + rate limit.
- **CMP-06** — **DUA jalur terpisah:** (A) pengaduan layanan → boleh diteruskan ke layanan; (B) pengaduan **perilaku/integritas/pungli** → **HANYA Admin & pimpinan, TIDAK PERNAH ke petugas mana pun termasuk FO**, izinkan **anonim** dengan token pelacakan. RLS jalur B **sangat ketat, wajib diuji perilaku** (I-15, SEC-04).
- **CMP-07** — Lampiran bukti → bucket **privat** `pengaduan-bukti` (JANGAN `umkm-photos`).
- **CMP-08** — Tombol **"jadikan pengaduan"** dari dalam chat (warga/petugas) tanpa mengulang cerita.
- **CMP-09** — Halaman publik **Standar Pelayanan & Maklumat Pelayanan** per layanan (persyaratan, prosedur, jangka waktu, biaya, produk, penanganan pengaduan). Isi sekaligus jadi **bahan pengetahuan bot** (satu pekerjaan, dua manfaat).

---

## 8. DOMAIN BUKU TAMU (GST)

**Desain:**
- **GST-01** — Tabel `buku_tamu` **terpisah total** dari antrean. Migrasikan `visit.tujuan='bertemu_seseorang'` ke sini (data-live: 0 baris — migrasi mudah). Tamu **tidak** masuk antrean, **tidak** dapat nomor, **tidak** dihitung rekap kunjungan layanan (I-10).
- **GST-02** — Field: `nama`, `asal` (instansi/daerah), `no_hp`, `menemui_siapa`, `keperluan`, `waktu_masuk`, `tanda_tangan_svg`.
- **GST-03** — Tanda tangan disimpan sebagai **SVG path (text)**, BUKAN PNG (40–50× lebih kecil). Data pribadi → **bukan bucket publik**, ikut retensi, hanya FO & Admin yang melihat.
- **GST-04** — Fitur **FO** di meja depan, dirancang untuk **sentuh & cepat** (tablet), bukan formulir panjang.

---

## 9. DOMAIN MATCHMAKING UMKM (MMK)

**Desain:**
- **MMK-01** — Pengusul: pengunjung login **dan** petugas, **keduanya lewat review** petugas Matchmaking.
- **MMK-02** — **Verifikasi 3 lapis:** (1) kelengkapan & kepantasan isi, (2) legalitas (NIB/NPWP), (3) kontak aktif.
- **MMK-03** — Tambah status `perlu_perbaikan` + kolom `catatan_review` (OPS-08: perbarui pemetaan status di TS).
- **MMK-04** — Tambah `nib`, `npwp`, `nama_badan_usaha`, `berkas_legalitas_path`. Bucket **privat baru** `umkm-legalitas` (JANGAN di `umkm-photos` yang publik). Ke publik **hanya** lencana **"Legalitas terverifikasi"** — **JANGAN tampilkan NIB/NPWP** (I-11).
- **MMK-05** — Tabel `umkm_verifikasi_jejak`: siapa memeriksa apa, kapan, dengan cara apa.
- **MMK-06** — Verifikasi kontak: email otomatis (magic-link, sudah ada fondasi), telepon manual **tercatat**. **Jangan tayangkan listing yang kontaknya belum terverifikasi** (I-12).
- **MMK-07** — **Perbaiki expired yang tak pernah terjadi:** tambah `berlaku_sampai date` (6 bulan), pengingat **2 minggu** sebelum berakhir, pg_cron mengubah status → `expired` saat lewat (I-13).
- **MMK-08** — Perubahan pasca-tayang pada **field kritikal** (nama usaha, kontak, kategori, legalitas) → kembali `pending_review`; perubahan minor (deskripsi, foto tambahan) → langsung berlaku. Pakai `snapshot_approved` untuk deteksi perubahan.
- **MMK-09** — **Klausul penafian publik** di halaman matchmaking: DPMPTSP memfasilitasi pertemuan, **tidak menjamin** kualitas/harga/keberhasilan, **bukan pihak** dalam perjanjian.

---

## 10. DOMAIN INVESTMENT GALLERY & PETA POTENSI (INV)

**Desain:**
- **INV-01** — Peta potensi: **cukup login** (fondasi `ProfileCompletenessGate` sudah meminta kelengkapan saat login pertama).
- **INV-02** — Gerbang login = **kontrol atribusi**: tabel `jejak_minat_investasi` mencatat penayangan peta, sektor yang dilihat, dokumen yang dibuka → sambungkan ke `investasi_lead`.
- **INV-03** — Gerbang profil **RINGAN**: hanya nama, instansi/perusahaan, bidang minat (JANGAN tambah field). Audit `ProfileCompletenessGate.tsx` (~13.7KB) agar tidak kelebihan field.
- **INV-04** — **Perbaiki watermark sesuai keputusan:** pengguna **login** → sisipkan **nama + email**; **anonim** → sisipkan **waktu + penanda sesi**. Watermark **dibakar ke gambar di server saat permintaan** (sudah via sharp — tinggal ubah isi teksnya). **JANGAN** overlay CSS.
- **INV-05** — (Pedoman) Jangan bangun lapisan kerumitan yang menciptakan **ilusi perlindungan**; dokumen yang benar-benar rahasia tidak boleh di jalur publik sama sekali.
- **INV-06** — **Ungkapkan pencatatan perilaku** di kebijakan privasi + catat di `consent_log`.

---

## 11. DOMAIN LAYAR TV (DSP)

**Desain:**
- **DSP-01** — Grid semua loket: nama loket, **nomor yang sedang dilayani (SANGAT BESAR)**, sisa antrean (kecil), running text di bawah. Nomor terbaca dari **5 meter**.
- **DSP-02** — **Ketahanan koneksi:** penyambungan ulang otomatis, **polling cadangan** jika realtime gagal terus, **penanda "diperbarui 14:32"** selalu terlihat (layar diam data lama lebih berbahaya dari layar kosong).
- **DSP-03** — **Tahan menyala berhari-hari:** reload berkala (cegah bocor memori), sembunyikan kursor, mode layar penuh, cegah layar tidur.
- **DSP-04** — Loket tutup ditampilkan **JELAS**: "Tidak melayani hari ini" + "Jadwal: Senin" (pakai `jadwal_berikutnya()`).
- **DSP-05** — Running text **dikelola Admin** dari dashboard (tanpa ubah kode).
- **DSP-06** — **JANGAN tampilkan nama warga, hanya nomor.** Buat **view/endpoint khusus layar** yang **secara struktural tidak memuat kolom nama** (I-14) — jangan mengandalkan frontend yang "tidak menampilkannya".
- **DSP-07** — **URL layar bertoken** (tabel `layar_token`): token hanya memberi akses **baca data antrean minimal** (DSP-06), tidak ke yang lain. Ganti akses publik polos saat ini.
- **DSP-08** — (TUNDA) Suara panggilan belum diputuskan. **Rancang pemanggilan (QUE-17) agar menerbitkan peristiwa `nomor_dipanggil`** agar suara bisa ditambahkan nanti tanpa perubahan struktural.

---

## 12. DOMAIN REKAP & LAPORAN (RPT)

**Desain:**
- **RPT-01** — **Satu lapisan metrik** (fungsi perhitungan terpusat) + **empat penyaji** (PDF berkop, Excel/CSV, dashboard grafik, email bulanan). **JANGAN** empat perhitungan terpisah (I-24).
- **RPT-02** — Empat konsumen: FO harian (dashboard), pimpinan (email bulanan + PDF), penilai eksternal (PDF berkop bernomor), tiap layanan (dashboard terbatas layanannya).
- **RPT-03** — **Dokumen definisi metrik tunggal:** tegaskan tiga angka berbeda — pengunjung (orang), kunjungan (kedatangan), tiket/layanan (QUE-01).
- **RPT-04** — **Snapshot PDF resmi** (`laporan_snapshot`): nomor laporan, periode, waktu cetak, pencetak; **isi dibekukan** (bisa ditelusuri, angka tak berubah saat dicetak ulang).
- **RPT-05** — **Rollup harian** ke `rekap_harian_layanan` (per layanan per tanggal); rekap rentang panjang dari agregat, bukan data mentah.
- **RPT-06** — **Ekspor ber-PII dibatasi & dicatat:** petugas hanya layanannya; **setiap ekspor** menghasilkan 1 baris `audit_log` (siapa, kapan, rentang, jumlah baris) (I-20).
- **RPT-07** — **PERBAIKI bug zona waktu:** ganti seluruh `new Date().toISOString().split('T')[0]` untuk batas hari menjadi **Asia/Jakarta** (helper `todayWIB()` di server & klien). Cakup penomoran, reset harian, `no_show`, alpa, rollup, cron (I-21).
- **RPT-08** — Rekap kustom rentang tanggal untuk kunjungan, buku tamu, survei.

---

## 13. DOMAIN SURVEI (SRV) — DITUNDA, JANGAN DIRUSAK

- **SRV-01** — Fitur survei **ditunda** (SKM/SPAK/ulasan).
- **SRV-02** — **JANGAN** tambah survei berpola `u1..u9`. Arah benar: mesin survei generik **di samping** SKM, migrasikan SKM nanti.
- **SRV-03** — **Boleh dikerjakan sekarang (murah):** catat **response rate SKM** (berapa dilayani vs berapa mengisi) — data **tidak bisa dibuat surut**.
- **SRV-04** — Google Maps: tombol "beri ulasan" + input manual bulanan. **JANGAN** pakai Google Places API (berbayar + melarang simpan ulang ulasan).

---

## 14. DOMAIN PERAN & AKSES (RBA)

**Desain:**
- **RBA-01** — Lima peran dipertahankan: `admin`, `front_office` (baru), `petugas` (layanan), `pengunjung` (login), `pengunjung anonim`. Penegasan: tidak ada peran ke-6; peran "hanya lihat" untuk pimpinan bisa ditambah nanti bila ZI menuntut (RBA-09).
- **RBA-02** — Tambah nilai `front_office` ke `petugas.role`. Menyentuh `get_my_role()`, `set_user_role_claim()`, `canAccessAdminPath()`, `ADMIN_NAV`, `AdminGuard.tsx`, **seluruh RLS** → **WP tersendiri** (OPS-08).
- **RBA-03** — (SUDAH) Satu petugas satu layanan (`layanan_id` tunggal). **JANGAN** banyak-ke-banyak.
- **RBA-04** — Loket bebas **tanpa penguncian sesi**; cukup kunci baris tiket (QUE-07) + `dilayani_oleh`.
- **RBA-05** — (SUDAH) Pembuatan akun **hanya Admin**.
- **RBA-06** — Tambah `petugas.aktif boolean DEFAULT true`, `nonaktif_sejak timestamptz NULL`, `nonaktif_oleh uuid`, `nonaktif_alasan text`. **Jangan hapus baris** — riwayat harus utuh (I-22).
- **RBA-07** — **Keputusan klarifikasi pengguna: satu layanan satu akun; saat PIC ganti, akun TIDAK ganti — cukup reset password oleh Admin.** Pengaman wajib: (1) tindakan resmi di dashboard Admin (bukan edit field satu-satu) yang memutus tautan Google lama, mengirim undangan/reset ke pemegang baru, dan **mengakhiri seluruh sesi pemegang lama** (I-23); (2) audit log = garis waktu pemegang akun; (3) laporan menyebut **nama layanan, bukan orang** (NOT-07); (4) email notifikasi **institusional** (NOT-01). `AGENTS.md` perlu diselaraskan agar tidak kontradiksi (BT-06).
- **RBA-08** — FO boleh **menonaktifkan** akun (satu arah; **tidak bisa mengaktifkan kembali**), **wajib alasan**, **Admin diberi tahu**.
- **RBA-09** — **Tidak ada peran pimpinan khusus**; pimpinan pakai **akun Admin tersendiri** (JANGAN berbagi akun). Peran "hanya lihat" bisa ditambah nanti bila ZI menuntut.
- **RBA-10** — Petugas hanya rekap layanannya (sudah via `get_my_layanan_id()`); **FO butuh pandangan lintas-layanan** (antrean, chat, absensi, rekap).
- **RBA-11** — Anonim **tidak boleh** lihat peta potensi; UMKM & galeri boleh anonim.

---

## 15. DOMAIN KONTEN & PENGATURAN (CMS)

**Desain:**
- **CMS-01** — Admin boleh mengubah bebas: daftar layanan, jam, jadwal standby, nomor loket, teks/gambar halaman utama, pengumuman, running text, menu & urutan layanan, perilaku bot (sapaan, jam aktif), postingan/galeri, teks penolakan (P3), batas ambil nomor per layanan (QUE-10), isi email, dan aturan lain yang tidak masuk CMS-04.
- **CMS-02** — Publikasi **langsung tayang** (tanpa alur persetujuan).
- **CMS-03** — **Riwayat versi + tombol kembalikan** (tabel `konten_versi`) sebagai **syarat** CMS-02.
- **CMS-04** — **EMPAT kelompok yang TIDAK boleh diubah dari dashboard:** (1) aturan penjaga bot, (2) ambang rate limit, (3) masa simpan & penghapusan data pribadi, (4) definisi peran & hak akses. Ditegakkan **secara struktural**, bukan kesepakatan.
- **CMS-05** — **Registry pengaturan bertipe** di atas `site_settings`: tambah `tipe_nilai`, `boleh_diubah_dashboard boolean`, `aturan_validasi`. Penanda `boleh_diubah_dashboard=false` menegakkan CMS-04 (I-19).

---

## 16. DOMAIN KEAMANAN & KUALITAS (SEC)

- **SEC-01** — Tegakkan CSP dari `Report-Only` → `Content-Security-Policy` setelah pelanggaran dibersihkan.
- **SEC-02** — Tutup bypass `check_anon_rate()` untuk walk-in, `umkm_inquiry`, `investasi_lead` (chat sudah dimitigasi CHT-10).
- **SEC-03** — **Pasang error tracking + alerting + SLO** (prasyarat OPS-06 sebelum menyentuh antrean).
- **SEC-04** — **Tes RLS berbasis perilaku** per-peran dengan token nyata (fondasi semua kerja RBAC & CMP-06).
- **SEC-05/INV-04** — Tutup kebocoran dokumen IPRO sepenuhnya (identitas watermark).
- **SEC-06/OPS-07** — Pecah halaman monolitik **sambil jalan** (bukan proyek terpisah).
- **SEC-07** — Pertimbangkan lapisan data (TanStack Query/SWR) — catat sebagai keputusan terpisah dengan alasan/ukuran/alternatif (aturan 0.2 #10, jangan tambah dependensi sembarangan).
- **SEC-08** — (→ BOT-11) Pipeline re-embedding FAQ diperbaiki di domain BOT.
- **SEC-09** — (→ BOT-13) Golden dataset & umpan balik RAG di domain BOT.
- **SEC-10** — (→ BOT-14) Pembaruan model AI & perbaikan mismatch dimensi di domain BOT.
- **SEC-11** — Evaluasi latensi cron `*/2` (2 menit) untuk notifikasi.
- **SEC-12** — (SUDAH) Refresh MV sudah `CONCURRENTLY`.
- **SEC-14** — Lengkapi DSAR/DPIA/retensi; **cegah PII masuk `audit_log.detail`** (sanitasi seperti `logServerEvent`).
- **SEC-15** — Lengkapi pelaporan SKM PermenPANRB (mutu A–D + response rate, lihat SRV-03).
- **SEC-13, SEC-16, SEC-17, SEC-18** — (TUNDA) WhatsApp, E2E, hash-chain audit log, pemecahan PRD.

---

## 17. PROTOKOL OPERASI (OPS) — diterapkan di semua WP

- **OPS-01** — Migrasi **aditif 4 langkah** (TAMBAH → ISI/dual-write → PINDAH → HENTIKAN setelah ≥2 minggu stabil + persetujuan). **Jangan gabung langkah 1 & 3.**
- **OPS-02** — Pemecahan `visit` = **WP tersendiri paling berisiko**, urutan wajib: buat `kunjungan`+`tiket_antrean` (kosong) → backfill (`tujuan='loket'`→1 kunjungan+1 tiket; `tujuan='bertemu_seseorang'`→`buku_tamu`) → **verifikasi `COUNT(visit)=COUNT(tiket)+COUNT(buku_tamu)`** → dual write → pindah baca per halaman mulai dari yang **paling jarang dipakai** → `/checkin` & dashboard antrean **terakhir**.
- **OPS-03** — Penerapan berisiko **di luar jam pelayanan**, hindari hari dengan banyak jadwal P4.
- **OPS-04** — Setiap WP punya **rencana pengembalian teruji** (migrasi aditif = bisa diabaikan, bukan destruktif).
- **OPS-05** — **Prosedur cadangan manual FO** (nomor cetak/tulis, formulir buku tamu kertas, cara input kemudian) **sebelum** menyentuh alur antrean.
- **OPS-06** — **Observability (SEC-03) selesai SEBELUM** WP yang menyentuh antrean.
- **OPS-07** — Pemecahan halaman besar **sambil jalan**.
- **OPS-08** — Setiap penambahan nilai enum (`tidak_terlayani`, `perlu_perbaikan`, `front_office`, `alpa`, `coming_soon`) → **cari semua pemetaan ekshaustif di TS** (label UI, warna badge, filter, agregasi rekap).

---

## 18. KETERKAITAN LINTAS DOMAIN (dependensi kritis)

```
RBA-02 (front_office) ─┬─> SCH-06, SCH-08, CHT-08, GST-04, CMP-02, RBA-08, RBA-10
SEC-03 (observability) ──> OPS-06 ──> semua WP yang menyentuh antrean (QUE-*, OPS-02)
RPT-07 (zona waktu) ──> QUE-15, SCH-05, SCH-10, RPT-05, SVC-05
SCH-01/SCH-04 (jadwal) ──> SCH-02, SCH-05, QUE-05, DSP-04, CHT-04
QUE-01 (kunjungan+tiket) ──> QUE-02..17, GST-01, RPT-01, DSP-01, I-01..I-03
NOT-01 (layanan_kontak) ──> NOT-04, SCH-10, SVC-06, RBA-07
QUE-06 (nomor atomik) ──> QUE-17, DSP-01, DSP-06, SVC-05
BOT-01..04 (dokumen) ──> BOT-05..09, CMP-09 (bahan pengetahuan)
```

**BERHENTI DI SINI.** Menunggu persetujuan manusia sebelum melanjutkan ke **Fase D (Rencana implementasi)**.
