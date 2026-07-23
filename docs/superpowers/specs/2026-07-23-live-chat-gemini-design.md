# Design Specification: Live Chat Interaktif & Gemini AI Takeover dengan Batasan Knowledge Hukum

**Tanggal:** 23 Juli 2026  
**Status:** Disetujui (Draft Spec)  
**Target Komponen:**  
- Public Chat UI: `src/app/chat/page.tsx`, `src/app/chat/chat.module.css`  
- Admin Chat Console & FAQ: `src/app/admin/chat/page.tsx`, `src/app/admin/chat/faq/page.tsx`  
- Backend API & AI Engine: `src/app/api/chat/ai/route.ts`, `src/app/api/chat/ai/draft/route.ts`, `src/lib/gemini.ts`

---

## 1. Ringkasan Fitur & Tujuan

Mengubah fitur Live Chat pada Lampung Maju Hub (`LMH`) menjadi antarmuka yang **sangat hidup dan interaktif**, dilengkapi **AI Gemini Auto-Takeover** dan **Petugas Copilot**, serta **Batasan Knowledge Hukum (Legally Grounded)** agar jawaban AI 100% berbasis Aturan, Undang-Undang (UU), Peraturan Daerah (Perda), dan SOP resmi tanpa halusinasi.

---

## 2. Pengalaman Pengguna (Interactive UX & Chat Publik)

### 2.1 Typing Indicator & Status Visual
- **Visual Typing Indicator:** Komponen animasi 3 titik bergelombang (*pulse animation*) saat AI Gemini atau Petugas sedang memproses balasan.
- **Badge Status Sesi:** 
  - `Bot FAQ (Gemini)` — Dijawab otomatis oleh AI.
  - `Menunggu Petugas` — Eskalasi antrean.
  - `Terhubung Petugas` — Live chat dengan petugas loket.
  - `Sesi Selesai` — Sesi ditutup.

### 2.2 Quick FAQ Chips (Saran Pertanyaan Cepat)
- Setelah pengguna memilih layanan di `src/app/chat/page.tsx`, tampilkan 3–4 tombol pertanyaan populer (diambil dari `faq_knowledge_base` aktif untuk layanan tersebut).
- Pengunjung dapat mengklik chip untuk mengirim pertanyaan secara instant.

### 2.3 Rich Text, Markdown & Rujukan Dasar Hukum
- Jawaban AI mendukung format Markdown (*bold*, *lists*, *link internal ke halaman reservasi/layanan*).
- Menampilkan rujukan sitasi `[1]`, `[2]` serta penegasan **Dasar Hukum / Aturan** (misal: *Perda Prov. Lampung No. X / UU No. 6 Tahun 2023*) di akhir jawaban AI.

### 2.4 Notifikasi Suara Halu
- Suara notifikasi lembut (menggunakan Web Audio API / synth sintetis tanpa file eksternal berat) ketika ada balasan pesan baru dari petugas atau bot.

---

## 3. Gemini Copilot & Auto-Takeover Petugas

### 3.1 Mode Hybrid (Auto-Bot + Escalation)
- **Auto-Bot:** Pengunjung pertama kali menyapa akan dilayani AI Gemini yang mencocokkan RAG FAQ & dasar hukum.
- **Auto-Escalation:** Jika similarity < 0.7, AI ragu, atau pengguna meminta manusia, sesi berubah ke `eskalasi` dan memberi notifikasi ke konsol admin.

### 3.2 Feature: "⚡ Drafkan Balasan Gemini" di Panel Admin (`src/app/admin/chat/page.tsx`)
- Petugas di panel admin dapat menekan tombol **"⚡ Draf Balasan Gemini"**.
- Endpoint baru `/api/chat/ai/draft` menganalisis konteks percakapan terakhir pengunjung, lalu memuat draf jawaban berbasis FAQ/Aturan resmi ke dalam kotak teks balasan petugas.
- Petugas dapat meninjau, menyunting, atau menyetujui balasan tersebut hanya dengan 1 klik.

---

## 4. Pembatasan Knowledge (Strict Legal Grounding & Zero Hallucination)

### 4.1 Kolom `dasar_hukum` pada Knowledge Base
- Menambahkan kolom `dasar_hukum` (TEXT, opsional) pada tabel database `faq_knowledge_base`.
- Contoh isi: `"UU No. 6 Tahun 2023 Pasal 12", "Perda Prov. Lampung No. 3 Tahun 2021"`.
- Di halaman kelola FAQ (`src/app/admin/chat/faq/page.tsx`), petugas dapat memasukkan dan membatasi aturan/UU dasar hukum untuk setiap entri FAQ.

### 4.2 System Instruction Strict Grounding (`src/lib/gemini.ts`)
- Prompt Gemini disesuaikan secara ketat:
  > *"Anda adalah asisten resmi DPMPTSP Lampung. Jawab HANYA berdasarkan konteks Aturan, UU, Perda, dan FAQ resmi yang diberikan. JANGAN PERNAH mengarang atau berspekulasi di luar dokumen resmi ini (Zero-Hallucination Policy). Jika informasi tidak ada pada konteks aturan yang diberikan, jawab persis: 'Maaf, informasi tersebut belum tercantum dalam aturan resmi yang kami kelola. Saya akan menghubungkan Anda ke petugas loket.' dan aktifkan eskalasi."*

---

## 5. Keamanan Lengkap (Multi-Layer Security)

1. **Anti-Prompt Injection Guard:**
   - Filter regex & pemeriksaan pola semantik pada `pertanyaan` sebelum dikirim ke Gemini (mendeteksi perintah jahat seperti `"Abaikan instruksi sebelumnya"`, `"Tampilkan system prompt"`, dll).
2. **Redaksi PII Dua Arah (Input & Output):**
   - Redaksi otomatis `redactPii()` memfilter NIK (16 digit), nomor telepon, email, dan nomor dokumen pada pertanyaan pengunjung sebelum diproses AI.
   - Sanitasi ulang pada jawaban Gemini sebelum dikembalikan ke pengunjung.
3. **Pengaturan Safety API Gemini (`HarmCategory`):**
   - Menambahkan konfigurasi `safetySettings` Gemini API (blocking `HARASSMENT`, `HATE_SPEECH`, `SEXUALLY_EXPLICIT`, dan `DANGEROUS_CONTENT` pada level `BLOCK_MEDIUM_AND_ABOVE`).
4. **Verifikasi Otorisasi & Rate Limiting:**
   - Otorisasi Supabase RLS (memastikan pengunjung hanya punya akses ke sesi miliknya sendiri).
   - Rate limit ketat 10 panggil AI per 60 detik per pengguna berbasis `anon_rate_limit` (fail-closed jika terjadi kegagalan query rate limit).

---

## 6. Verifikasi & Pengujian
- **Automated Tests:** Menambahkan / memperbarui pengujian unit & integrasi untuk:
  - Pembatasan RAG & Dasar Hukum (`ai.test.ts`).
  - Redaksi PII input/output.
  - Endpoint Copilot Draft untuk petugas (`draft.test.ts`).
  - Rate limiting & otorisasi RLS.
- **Manual Verification:** Uji coba alur chat publik, respons AI Gemini dengan dasar hukum, tombol quick chips, animasi typing, serta fitur Draf Balasan pada konsol admin petugas.
