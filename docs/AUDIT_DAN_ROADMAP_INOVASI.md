# Audit Menyeluruh & Roadmap Inovasi — Lampung Maju Hub

> Dokumen strategis-teknis untuk DPMPTSP Provinsi Lampung.
> Menyatukan hasil audit sistem nyata (kode + database) dengan rencana inovasi produk.
> Menjadi acuan tunggal (single source of truth) menggantikan docs/archive/PRD.md & docs/archive/ARCHITECTURE.md yang sudah tertinggal (diarsipkan 2026-07-20).

| | |
|---|---|
| **Versi** | 1.0 |
| **Tanggal** | 10 Juli 2026 |
| **Status** | Draft untuk ditinjau pimpinan |
| **Penyusun** | Audit System Analyst |
| **Lingkup** | Seluruh proyek: `src/`, `supabase/migrations/` (001–019), dokumentasi |
| **Dokumen digantikan** | `docs/archive/PRD.md`, `docs/archive/ARCHITECTURE.md` (arsip historis) |

---

## Daftar Isi

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Metodologi & Ruang Lingkup](#2-metodologi--ruang-lingkup)
3. [Peta Sistem Nyata](#3-peta-sistem-nyata)
4. [Kesenjangan Dokumen vs Implementasi](#4-kesenjangan-dokumen-vs-implementasi)
5. [Temuan Audit](#5-temuan-audit)
6. [Rencana Inovasi](#6-rencana-inovasi)
7. [Skema Data Usulan](#7-skema-data-usulan)
8. [Roadmap & Prioritas](#8-roadmap--prioritas)
9. [Metrik Keberhasilan Baru](#9-metrik-keberhasilan-baru)
10. [Lampiran](#10-lampiran)

---

## 1. Ringkasan Eksekutif

Lampung Maju Hub (LMH) telah berkembang jauh melampaui visi awalnya. Dari rencana "check-in digital sederhana untuk 5 layanan", sistem nyata kini menjadi **portal layanan berbasis akun** dengan 9 layanan, reservasi online + QR, live chat, modul UMKM, Investment Gallery, dan CMS landing page.

Pertumbuhan itu positif — tetapi **keamanan dan tata kelola tidak ikut naik kelas**. Audit ini menemukan:

- **5 temuan keamanan kritis** yang membuat sistem belum layak dibuka penuh ke publik. Yang paling serius: dokumen investasi bisa diunduh mentah tanpa login (K1), dan seluruh isi chat warga bisa dibaca siapa pun (K2).
- **5 temuan integritas data & proses bisnis**, terutama dua sistem kunjungan yang tidak terekonsiliasi dan taksonomi layanan yang runtuh.
- **Kesenjangan regulasi**: tidak ada Survei Kepuasan Masyarakat (SKM), padahal wajib bagi unit pelayanan publik.

Dokumen ini tidak berhenti di temuan. Bagian [Rencana Inovasi](#6-rencana-inovasi) memuat 9 inisiatif untuk mereposisi LMH dari "kumpulan fitur" menjadi portal pelayanan yang benar-benar membantu masyarakat, patuh regulasi, dan mendorong investasi daerah.

**Rekomendasi utama:** bekukan pembukaan publik penuh sampai temuan keamanan K1–K5 ditutup, lalu eksekusi roadmap berlapis mulai dari fondasi (Visit Spine + tata kelola data) hingga diferensiasi (Asisten AI, funnel investor).

---

## 2. Metodologi & Ruang Lingkup

Audit dilakukan dengan menelaah langsung artefak proyek, bukan hanya dokumentasi:

- **19 file migration** (`supabase/migrations/001`–`019`) — skema, RLS, seed, storage.
- **Lapisan auth** — `src/proxy.ts` (middleware), `src/lib/supabase/*`.
- **Endpoint API** — `src/app/api/investment-docs/*`.
- **Dokumentasi** — `PRD.md`, `ARCHITECTURE.md`, `AGENTS.md`, laporan SDD.

Setiap temuan diklasifikasi dengan tingkat keparahan:

| Kode | Tingkat | Arti |
|---|---|---|
| 🔴 Kritis | Blocker | Harus ditutup sebelum publik; risiko hukum/kebocoran data. |
| 🟠 Tinggi | Major | Merusak integritas data atau proses bisnis inti. |
| 🟡 Sedang | Minor | Kualitas teknis/UX; tidak memblokir tapi menumpuk utang teknis. |

---

## 3. Peta Sistem Nyata

### 3.1 Arsitektur aktual

- **Frontend/Hosting:** Next.js (App Router) di Vercel.
- **Backend:** Supabase (Postgres + Auth + Storage). **Belum ada Edge Function.**
- **Auth:** Google OAuth untuk pengunjung; email/password untuk petugas & admin. Middleware `proxy.ts` menjaga `/admin` dan `/me`.
- **Storage:** bucket privat `investment-docs`, bucket publik `umkm-photos`.

### 3.2 Inventaris layanan (9, tabel `layanan` datar)

Helpdesk OSS, Sertifikasi Halal, BPJS Kesehatan, Bank Lampung, Matchmaking UMKM, Investment Gallery, BALMON, Sertifikasi Mutu Keamanan Hasil Perikanan, Layanan Jasa Industri.

> Catatan: UMKM & Investment Gallery adalah **modul publik**, tetapi ikut dimasukkan sebagai baris `layanan` dan diberi akun `petugas`. Ini sumber kebingungan konseptual (lihat Temuan B2).

### 3.3 Model data aktual (ringkas)

| Domain | Tabel/View | Fungsi |
|---|---|---|
| Layanan & petugas | `layanan`, `petugas` | Master layanan + akun staf (role `petugas`/`admin`) |
| Kunjungan walk-in | `kunjungan` (+view `antrian_helpdesk`) | Buku tamu digital, status `menunggu`/`selesai` |
| Reservasi | `reservasi` | Booking online + `qr_token`, status `terjadwal`→`hadir`→`dilayani`→`selesai`/`batal` |
| Identitas warga | `pengunjung` | Profil Google OAuth (nama, email, foto, kategori) |
| Absensi | `kehadiran_layanan`, `absensi_petugas` | Buku P4 mitra + absensi mandiri petugas |
| Chat | `chat_sesi`, `chat_pesan`, `faq_knowledge_base` | Live chat + FAQ per layanan |
| UMKM | `listing_umkm` | Marketplace kebutuhan, edit-token, status `draft`→`published` |
| Investasi | `investment_documents` | Galeri dokumen PDF |
| CMS & config | `site_settings`, `landing_content` | Konten landing page + pengaturan global |

Detail skema usulan penyempurnaan ada di [Bagian 7](#7-skema-data-usulan).

---

## 4. Kesenjangan Dokumen vs Implementasi

PRD.md & ARCHITECTURE.md mendeskripsikan arsitektur yang **secara fundamental berbeda** dari sistem nyata. Ini cacat tata kelola: pembaca dokumen (auditor, pimpinan, developer baru, tim hukum) mendapat gambaran salah.

| Aspek | Dokumen (PRD/ARCH) | Sistem nyata (kode/migration) |
|---|---|---|
| Jumlah layanan | 5 layanan, `layanan` "hanya 3 baris tetap" | **9 layanan** (mig 011, 015) |
| Model kedatangan | Walk-in + check-in; sistem tiket/antre **ditolak** | **Reservasi + QR + scan** (mig 009) — persis appointment/ticketing |
| Identitas pengunjung | "tanpa akun"; online via Anonymous Sign-In | **Akun Google OAuth penuh** (mig 008) |
| Taksonomi | 2 kelompok: 3 konsultatif + 2 publik | Runtuh — 9 layanan campur dalam 1 tabel datar |
| Edit UMKM | **Wajib** via Edge Function | Edge Function **tidak ada** |
| Insert publik | Via Anonymous Sign-In (bukan policy terbuka) | Policy `WITH CHECK (true)` terbuka bebas |
| Investment Gallery | PDF dirender jadi gambar, tak pernah mentah | Pipeline gambar **tak dibangun**; PDF mentah bocor (K1) |

**Rekomendasi (terlaksana 2026-07-20):** PRD.md & ARCHITECTURE.md telah diarsipkan sebagai catatan historis di `docs/archive/`. Dokumen ini menjadi acuan tunggal ke depan, dengan changelog dan aturan "update dokumen = bagian dari definition of done setiap fase".

---

## 5. Temuan Audit

### 5.1 🔴 Keamanan Kritis

#### K1 — `public-view` membocorkan PDF mentah tanpa autentikasi
- **Lokasi:** `src/app/api/investment-docs/public-view/route.ts`
- **Masalah:** endpoint menerbitkan signed URL ke **file PDF asli** di bucket privat untuk siapa saja, tanpa cek login. Pipeline render per-halaman-jadi-gambar (`halaman_gambar`) tidak pernah dibangun (array kosong, `file_path` demo).
- **Dampak:** bukan "deterrence ringan" seperti didesain, tapi **eksfiltrasi file penuh** — siapa pun bisa mengunduh PDF utuh. Meruntuhkan total ARCHITECTURE §6.
- **Rekomendasi:** (a) hentikan penyajian PDF mentah; (b) bangun pipeline konversi PDF→gambar per halaman saat upload; (c) publik hanya menerima gambar per halaman via URL bertanda tangan singkat (≤60 detik) + watermark dinamis. Lihat Inovasi #6.

#### K2 — Seluruh isi chat warga dapat dibaca siapa saja (IDOR)
- **Lokasi:** migration 005 — `chat_sesi` & `chat_pesan` dengan `SELECT USING (true)`.
- **Masalah:** komentar "filter by id di client" bukan keamanan. Dengan anon key (ada di bundle browser), siapa pun bisa membaca **semua** sesi & pesan chat semua pengunjung.
- **Dampak:** kebocoran data pribadi (izin usaha, BPJS/kesehatan). Pelanggaran UU PDP No. 27/2022.
- **Rekomendasi:** ganti ke Anonymous Sign-In; policy SELECT dibatasi ke sesi milik `auth.uid()` sendiri; petugas hanya sesi layanannya. Lihat matriks RLS di Lampiran.

#### K3 — Insert publik terbuka bebas tanpa rate limit
- **Lokasi:** migration 003 & 005 — `kunjungan`, `chat_sesi`, `chat_pesan` = `WITH CHECK (true)`.
- **Masalah:** Anonymous Sign-In tak pernah diimplementasi; tak ada rate limiting.
- **Dampak:** spam/DoS ringan; database bisa dibanjiri data sampah.
- **Rekomendasi:** Supabase Anonymous Sign-In + rate limit per sesi anonim (mis. via Edge Function/pg policy berbasis waktu).

#### K4 — Password hardcode `password123` untuk akun pemerintah
- **Lokasi:** migration 013 & 015.
- **Masalah:** kredensial produksi (`oss@`, `banklampung@`, `balmon@`, dst) ditanam dengan `password123`, ter-commit ke git.
- **Dampak:** akun instansi mudah diambil alih.
- **Rekomendasi:** hapus kredensial dari migration; provisioning via undangan/reset paksa saat login pertama; rotasi semua password yang sudah bocor.

#### K5 — Edge Function edit-token UMKM (diwajibkan dokumen) tidak ada
- **Lokasi:** tidak ada `supabase/functions/`; `listing_umkm` tanpa policy UPDATE anon.
- **Masalah:** alur "UMKM edit sendiri via token" tidak berfungsi/aman.
- **Dampak:** fitur inti Fase 4 belum boleh live menurut aturan dokumen sendiri.
- **Rekomendasi:** bangun Edge Function validasi token server-side, atau ganti ke magic-link email (lebih aman). Lihat Inovasi #7.

### 5.2 🟠 Integritas Data & Proses Bisnis

| Kode | Temuan | Dampak | Rekomendasi |
|---|---|---|---|
| B1 | `kunjungan` (walk-in) & `reservasi` paralel, tak terekonsiliasi | Metrik volume kunjungan ambigu/ganda | Satukan jadi **Visit Spine** (Inovasi #1) |
| B2 | Taksonomi runtuh: UMKM/Gallery jadi baris `layanan` + punya `petugas` | Bug logika dropdown/selector; konsep tercampur | Tambah kolom `tipe` pada layanan; pisahkan modul publik |
| B3 | No-show reservasi tak ditangani | Status `terjadwal` menumpuk; metrik kotor | Auto-expiry + metrik no-show |
| B4 | Data placeholder masuk produksi (`wa_number` palsu, 9 dokumen investasi demo Unsplash) | Warga diarahkan ke kontak salah; konten palsu tayang | Pisahkan seed demo dari migration produksi |
| B5 | Model akun mitra tak konsisten (individual vs shared) | Akuntabilitas kabur | Putuskan satu model + dokumentasikan |

### 5.3 🟡 Arsitektur & Teknis

| Kode | Temuan | Rekomendasi |
|---|---|---|
| A1 | `proxy.ts` query DB `petugas.role` tiap request `/admin` | Pindah role ke custom JWT claims |
| A2 | Tidak ada tabel audit log | Bangun `audit_log` (wajib untuk sistem pemerintah) |
| A3 | "Chatbot" belum ada logika AI; FAQ statis | Asisten AI ber-RAG (Inovasi #4) |
| A4 | Signed URL berumur 1 jam untuk konten view-only | Perpendek ke ≤60 detik |

---

## 6. Rencana Inovasi

Sembilan inisiatif untuk mereposisi LMH dari "kumpulan fitur" menjadi portal pelayanan sejati. Tiap inisiatif memuat: masalah yang dijawab, solusi, dampak, dan sketsa teknis.

### Inovasi #1 — Unified Visit Spine (Tulang Punggung Kunjungan)

- **Masalah yang dijawab:** B1, B3 — dua sistem kunjungan tak terekonsiliasi.
- **Solusi:** gabungkan `kunjungan` + `reservasi` menjadi satu entitas `visit` dengan dua jalur asal (`walk_in` / `reservasi`) dan satu daur hidup status tunggal. QR menjadi benang merah seluruh perjalanan: reservasi → scan tiba → antre loket → dilayani → selesai → feedback (SKM).
- **Dampak:** satu identitas kunjungan, satu funnel, satu sumber metrik yang jujur. Menghilangkan pencatatan ganda.
- **Sketsa teknis:** tabel `visit` (lihat §7.1). Migrasi bertahap: tulis ganda (dual-write) dulu, lalu pindahkan pembacaan, lalu pensiunkan tabel lama.

### Inovasi #2 — Antrean Pintar + Estimasi Waktu Real-time

- **Masalah:** warga tak tahu berapa lama menunggu; PRD menolak layar antre, tapi realitanya sudah ada QR+appointment.
- **Solusi:** hitung estimasi waktu tunggu per loket dari histori `durasi_menit` (sudah dihitung di view `antrian_helpdesk`). Tampilkan di web ("Loket OSS: ~15 menit, 3 antre") dan opsional layar lobi (mode read-only).
- **Dampak:** "buku tamu digital" berubah jadi alat yang benar-benar menghemat waktu warga.
- **Sketsa teknis:** materialized view / fungsi agregasi rata-rata bergerak durasi per layanan per slot jam; Supabase Realtime untuk update antrean langsung.

### Inovasi #3 — Survei Kepuasan Masyarakat (SKM) Built-in ⭐

- **Masalah:** unit pelayanan publik **wajib** menjalankan SKM (PermenPANRB No. 14/2017). Sistem sekarang tidak punya sama sekali — gap regulasi.
- **Solusi:** SKM digital yang terpicu otomatis setelah `visit` berstatus `selesai` (via QR/notifikasi). 9 unsur pelayanan standar → hitung **Indeks Kepuasan Masyarakat (IKM)** → tampilkan di dashboard pimpinan dan halaman transparansi publik.
- **Dampak:** menaikkan LMH dari "aplikasi internal" jadi portal pelayanan yang patuh & akuntabel. Nilai jual terbesar ke pimpinan.
- **Sketsa teknis:** tabel `skm_respons` (§7.4); form ringan tanpa login (token dari QR visit); agregasi IKM periodik.

### Inovasi #4 — Asisten AI ber-RAG (bukan FAQ statis)

- **Masalah:** A3 — "chatbot" belum ada logika AI; kekhawatiran PRD §6 soal bot salah info.
- **Solusi:** retrieval-augmented generation di atas `faq_knowledge_base` + dokumen OSS. Jawaban **selalu mengutip sumber** (skema sudah punya `sumber_faq_id`), threshold eskalasi konservatif ke manusia, dukungan Bahasa Indonesia sederhana.
- **Dampak:** jawaban akurat & terkontrol (aman hukum), mengurangi beban petugas, tetap auditable.
- **Sketsa teknis:** embedding FAQ (pgvector), Edge Function untuk retrieval + panggilan LLM dengan sistem prompt ketat "jawab hanya dari konteks; jika ragu, eskalasi". Log setiap jawaban + sumber untuk audit.

### Inovasi #5 — Notifikasi Omnichannel

- **Masalah:** live chat semi-real-time tanpa notifikasi = dead-end untuk pengunjung anonim; tak ada pengingat reservasi.
- **Solusi:** tinjau ulang penolakan WhatsApp. **WhatsApp Cloud API** (transaksional, tanpa BSP) kini murah. Pakai untuk: pengingat reservasi, "antrean Anda siap", jawaban chat telat, approval edit UMKM. Fallback email/web-push.
- **Dampak:** pengalaman berubah dari "warga menunggu di halaman" jadi "warga dikabari".
- **Sketsa teknis:** Edge Function pengirim notifikasi terpicu perubahan status (DB trigger / Realtime); tabel `notifikasi` untuk log & retry.

### Inovasi #6 — Investment Gallery jadi Funnel Investor

- **Masalah:** K1 (bocor) + galeri pasif tak menghasilkan lead.
- **Solusi:** (a) tutup K1 dengan pipeline render per-halaman + **watermark dinamis ber-session** (membalik keterbatasan "tak bisa dilacak" jadi bisa dilacak); (b) tambah CTA "Ajukan Minat Investasi" yang menangkap lead investor ke CRM-lite.
- **Dampak:** galeri berubah dari brosur pasif jadi pintu masuk investasi nyata — sesuai misi inti DPMPTSP.
- **Sketsa teknis:** worker konversi PDF→PNG per halaman saat upload; overlay watermark (nama sesi/timestamp) saat render; tabel `investasi_lead`.

### Inovasi #7 — UMKM Matchmaking jadi Marketplace Dua Sisi yang Aman

- **Masalah:** K5 + satu arah (hanya listing kebutuhan) + kontak mentah terekspos ke spam.
- **Solusi:** (a) tambah sisi "penawaran"; (b) mesin pencocokan per kategori; (c) ganti edit-token mentah dengan **magic-link email** (tak bisa ditebak); (d) kotak masuk inquiry termoderasi alih-alih memajang nomor HP mentah.
- **Dampak:** marketplace yang benar-benar mempertemukan kebutuhan & penawaran, melindungi UMKM dari spam.
- **Sketsa teknis:** Edge Function magic-link (kirim tautan bertoken sekali pakai ke email UMKM); tabel `umkm_inquiry`; enum `sisi` (kebutuhan/penawaran) di `listing_umkm`.

### Inovasi #8 — Lapisan Tata Kelola Data & Kepatuhan PDP

- **Masalah:** cakupan PII membengkak (Google OAuth) tapi retensi/consent "belum diputuskan".
- **Solusi:** subsistem tata kelola: manajemen consent eksplisit, retensi otomatis (anonymisasi setelah N hari), tabel audit log (A2), dashboard mini penanggung jawab data (DPO).
- **Dampak:** pembeda portal pemerintah yang proper dari prototipe; mitigasi risiko hukum UU PDP.
- **Sketsa teknis:** tabel `consent_log`, `audit_log` (§7.3); job terjadwal (pg_cron) untuk anonymisasi; trigger audit pada tabel sensitif.

### Inovasi #9 — Inklusi & Keandalan Lapangan

- **Masalah:** internet kantor bisa drop; warga awam digital; aksesibilitas.
- **Solusi:** kios PWA offline-first (antre lokal lalu sinkron saat online), mode "dibantu petugas", bahasa sederhana, target WCAG 2.1 AA.
- **Dampak:** portal yang membantu *semua* warga, bukan hanya yang melek digital.
- **Sketsa teknis:** service worker + IndexedDB antrean lokal; sinkronisasi idempoten saat online; audit aksesibilitas kontras & navigasi keyboard.

---

## 7. Skema Data Usulan

Skema di bawah adalah usulan arah, bukan migration final. Terapkan bertahap dengan pola dual-write agar tanpa downtime.

### 7.1 `visit` — penyatuan kunjungan & reservasi (Inovasi #1)

```sql
CREATE TABLE visit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asal TEXT NOT NULL CHECK (asal IN ('walk_in', 'reservasi')),
  pengunjung_id UUID REFERENCES pengunjung(id),   -- NULL untuk walk-in anonim
  nama TEXT NOT NULL,                              -- snapshot nama (walk-in tak berakun)
  asal_instansi TEXT,
  layanan_id UUID REFERENCES layanan(id) ON DELETE RESTRICT,
  tujuan TEXT CHECK (tujuan IN ('loket', 'bertemu_seseorang')),
  nama_yang_ditemui TEXT,
  keperluan TEXT,
  qr_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  status TEXT NOT NULL CHECK (status IN (
    'terjadwal', 'menunggu', 'dilayani', 'selesai', 'batal', 'no_show'
  )) DEFAULT 'menunggu',
  tanggal_rencana DATE,
  waktu_masuk TIMESTAMPTZ,
  waktu_mulai_layan TIMESTAMPTZ,
  waktu_selesai TIMESTAMPTZ,
  catatan_petugas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Status `no_show` menjawab B3. `asal` menyatukan dua jalur (B1).

### 7.2 `layanan` — tambah tipe (B2)

```sql
ALTER TABLE layanan ADD COLUMN tipe TEXT NOT NULL DEFAULT 'konsultatif'
  CHECK (tipe IN ('konsultatif', 'mitra', 'modul_publik'));
-- UMKM & Investment Gallery -> 'modul_publik' (bukan target check-in)
```

### 7.3 `audit_log` & `consent_log` (Inovasi #8, temuan A2)

```sql
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID,                 -- auth.users.id pelaku
  actor_role TEXT,
  aksi TEXT NOT NULL,            -- 'update_status', 'approve_umkm', 'upload_dok', dst
  entitas TEXT NOT NULL,         -- nama tabel/objek
  entitas_id TEXT,
  detail JSONB,                  -- before/after ringkas
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consent_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subjek_ref TEXT NOT NULL,      -- id pengunjung / sesi / listing
  tujuan TEXT NOT NULL,          -- 'chat_followup', 'kontak_publik_umkm', dst
  disetujui BOOLEAN NOT NULL,
  versi_kebijakan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 7.4 `skm_respons` (Inovasi #3)

```sql
CREATE TABLE skm_respons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visit(id) ON DELETE SET NULL,
  layanan_id UUID REFERENCES layanan(id),
  -- 9 unsur PermenPANRB 14/2017, skala 1-4
  u1_persyaratan SMALLINT CHECK (u1_persyaratan BETWEEN 1 AND 4),
  u2_prosedur SMALLINT CHECK (u2_prosedur BETWEEN 1 AND 4),
  u3_waktu SMALLINT CHECK (u3_waktu BETWEEN 1 AND 4),
  u4_biaya SMALLINT CHECK (u4_biaya BETWEEN 1 AND 4),
  u5_produk SMALLINT CHECK (u5_produk BETWEEN 1 AND 4),
  u6_kompetensi SMALLINT CHECK (u6_kompetensi BETWEEN 1 AND 4),
  u7_perilaku SMALLINT CHECK (u7_perilaku BETWEEN 1 AND 4),
  u8_sarana SMALLINT CHECK (u8_sarana BETWEEN 1 AND 4),
  u9_pengaduan SMALLINT CHECK (u9_pengaduan BETWEEN 1 AND 4),
  saran TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 7.5 Tabel pendukung inovasi lain

- `notifikasi` (Inovasi #5): log kirim + status + retry.
- `investasi_lead` (Inovasi #6): lead investor dari galeri.
- `umkm_inquiry` (Inovasi #7): pesan masuk termoderasi untuk UMKM.

---

## 8. Roadmap & Prioritas

### Fase 0 — Pengamanan Darurat (blocker, sebelum publik penuh)
Tutup **K1–K5**. Bukan fitur, tapi kewajiban. Estimasi: prioritas tertinggi, kerjakan lebih dulu.

- [ ] K1: hentikan penyajian PDF mentah; bangun render per-halaman.
- [ ] K2: RLS chat berbasis kepemilikan sesi.
- [ ] K3: Anonymous Sign-In + rate limit.
- [ ] K4: cabut kredensial hardcode; rotasi password.
- [ ] K5: Edge Function / magic-link edit UMKM.

### Fase 1 — Fondasi Data & Tata Kelola
- [ ] Inovasi #1 (Visit Spine) — dual-write lalu migrasi.
- [ ] Inovasi #8 (audit log, consent, retensi) — subsistem PDP.
- [ ] B2 (tipe layanan), B4 (pisahkan seed demo), B5 (model akun mitra).

### Fase 2 — Dampak Warga Cepat
- [ ] Inovasi #3 (SKM) — kepatuhan + nilai jual pimpinan.
- [ ] Inovasi #2 (antrean pintar + estimasi waktu).
- [ ] Inovasi #5 (notifikasi omnichannel).

### Fase 3 — Diferensiasi
- [ ] Inovasi #4 (Asisten AI ber-RAG).
- [ ] Inovasi #6 (funnel investor).
- [ ] Inovasi #7 (marketplace UMKM dua sisi).

### Fase 4 — Ketahanan & Inklusi
- [ ] Inovasi #9 (offline-first kiosk, WCAG AA, mode bantuan).

---

## 9. Metrik Keberhasilan Baru

| Domain | Metrik | Sumber |
|---|---|---|
| Kepatuhan | Nilai IKM per layanan & agregat, jumlah responden SKM | `skm_respons` |
| Efisiensi layanan | Rata-rata waktu tunggu & waktu layan per loket, % no-show | `visit` |
| Kanal digital | % kunjungan via reservasi, akurasi estimasi antrean | `visit` |
| Live chat | Waktu respons, % terjawab AI vs eskalasi, % follow-up terkirim | `chat_*`, `notifikasi` |
| Investasi | Jumlah lead investor, konversi lihat→minat | `investasi_lead` |
| UMKM | Listing aktif, jumlah inquiry, match tercapai | `listing_umkm`, `umkm_inquiry` |
| Tata kelola | Cakupan consent, jumlah entri audit, kepatuhan retensi | `consent_log`, `audit_log` |

---

## 10. Lampiran

### 10.1 Checklist keamanan pra-rilis publik

- [ ] Tidak ada endpoint yang menyajikan file privat tanpa autentikasi.
- [ ] Semua tabel berisi data pribadi punya RLS berbasis kepemilikan (bukan `USING (true)`).
- [ ] Insert publik via Anonymous Sign-In + rate limit.
- [ ] Tidak ada kredensial/secret di repository.
- [ ] Signed URL berumur sesingkat mungkin (≤60 detik untuk view-only).
- [ ] Audit log aktif untuk aksi admin/petugas.
- [ ] Kebijakan retensi & consent PDP terdokumentasi dan terotomasi.

### 10.2 Matriks RLS yang benar (target)

| Tabel | Anon | Pengunjung (login) | Petugas | Admin |
|---|---|---|---|---|
| `layanan` | SELECT | SELECT | SELECT | ALL |
| `visit` | INSERT (via anon sign-in, rate-limited) | SELECT/UPDATE milik sendiri | SELECT/UPDATE layanan sendiri | ALL |
| `chat_sesi`/`chat_pesan` | INSERT + SELECT **sesi sendiri saja** | SELECT sesi sendiri | layanan sendiri | ALL |
| `listing_umkm` | SELECT (published) | — | INSERT | ALL + approve |
| `investment_documents` | SELECT metadata (aktif) | — | SELECT | ALL |
| `skm_respons` | INSERT (token visit) | — | SELECT layanan sendiri | ALL |
| `audit_log` | — | — | — | SELECT |

### 10.3 Referensi regulasi

- UU No. 27/2022 tentang Pelindungan Data Pribadi (PDP).
- UU No. 43/2009 tentang Kearsipan (potensi benturan retensi).
- PermenPANRB No. 14/2017 tentang Survei Kepuasan Masyarakat (dasar Inovasi #3).

---

### Riwayat Revisi

| Versi | Tanggal | Perubahan |
|---|---|---|
| 1.0 | 10 Juli 2026 | Dokumen awal: audit menyeluruh + roadmap inovasi 9 inisiatif. |
