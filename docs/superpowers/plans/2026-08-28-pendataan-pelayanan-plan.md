# Fitur Pendataan Pelayanan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mengimplementasikan fitur Pendataan Pelayanan tatap muka di loket antrean untuk dua kelompok layanan utama (Helpdesk OSS dan Layanan Perizinan DPMPTSP yang mencakup Perizinan dan Non-Perizinan) dengan prapopulasi data registrasi, autosave draft, validasi wajib sebelum selesai, penguncian data (immutability), dan rekapitulasi data terpisah.

**Architecture:** Pendekatan terisolasi dan aditif murni (`OPS-01`). Dua tabel database spesifik (`pelayanan_oss` dan `pelayanan_perizinan`) terhubung ke `tiket_antrean`, diamankan oleh RLS dan trigger lock. Endpoint API terpusat menangani GET, autosave PATCH, dan finalisasi POST. Frontend antrean mengintegrasikan dialog modal wizard multi-langkah `PelayananWizardModal.tsx` saat petugas klik "Mulai Layanan", serta menyajikan tab rekapitulasi terpisah di halaman rekap admin.

**Tech Stack:** Next.js 16.2 (App Router), React 19, TypeScript 5, Supabase (PostgreSQL 15+ & RLS), Zod 4, Lucide React icons.

**Spec:** `docs/analysis/02-TARGET-DESIGN-PENDATAAN-PELAYANAN.md`, `docs/analysis/03-DATA-MODEL-PENDATAAN-PELAYANAN.md`, `docs/analysis/04-RBAC-MATRIX-PENDATAAN-PELAYANAN.md`.

## Global Constraints
- Alur registrasi walk-in dan scan QR tidak boleh diubah (Zero-Disruption `P1`).
- Semua tanggal dan batas hari beroperasi dalam zona waktu `Asia/Jakarta` (`P5` / `RPT-07`).
- Immutability: data yang sudah selesai (`is_locked = true`) tidak dapat diubah oleh non-admin (`P6`).
- Backward Compatibility: tabel `visit` dan `tiket_antrean` tetap sinkron melalui trigger dual-write `trg_visit_dual_write`.

---

### Task 1: Skema Database, Migrasi Aditif, & RLS (WP-A)

**Files:**
- Create: `supabase/migrations/202608290001_pendataan_pelayanan.sql`
- Create: `supabase/migrations/pendataan_pelayanan.test.ts`

**Interfaces:**
- Produces: Tabel `pelayanan_oss`, `pelayanan_perizinan`, Trigger `trg_enforce_pelayanan_lock`, View `v_rekap_pelayanan_oss`, View `v_rekap_pelayanan_perizinan`.

- [ ] **Step 1: Buat file migrasi SQL `supabase/migrations/202608290001_pendataan_pelayanan.sql`**
- [ ] **Step 2: Tulis test migrasi dan RLS di `supabase/migrations/pendataan_pelayanan.test.ts`**
- [ ] **Step 3: Verifikasi sintaks DDL dan constraint SQL**

---

### Task 2: Tipe Data, Zod Validation Schemas, & API Route Handlers (WP-B)

**Files:**
- Create: `src/lib/types/pelayanan.ts`
- Create: `src/app/api/admin/pelayanan/[tiketId]/route.ts`
- Create: `src/app/api/admin/pelayanan/[tiketId]/route.test.ts`

**Interfaces:**
- Produces: `ossPelayananSchema`, `perizinanPelayananSchema`, `GET /api/admin/pelayanan/[tiketId]`, `PATCH /api/admin/pelayanan/[tiketId]`, `POST /api/admin/pelayanan/[tiketId]/finalize`.

- [ ] **Step 1: Tulis skema Zod dan tipe TypeScript di `src/lib/types/pelayanan.ts`**
- [ ] **Step 2: Tulis API Route Handler dengan validasi otorisasi petugas dan rate limiting**
- [ ] **Step 3: Tulis unit test untuk API route**

---

### Task 3: Komponen UI Wizard & Integrasi Loket Antrean (WP-C)

**Files:**
- Create: `src/components/admin/PelayananWizardModal.tsx`
- Modify: `src/app/admin/antrian/page.tsx`
- Create: `src/components/admin/PelayananWizardModal.test.tsx`

**Interfaces:**
- Consumes: API `/api/admin/pelayanan/[tiketId]`, `PelayananState`, `tiket_antrean`.
- Produces: Wizard modal terintegrasi pada tombol "Mulai Layanan", "Lanjutkan Form", dan "Lihat Data".

- [ ] **Step 1: Buat komponen `PelayananWizardModal.tsx` dengan dukungan Step 1-3, autosave debounced, dan validasi field wajib**
- [ ] **Step 2: Hubungkan trigger modal di `src/app/admin/antrian/page.tsx`**
- [ ] **Step 3: Tambahkan pengujian interaksi komponen**

---

### Task 4: Rekapitulasi Data Terpisah & Ekspor CSV Berjejak (WP-D)

**Files:**
- Modify: `src/app/admin/rekap/page.tsx`
- Modify: `src/lib/constants.ts`

**Interfaces:**
- Produces: Tab "Rekap OSS" dan "Rekap Perizinan" dengan unduh CSV khusus dan pencatatan ke `audit_log`.

- [ ] **Step 1: Tambahkan tab dan tabel rekapitulasi data teknis di `src/app/admin/rekap/page.tsx`**
- [ ] **Step 2: Implementasikan ekspor CSV dengan kolom khusus dan pencatatan audit log**
- [ ] **Step 3: Pastikan konstanta nama layanan tersinkronisasi di `src/lib/constants.ts`**

---

### Task 5: Verifikasi Menyeluruh & Testing (WP-E)

- [ ] **Step 1: Jalankan validasi konsistensi kode dan skema**
- [ ] **Step 2: Periksa zero-regression pada alur registrasi walk-in dan scan QR**
- [ ] **Step 3: Lakukan review menyeluruh sebelum pelaporan final**
