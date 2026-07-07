# PRD: Sistem Digital Lampung Maju Hub

> Working document — breakdown poin teknis, bukan naratif formal. Konteks: DPMPTSP Provinsi Lampung. Stack: Supabase + Vercel.

---

## 1. Latar Belakang

Proposal resmi "Lampung Maju Hub" menggambarkan hub fisik+digital yang menyatukan 5 layanan di kantor DPMPTSP (P4): Helpdesk OSS, Sertifikasi Halal, CS BPJS Kesehatan, Matchmaking UMKM, dan Investment Gallery.

Scope sistem ini **diskalakan ke bagian yang bisa dibangun sendiri oleh DPMPTSP**, tanpa bergantung pada integrasi teknis ke sistem instansi lain (OSS nasional, BPJS, Kemenag, dll).

**Pembagian fundamental yang menentukan seluruh arsitektur:** 5 layanan di atas terbagi jadi dua kelompok dengan karakter yang sangat berbeda, bukan satu model yang seragam.

---

## 2. Ruang Lingkup

### 2.1 Kelompok Layanan Konsultatif
*Helpdesk OSS, Sertifikasi Halal, CS BPJS Kesehatan*

Karakter: pengunjung datang fisik ke kantor → ketemu petugas → dilayani → selesai. Menggunakan model **check-in + live chat**.

### 2.2 Kelompok Halaman Publik Independen
*Matchmaking UMKM, Investment Gallery*

Karakter: **konten yang diakses publik lewat website, dari mana saja, kapan saja** — tidak ada interaksi "dilayani petugas", tidak terhubung ke check-in/kunjungan sama sekali. Ini bukan "layanan yang di-check-in", tapi halaman marketplace/galeri yang berdiri sendiri.

> ⚠️ Koreksi penting dari draf sebelumnya: kedua fitur ini **tidak masuk** dropdown "layanan tujuan" saat check-in Buku Tamu. Tidak ada skenario realistis di mana orang datang ke kantor khusus untuk check-in demi mengakses sesuatu yang sudah publik di internet.

### 2.3 Layanan CS Online
Live chat + chatbot FAQ, **khusus website** — tidak ada integrasi WhatsApp Business (hambatan administratif: verifikasi bisnis, BSP pihak ketiga, biaya tidak sepadan untuk versi awal).

---

## 3. Breakdown per Fase

### Fase 1 — Check-in Digital & Dashboard Analitik
**In scope:**
- Form check-in digital (pengganti Buku Tamu): nama, keperluan, layanan tujuan — dropdown **hanya 3 layanan konsultatif**
- Tabel `kunjungan`, status `menunggu` → `selesai`
- Dashboard analitik: volume kunjungan, jam ramai, breakdown per layanan
- Absensi digital instansi mitra (pengganti Buku P4) — berlaku di semua fase

**Eksplisit di luar scope:** integrasi nyata ke sistem OSS/BPJS/halal; Matchmaking UMKM & Investment Gallery (lihat 2.2 — tidak pakai model ini).

### Fase 2 — Log FIFO Helpdesk OSS
**In scope:** log urutan kedatangan khusus Helpdesk OSS (satu-satunya yang kadang ada antre), untuk data historis dashboard.

**Eksplisit di luar scope:** sistem tiket nomor cetak, layar TV panggilan nomor. **Tidak dibutuhkan** — di lapangan hampir semua layanan minim antre, pengunjung langsung ke counter. Log ini murni untuk data, bukan alat operasional panggil-nomor.

### Fase 3 — Live Chat & Chatbot FAQ
**In scope:**
- Widget chat dengan selector layanan (3 layanan konsultatif)
- Chatbot dengan knowledge base aktif **khusus Helpdesk OSS** di awal (konten dikuasai penuh DPMPTSP)
- Layanan mitra lain tetap muncul sebagai pilihan, tapi fallback otomatis ke live chat manusia sampai instansi terkait submit konten FAQ
- Live chat semi-real-time (bisa telat, chat masuk antrian tanpa batas waktu)
- Kontak pengunjung (HP/email) **opsional** untuk follow up manual kalau jawaban telat

**Eksplisit di luar scope:** integrasi WhatsApp Business; chatbot bebas berimprovisasi tanpa knowledge base terkontrol.

### Fase 4 — Modul Publik Independen (lepas dari kunjungan)

**Matchmaking UMKM** (marketplace kebutuhan):
- Listing: nama UMKM/PT, kategori kebutuhan, deskripsi/artikel, foto produk, kontak
- Model input: **staff DPMPTSP input awal → UMKM bisa edit sendiri via edit-token** (bukan akun formal)
- Edit oleh UMKM masuk status `pending_review` — versi lama tetap tayang sampai staff approve (mencegah listing diubah jadi konten bermasalah tanpa moderasi)
- Kontak ditampilkan sebagai tombol aksi (mis. `wa.me/`), **bukan teks polos** — mencegah scraping otomatis oleh bot spam, karena halaman ini publik dan terbuka ke seluruh internet

**Investment Gallery** (viewer PDF terkunci):
- Tampilan PDF view-only, publik, tanpa perlu identitas pengunjung
- Level proteksi: **deterrence ringan** — disable klik kanan/print, PDF tidak pernah accessible sebagai file mentah (private bucket, signed URL, dirender sebagai gambar per halaman)
- Batasan yang diterima secara sadar: screenshot/screen recording tetap selalu bisa dilakukan siapa pun — ini bukan kegagalan desain, tapi batas fundamental dari "menampilkan sesuatu ke layar". Karena tidak ada watermark/identitas, kebocoran (bila terjadi) **tidak bisa dilacak sumbernya**.

---

## 4. Aktor & Peran

| Aktor | Detail akses |
|---|---|
| **Pengunjung fisik** | Isi check-in saat datang, tanpa akun. Hanya relevan untuk 3 layanan konsultatif. |
| **Pengunjung online** | Akses chat via website tanpa akun (Supabase Anonymous Sign-In — belum diimplementasi) |
| **Pengunjung publik umum** | Browse Matchmaking UMKM & Investment Gallery dari mana saja, tanpa akun, tanpa identitas |
| **Petugas DPMPTSP** | Akun individual, terikat ke satu `layanan_id` (3 layanan konsultatif), akses dibatasi ke loketnya sendiri |
| **Petugas instansi mitra P4** | Akun shared per-instansi (bergantian siapa piket). Akuntabilitas di level instansi, nama piket dicatat di field teks bebas |
| **UMKM (pemilik listing)** | **Bukan akun formal** — akses edit terbatas via edit-token unik per listing, divalidasi server-side (lihat ARCHITECTURE.md). Perubahan masuk `pending_review`, butuh approval staff. |
| **Admin/Pimpinan** | Akses lintas semua layanan & modul, read-access penuh dashboard analitik. *Jumlah akun admin belum diputuskan — tidak mengubah desain teknis, hanya provisioning.* |

---

## 5. Metrik Keberhasilan

**Layanan konsultatif:**
- % kunjungan tercatat digital vs estimasi manual sebelumnya
- Rata-rata waktu tunggu per layanan (baseline vs setelah live)
- Rata-rata waktu respons live chat, % terjawab bot vs eskalasi manusia, % chat telat dijawab

**Matchmaking UMKM:**
- Jumlah listing aktif, listing baru per bulan
- (Opsional) jumlah klik tombol kontak

**Investment Gallery:**
- Jumlah dokumen aktif
- (Opsional) page view via analytics dasar (Vercel Analytics/GA — page view count saja, tidak konflik dengan keputusan "tanpa identitas")

---

## 6. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Akun shared instansi mitra → akuntabilitas individu lemah | Sulit lacak penanggung jawab jawaban tertentu | Field nama bebas teks saat absen + log timestamp per sesi |
| Chatbot salah info soal syarat OSS/NIB | Dampak hukum/administratif ke pemohon | Threshold eskalasi konservatif, jawaban bot tercatat sumber KB untuk audit |
| Ketergantungan konten FAQ instansi eksternal | Fitur chatbot mitra tertunda tanpa batas | Fallback ke live chat manusia (sudah didesain) |
| Resistensi staf pakai sistem baru | Data check-in/absensi tidak konsisten | SOP + sosialisasi (di luar scope teknis) |
| Insert publik tanpa login rawan spam/abuse | Data sampah, DoS ringan | Rate limiting sesi anonim |
| **Edit-token UMKM bocor/ditebak** (risiko naik karena publik ke seluruh internet) | Listing diubah pihak tidak berwenang | Validasi server-side via Edge Function, bukan RLS murni — wajib ada sebelum fitur live |
| **Screenshot/rekam layar Investment Gallery** | Dokumen bisa bocor tanpa jejak pelacakan | Diterima sebagai batasan sadar (bukan kegagalan sistem) — dokumentasikan di Batasan & Asumsi |

---

## 7. Batasan & Asumsi

- Check-in mengasumsikan perangkat disediakan kantor (tablet/kios) — perlu dikonfirmasi, termasuk fallback kalau internet kantor drop (mode manual/offline-first belum didesain)
- Perlu fallback dibantu petugas untuk pengunjung yang kurang familiar dengan form digital
- Investment Gallery: risiko screenshot/rekam layar diterima secara sadar sebagai batasan teknis, bukan kegagalan yang harus "diperbaiki"
- Kebijakan retensi data pribadi (nama, kontak, isi chat) sesuai UU PDP No. 27/2022 **belum ditentukan** — berpotensi berbenturan dengan kewajiban arsip instansi pemerintah (UU No. 43/2009), perlu koordinasi dengan bagian arsip/hukum internal, bukan diputuskan sepihak secara teknis

---

## 8. Privasi & Kepatuhan Data

Dua kelas data dengan risiko privasi berbeda — jangan diperlakukan sama:

1. **Data kunjungan/chat pengunjung fisik** (nama, keperluan, kontak untuk follow up) — data personal untuk urusan administratif, retensi minimal, butuh consent eksplisit.
2. **Kontak UMKM di listing** — kontak bisnis untuk tujuan promosi, UMKM memang ingin dihubungi. Risiko lebih rendah, tapi tetap butuh consent eksplisit saat submit bahwa kontak akan ditampilkan publik, dan ditampilkan via tombol aksi (bukan teks polos) untuk mencegah scraping.

RLS untuk insert publik (kunjungan, chat_sesi) direkomendasikan pakai Supabase Anonymous Sign-In, bukan policy insert terbuka bebas — **belum diimplementasikan**.

---

## 9. Item yang Masih Terbuka

| Item | Catatan |
|---|---|
| Jumlah akun admin | Tidak mengubah desain teknis, hanya provisioning |
| Durasi retensi data personal | Perlu koordinasi bagian arsip/hukum, bukan keputusan teknis sepihak |
| Mekanisme expiry listing UMKM | Cron otomatis vs manual staff/UMKM tandai "kebutuhan terpenuhi" — belum diputuskan |
| Pengelola konten Investment Gallery | Asumsi: Admin. Perlu dikonfirmasi. |
| Insight Buku P4 → auto-expectation di widget chat | Ide belum diputuskan, sekadar catatan potensi fitur lanjutan |

---

## 10. File Terkait
- `ARCHITECTURE.md` — desain teknis, model data, strategi RLS & Edge Function
- `supabase/migrations/` — skema database sebagai migration files bertahap
