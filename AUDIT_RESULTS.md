# Audit Lengkap Project Lampung Maju Hub

Tanggal: 2026-07-08

---

## RINGKASAN EKSEKUTIF

Project ini adalah sistem digital DPMPTSP Provinsi Lampung dengan 9 layanan. Setelah audit menyeluruh, ditemukan **banyak fungsi yang tidak berfungsi** karena:

1. **Banyak admin page menggunakan demo/seed data hardcoded** — data tidak di-fetch dari Supabase
2. **Tabel `site_settings` tidak ada di migration** — halaman settings akan error
3. **Scan QR mencoba set status `'ditolak'`** yang tidak ada di CHECK constraint reservasi
4. **Checkin page menggunakan `useState(() => {...})` sebagai side-effect** — harusnya `useEffect`
5. **Tidak ada admin UI untuk edit konten landing page** — services, hero text, dll tidak bisa di-edit
6. **Admin dashboard menggunakan hardcoded demo data** — statistik tidak real
7. **Admin UMKM & Gallery menggunakan demo data** — CRUD tidak berfungsi
8. **Admin kunjungan menggunakan demo data** — tidak fetch dari Supabase

---

## TEMUAN DETAIL PER FILE

### 1. 🔴 `src/app/admin/page.tsx` (Dashboard Admin)

**Masalah:**
- Stats (totalHariIni, menunggu, selesai, rataWaktu) di-hardcode: `useState(75)`, `useState(3)`, dll
- `useEffect` kosong dengan comment "Supabase loadData disabled for documentation seeding"
- `recentVisits` menggunakan `SEED_VISITS` hardcoded
- `layananList` menggunakan fallback `LAYANAN_LIST` static, tidak fetch dari DB
- Chart data (`dailyVisits`, `layananBreakdown`) hardcoded

**Dampak:** Dashboard menampilkan data palsu, tidak mencerminkan kondisi sebenarnya.

**Fix:** Fetch real data dari tabel `kunjungan` dan `layanan`.

---

### 2. 🔴 `src/app/admin/umkm/page.tsx` (Kelola UMKM)

**Masalah:**
- Menggunakan `demoListings` (9 entri hardcoded dengan URL Unsplash)
- `loadData()` kosong ("Disabled for seed")
- `handleUpdateStatus` hanya update local state, tidak write ke Supabase
- Tombol "Lihat" (Eye icon) tidak memiliki handler
- Tidak ada form untuk tambah/edit listing UMKM
- Tidak ada fungsi hapus listing

**Dampak:** Admin tidak bisa CRUD UMKM. Approve/reject hanya ilusi (local state).

**Fix:** Implementasi fetch dari `listing_umkm`, CRUD operations, form tambah/edit.

---

### 3. 🔴 `src/app/admin/gallery/page.tsx` (Investment Gallery)

**Masalah:**
- Menggunakan `demoDocs` (9 entri hardcoded)
- `loadData()` kosong ("Disabled for seed")
- `handleToggleStatus` hanya update local state
- Tombol "Upload Dokumen" tidak memiliki handler
- Tombol "Lihat" (Eye) tidak memiliki handler
- Tombol "Hapus" (Trash2) tidak memiliki handler
- Drag-and-drop urutan tidak berfungsi (hanya visual)

**Dampak:** Admin tidak bisa upload PDF, tidak bisa hapus, tidak bisa edit dokumen.

**Fix:** Implementasi fetch dari `investment_documents`, upload ke Supabase Storage, CRUD operations.

---

### 4. 🔴 `src/app/admin/kunjungan/page.tsx` (Kelola Kunjungan)

**Masalah:**
- Menggunakan `demoKunjungan` (6 entri hardcoded)
- `loadData()` kosong ("Disabled for seed")
- `handleSelesai` hanya update local state, tidak write ke Supabase
- Data `layanan` ditampilkan sebagai string hardcoded, bukan join dari tabel

**Dampak:** Data kunjungan tidak real, tombol "Selesai" tidak persisten.

**Fix:** Fetch dari `kunjungan` join `layanan`, update status ke Supabase.

---

### 5. 🟡 `src/app/admin/scan/page.tsx` (Scan QR)

**Masalah:**
- Line 153: `status: action === 'hadir' ? 'hadir' : 'ditolak'` — **`'ditolak'` TIDAK ADA** di CHECK constraint reservasi (yang ada: `'terjadwal', 'hadir', 'dilayani', 'selesai', 'batal'`)
- Aksi "tolak" akan menyebabkan PostgreSQL error: `CHECK constraint violation`

**Dampak:** Menolak pengunjung via scan QR akan gagal dengan database error.

**Fix:** Ubah `'ditolak'` menjadi `'batal'`.

---

### 6. 🔴 `src/app/admin/settings/page.tsx` (Pengaturan)

**Masalah:**
- Query ke tabel `site_settings` yang **TIDAK ADA** di migration manapun
- Akan error "relation does not exist" saat diakses
- Hanya ada setting `foila_url`, tidak ada editor konten landing page

**Dampak:** Halaman settings crash, tidak bisa konfigurasi apa pun.

**Fix:** Buat migration untuk tabel `site_settings`, tambah editor konten landing page.

---

### 7. 🟡 `src/app/checkin/page.tsx` (Check-in Publik)

**Masalah:**
- Line 30: Menggunakan `useState(() => { ... })` untuk load layanan — **INI SALAH**
- `useState` initializer tidak boleh melakukan side-effect (async fetch)
- Fungsi async di dalam `useState` initializer akan jalan di setiap render di development mode (React Strict Mode)
- Seharusnya menggunakan `useEffect`

**Dampak:** Layanan mungkin tidak ter-load dengan benar, potential memory leak.

**Fix:** Ganti `useState(() => {...})` dengan `useEffect(() => {...}, [])`.

---

### 8. 🟢 `src/app/admin/chat/page.tsx` (Live Chat Admin)

**Status:** Berfungsi — fetch dari Supabase, real-time subscription aktif.

---

### 9. 🟢 `src/app/admin/chat/faq/page.tsx` (Kelola FAQ)

**Status:** Berfungsi — CRUD FAQ dari Supabase, toggle chatbot per layanan.

---

### 10. 🟢 `src/app/admin/absensi/page.tsx` (Absensi)

**Status:** Berfungsi — fetch dari `absensi_petugas`, absen hadir/pulang, approve admin.

---

### 11. 🟢 `src/app/admin/antrian/page.tsx` (Antrian/Log FIFO)

**Status:** Berfungsi — fetch dari `kunjungan` join `layanan`, tombol selesai write ke DB.

---

### 12. 🔴 `src/app/page.tsx` (Landing Page)

**Masalah:**
- Array `services` (9 layanan) di-hardcode di komponen
- Deskripsi layanan, icon, urutan — semua tidak bisa di-edit dari admin
- Tidak ada tabel database untuk menyimpan konten landing page
- Hero description, CTA text — semua hardcoded

**Dampak:** Admin tidak bisa mengubah konten landing page tanpa edit kode.

**Fix:** Buat tabel `landing_content` dan editor di admin panel.

---

### 13. 🔴 `src/app/gallery/page.tsx` (Public Investment Gallery)

**Masalah:**
- Menggunakan `iproProjects` (9 entri hardcoded)
- `useEffect` kosong ("Disabled for seed")
- `foilaUrl` di-hardcode: `'https://invest.lampungprov.go.id/'`
- Tidak fetch dari `investment_documents`

**Dampak:** Gallery publik menampilkan data demo, tidak terhubung dengan admin.

**Fix:** Fetch dari `investment_documents` where `status = 'aktif'`.

---

### 14. 🔴 `src/app/umkm/page.tsx` (Public UMKM)

**Masalah:**
- Menggunakan `demoListings` (9 entri hardcoded)
- `useEffect` kosong ("Disabled for seed")
- Tidak fetch dari `listing_umkm` where `status = 'published'`

**Dampak:** UMKM publik menampilkan data demo, tidak terhubung dengan admin.

**Fix:** Fetch dari `listing_umkm` where `status = 'published'`.

---

## SKEMA DATABASE — KESENJANGAN

### Tabel yang direferensikan di kode tapi TIDAK ADA di migration:
1. **`site_settings`** — digunakan di `admin/settings/page.tsx`

### Tabel yang ada di migration tapi belum dimanfaatkan:
1. **`investment_documents`** — admin & publik page pakai demo data
2. **`listing_umkm`** — admin & publik page pakai demo data

### Tabel yang DIBUTUHKAN untuk edit konten landing page:
1. **`landing_content`** — key-value store untuk text, images, service list

---

## PRIORITAS PERBAIKAN

### Prioritas 1 — Bug kritis (fitur error/crash)
1. Fix `checkin/page.tsx`: `useState` → `useEffect`
2. Fix `admin/scan/page.tsx`: `'ditolak'` → `'batal'`
3. Buat migration `site_settings` table

### Prioritas 2 — Admin pages dengan demo data
4. Fix `admin/page.tsx`: fetch real stats dari Supabase
5. Fix `admin/kunjungan/page.tsx`: fetch & update dari Supabase
6. Fix `admin/umkm/page.tsx`: full CRUD dari Supabase
7. Fix `admin/gallery/page.tsx`: full CRUD + upload dari Supabase

### Prioritas 3 — Public pages dengan demo data
8. Fix `gallery/page.tsx`: fetch dari `investment_documents`
9. Fix `umkm/page.tsx`: fetch dari `listing_umkm`

### Prioritas 4 — Editor konten landing page via admin
10. Buat migration `landing_content` table
11. Buat admin page untuk edit konten landing
12. Refactor `page.tsx` (landing) untuk fetch dari `landing_content`
