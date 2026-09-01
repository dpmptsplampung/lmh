# Rekapitulasi Per Layanan — Design

**Tanggal:** 2026-09-01
**Status:** Draft menunggu approval
**Author:** Brainstorming session

## 1. Tujuan & Latar Belakang

Saat ini, untuk melihat data "siapa saja yang sudah saya layani", setiap petugas harus membuka halaman Antrian (`/admin/antrian`). Tidak ada tampilan khusus yang:

- Menampilkan **rekap tiket selesai** untuk satu layanan spesifik
- Memungkinkan **search bebas** berdasarkan field apapun (nama, nomor, asal, pendataan)
- Menampilkan **detail lengkap** tiket + pendataan (OSS/Perizinan) tanpa harus navigasi ke wizard
- Memungkinkan **download Excel** dengan data lengkap untuk kebutuhan laporan

Tujuan fitur ini: menyediakan menu rekapitulasi per layanan yang komprehensif, searchable, dan exportable ke Excel.

## 2. Keputusan Arsitektur

### 2.1 Single-page + dropdown layanan (Pendekatan A)

- Halaman: `/admin/rekap` (extend existing page dengan tab baru)
- Dropdown "Layanan" sebagai filter utama
- Query param `?layanan={id}` (atau `all` untuk admin/FO)
- Petugas: dropdown terkunci ke layanannya (`disabled`), sesuai RLS
- Admin/FO: dropdown menampilkan semua layanan dengan opsi "Semua Layanan"

**Alasan**: Konsisten dengan pola existing di `src/app/admin/rekap/page.tsx` (dropdown date range, tab filter). URL sederhana. Tidak perlu ubah signature `admin-nav.ts`.

### 2.2 Source data: tiket_antrean + kunjungan + pelayanan_* + petugas

Data source utama:
- `tiket_antrean` (status='selesai') — daftar tiket
- `kunjungan` (via `kunjungan_id`) — identitas pengunjung
- `petugas` (via `dilayani_oleh`) — nama petugas pelayan
- `pelayanan_oss` atau `pelayanan_perizinan` (via `tiket_id`, LEFT JOIN) — data pendataan

### 2.3 Filter default

- Status: `selesai` saja (sesuai persetujuan user)
- Rentang tanggal: 30 hari terakhir sampai hari ini (WIB)
- Layanan: myLayananId (untuk petugas), `all` (untuk admin/FO)

### 2.4 Search bebas (server-side)

Single search box `q` mencocokkan ILIKE pada kolom-kolom berikut via PostgREST `or=`:

- `nomor_display`
- `kunjungan.nama`
- `pelayanan_oss.nama_pemohon`, `pelayanan_oss.nama_usaha`
- `pelayanan_perizinan.nama_pemohon`, `pelayanan_perizinan.nama_perusahaan`
- `petugas.nama`

Debounced 300ms di client-side.

### 2.5 Format export: Excel .xlsx via exceljs

- Library baru: `exceljs` (server-side Route Handler, Node runtime)
- Unified single sheet dengan semua kolom (OSS + Perizinan + non-pendataan)
- Kolom kosong jika field tidak relevan untuk tiket tersebut
- Header bold, freeze pane row 2, auto-width kolom
- Audit log entry setiap export berhasil

### 2.6 Detail per tiket: side panel read-only

Klik "Lihat Detail" di row → side panel slide dari kanan menampilkan semua field tiket + pendataan. Field dikelompokkan per section: Identitas Pengunjung, Tiket, Petugas, Pendataan OSS / Perizinan.

## 3. Struktur File

```
src/
├── app/
│   └── admin/
│       └── rekap/
│           ├── page.tsx                          # MODIFIED: tambah tab "Rekap Per Layanan"
│           └── rekap-layanan.test.tsx            # NEW
├── api/
│   └── admin/
│       └── rekap/
│           ├── tickets/route.ts                  # NEW
│           ├── export/route.ts                   # NEW
│           └── layanan-options/route.ts          # NEW
├── components/
│   └── admin/
│       ├── RekapLayananTable.tsx                 # NEW
│       └── RekapTiketDetailPanel.tsx             # NEW
└── lib/
    └── rekap/
        ├── query.ts                              # NEW
        ├── excel.ts                              # NEW
        └── schemas.ts                            # NEW
```

## 4. API Specification

### 4.1 `GET /api/admin/rekap/tickets`

**Auth/Authz**:
- Cookie session via `createClient()` dari `@/lib/supabase/server`
- Inline `getRole()` helper (pola dari `pengaduan/route.ts`)
- Petugas: paksa `layanan_id = myLayananId`; query param `layanan_id` lain → 403
- Admin/FO: izinkan `layanan_id` atau `all`

**Query params** (zod validation):
- `layanan_id` (UUID, optional jika admin/FO)
- `q` (string, max 100 char, optional)
- `dari` (date YYYY-MM-DD, default 30 hari lalu)
- `sampai` (date YYYY-MM-DD, default hari ini)
- `page` (int ≥ 0, default 0)
- `page_size` (int 1-100, default 25)

**Response 200**:
```json
{
  "total": 145,
  "rows": [
    {
      "id": "uuid",
      "nomor_display": "A-001",
      "tanggal": "2026-08-31",
      "waktu_terbit": "2026-08-31T01:00:00Z",
      "waktu_mulai_layan": "2026-08-31T01:05:00Z",
      "waktu_selesai": "2026-08-31T01:20:00Z",
      "status": "selesai",
      "kunjungan": { "nama": "Budi", "asal": "walk_in", "qr_token": "abc" },
      "petugas": { "nama": "Petugas OSS" },
      "form_type": "oss",
      "pelayanan_oss": { "nama_pemohon": "...", "nama_usaha": "...", ... } | null,
      "pelayanan_perizinan": null
    }
  ]
}
```

**Response errors**:
- 401: `{ error: "Unauthorized" }`
- 403: `{ error: "Forbidden" }`
- 422: `{ error: "Invalid input", details: zod.flatten().fieldErrors }`
- 500: `{ error: "Gagal memuat rekap" }`

**Implementasi**:
```ts
// Sketsa query builder
let query = supabase
  .from('tiket_antrean')
  .select(`
    id, nomor_display, tanggal, status,
    waktu_terbit, waktu_mulai_layan, waktu_selesai,
    kunjungan:kunjungan_id(nama, asal, qr_token),
    petugas:dilayani_oleh(nama),
    pelayanan_oss:tiket_id(*),
    pelayanan_perizinan:tiket_id(*)
  `, { count: 'exact' })
  .eq('status', 'selesai')
  .gte('tanggal', dari)
  .lte('tanggal', sampai)
  .order('waktu_selesai', { ascending: false })
  .range(from, to);

// Filter layanan
if (effectiveLayananId) {
  query = query.eq('layanan_id', effectiveLayananId);
}

// Search bebas
if (q) {
  const escaped = q.replace(/[%_]/g, '\\$&');
  query = query.or(`
    nomor_display.ilike.%${escaped}%,
    kunjungan.nama.ilike.%${escaped}%,
    pelayanan_oss.nama_pemohon.ilike.%${escaped}%,
    pelayanan_oss.nama_usaha.ilike.%${escaped}%,
    pelayanan_perizinan.nama_pemohon.ilike.%${escaped}%,
    pelayanan_perizinan.nama_perusahaan.ilike.%${escaped}%,
    petugas.nama.ilike.%${escaped}%
  `);
}
```

**Catatan teknis**: PostgREST `or=` filter tidak otomatis meng-include kolom dari relasi yang NULL. Untuk tiket tanpa pendataan, search pada kolom `pelayanan_oss.*` tidak match, tapi kolom `nomor_display` atau `kunjungan.nama` masih match. Ini acceptable.

### 4.2 `GET /api/admin/rekap/export`

**Auth/Authz**: sama seperti 4.1.

**Query params**: sama seperti 4.1 kecuali `page`/`page_size` (export semua hasil filter). Hard limit 50000 baris sebagai guard.

**Response 200**:
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="rekap-{layananNamaSlug}-{dari}-sd-{sampai}.xlsx"`
- `Cache-Control: no-store`
- Body: binary .xlsx

**Jika >50000 baris**: tambah header `X-Rekap-Truncated: true` dan return file dengan 50000 baris + warning row terakhir "Data terpotong, persempit rentang tanggal".

**Audit log**: tulis ke `audit_log`:
```ts
{
  aksi: 'export_xlsx',
  entitas: 'rekap_pelayanan',
  tiket_id: null,
  detail: {
    layanan_id, dari, sampai, q, total_rows, file_size_bytes
  }
}
```

**Runtime**: `export const runtime = 'nodejs'` (exceljs butuh Node API).

### 4.3 `GET /api/admin/rekap/layanan-options`

**Response 200**:
```json
{
  "options": [
    { "id": "uuid", "nama": "Helpdesk OSS", "tipe": "konsultatif", "jenis_pendataan": "oss" },
    { "id": "uuid", "nama": "BPJS Kesehatan", "tipe": "mitra", "jenis_pendataan": null }
  ],
  "default_layanan_id": "uuid" | null,
  "is_petugas": true | false
}
```

- Petugas: `options` cuma 1 (layanannya), `default_layanan_id` di-set, `is_petugas: true`
- Admin/FO: `options` semua layanan aktif, `default_layanan_id: null`, `is_petugas: false`. Frontend tambah opsi "Semua Layanan" client-side.

## 5. Komponen UI

### 5.1 `RekapLayananTable.tsx` (Client Component)

**Props**:
```ts
interface RekapLayananTableProps {
  initialLayananId: string | null;  // dari server-side render atau API options
  isPetugas: boolean;
}
```

**State**:
- `layananId`, `dari`, `sampai`, `q`, `page`, `rows`, `total`, `loading`, `error`, `selectedTiketId`, `exporting`

**Handlers**:
- `handleFilter()`: fetch dengan filter baru, reset page ke 0
- `handleSearch()`: debounced (300ms) fetch dengan q baru
- `handlePageChange(page)`: fetch dengan page baru
- `handleExport()`: trigger download Excel
- `handleRowClick(id)`: buka side panel

**Render**:
- Filter bar (dropdown layanan, date range, search input, tombol Terapkan, tombol Refresh, tombol Export)
- Stats cards (3): Total Selesai, Rata-rata Durasi, Petugas Aktif
- Tabel dengan kolom-kolom di §5.2
- Pagination (reuse `src/components/Pagination.tsx`)
- Loading skeleton saat initial load
- Empty state saat 0 rows
- Error state dengan tombol "Coba Lagi"

### 5.2 Kolom Tabel

| # | Tanggal | No Antrian | Nama | Asal | Petugas | Mulai | Selesai | Durasi | Detail |
|---|---------|------------|------|------|---------|-------|---------|--------|--------|

- Tanggal: `dd/MM/yyyy`
- Mulai/Selesai: `HH:mm`
- Durasi: `${menit} mnt`
- Tombol "Lihat Detail" di kolom terakhir

### 5.3 `RekapTiketDetailPanel.tsx` (Client Component)

**Props**:
```ts
interface RekapTiketDetailPanelProps {
  tiketId: string | null;
  onClose: () => void;
}
```

**Behavior**:
- Slide dari kanan (CSS transition 300ms)
- `role="dialog" aria-modal="true"`, focus trap, Escape untuk tutup
- Header: `Nomor Antrian {nomor_display}` + tombol close (X)
- Sections:
  - **Identitas Pengunjung**: nama, asal (badge), qr_token, tanggal
  - **Tiket**: nomor, status, waktu_terbit/mulai/selesai, durasi
  - **Petugas**: nama (read-only)
  - **Pendataan OSS** (jika `form_type === 'oss'`): grid 2-kolom semua field pelayanan_oss
  - **Pendataan Perizinan** (jika `form_type === 'perizinan'`): grid 2-kolom semua field pelayanan_perizinan
  - Jika bukan keduanya: tampil "Tiket ini tidak memiliki data pendataan"

**Data fetch**: ambil detail dari response API yang sudah ada (cache row + parallel fetch detail jika perlu). Untuk simplicity: saat row di-klik, fetch detail lengkap via endpoint yang sama (`/api/admin/rekap/tickets?id=xxx`) atau reuse data row yang sudah ada (extended include).

**Keputusan**: fetch detail via endpoint baru `GET /api/admin/rekap/tickets/[id]` atau pakai data row yang sudah include semua field. Untuk efisiensi, pakai data row yang sudah include `pelayanan_oss(*)` dan `pelayanan_perizinan(*)` (LEFT JOIN) → tidak perlu endpoint terpisah.

## 6. Library & Dependensi Baru

- `exceljs` (^4.4.0) → tambah ke `dependencies` di `package.json`

**Verifikasi instalasi**: cek NPM registry untuk versi stabil terbaru sebelum install. Alternatif: `xlsx` (SheetJS) tapi lisensinya berubah, jadi `exceljs` lebih aman.

## 7. Validasi & Keamanan

- **Zod schemas** di `src/lib/rekap/schemas.ts`:
  - `ticketsQuerySchema`, `exportQuerySchema`, `layananIdSchema`
- **SQL injection**: semua query via Supabase PostgREST (parameterized). ILIKE escape `%` dan `_` di client sebelum kirim ke server.
- **RLS**: read-only via cookie client, tidak bypass. RLS `tiket_staff_select` sudah handle scoping petugas.
- **Rate limiting** (YAGNI): tidak ada di awal; tambah jika abuse terdeteksi.
- **Export size limit**: hard cap 50000 baris + audit log entry.
- **PII**: data nama, kontak_hp, email termasuk PII. Hanya user ber-role staff yang boleh akses, sesuai RLS existing. Tambah disclaimer di UI "Data ini berisi informasi pribadi pengunjung — jangan sebarluaskan".

## 8. Error Handling Matrix

| Skenario | Client behavior | Server response |
|---|---|---|
| Session expired | Toast "Sesi berakhir, silakan login ulang" + redirect `/me` | 401 |
| Forbidden akses layanan lain | Toast "Anda tidak punya akses ke layanan ini" + reset filter | 403 |
| Invalid query params | Toast dengan field errors | 422 + zod.flatten |
| Server error | Toast "Gagal memuat rekap. Coba lagi." + empty state + tombol "Coba Lagi" | 500 |
| Network offline | Toast "Tidak ada koneksi" + disable tombol | - |
| Export >30 detik | Loading modal dengan timeout → "Export gagal, coba kurensi rentang tanggal" | - |
| Export >50000 baris | Header `X-Rekap-Truncated: true` + warning row di Excel | 200 + truncated file |
| 0 rows | Empty state "Tidak ada tiket selesai dalam rentang ini" + disable export | 200 + empty rows |

## 9. Testing

### 9.1 Unit/Component tests

File: `src/app/admin/rekap/rekap-layanan.test.tsx`

- Render tab dengan filter form default values
- Petugas: dropdown disabled, hanya 1 option
- Admin: dropdown enabled, multiple options + "Semua Layanan"
- Click "Terapkan" → fetch dengan query params benar
- Search input → debounce 300ms → fetch
- Pagination click → update page + fetch
- Click "Download Excel" → trigger download
- Click "Lihat Detail" → buka side panel dengan data
- Empty state: tampil pesan + disable export
- Error 403: tampil toast + reset filter
- Error 500: tampil empty state + tombol "Coba Lagi"

### 9.2 API tests (opsional, terpisah)

- `GET /api/admin/rekap/tickets?layanan_id=X` → 200 + rows
- `GET /api/admin/rekap/tickets` (no auth) → 401
- `GET /api/admin/rekap/tickets?layanan_id=other` (petugas) → 403
- `GET /api/admin/rekap/tickets?q=budi` → 200 + filtered rows
- `GET /api/admin/rekap/export?layanan_id=X` → 200 + .xlsx content-type

## 10. Acceptance Criteria

1. ✅ User bisa membuka `/admin/rekap` → lihat tab "Rekap Per Layanan" (tab ke-4, urutan akhir)
2. ✅ Petugas otomatis ter-filter ke layanannya, dropdown disabled
3. ✅ Admin/FO bisa pilih layanan via dropdown (single atau "Semua Layanan")
4. ✅ Default rentang tanggal: 30 hari terakhir sampai hari ini
5. ✅ Search box mencocokkan: nomor, nama pengunjung, nama pemohon/usaha/perusahaan, nama petugas
6. ✅ Pagination: 25 baris per halaman, navigasi prev/next
7. ✅ Klik "Lihat Detail" → side panel read-only dengan semua field
8. ✅ Klik "Download Excel" → download .xlsx dengan semua data hasil filter
9. ✅ Hanya tiket berstatus `selesai` yang muncul
10. ✅ Audit log entry setiap export Excel
11. ✅ Test coverage minimal untuk happy path + error cases utama

## 11. Out of Scope (YAGNI)

- Scheduled report / email blast
- Filter berdasarkan rentang tanggal kustom lebih dari 1 tahun (hard cap 50000 baris)
- Multi-sheet Excel (cukup unified)
- Filter berdasarkan field spesifik (mis. "filter by nama saja") — search bebas cukup
- Print/PDF export
- Saved filter / bookmark URL
- Real-time update via Supabase Realtime
- Graph/chart di tab ini (sudah ada di tab "umum")
- Hapus tiket dari rekap (read-only)
- Edit data dari rekap (read-only)

## 12. Dependencies & Sequencing

1. Install `exceljs` → `npm install exceljs`
2. Implement `src/lib/rekap/schemas.ts` (zod)
3. Implement `src/lib/rekap/query.ts` (query builder)
4. Implement `src/lib/rekap/excel.ts` (workbook builder)
5. Implement API routes (3 files)
6. Implement components (2 files)
7. Modify `src/app/admin/rekap/page.tsx` (tambah tab)
8. Write tests
9. Run gates: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
10. Manual QA di browser
11. Commit + push (jika user request)

## 13. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| ExcelJS bundle size jika dipakai di client | Server-side only (Route Handler Node runtime), tidak masuk client bundle |
| Performa query dengan ILIKE di banyak kolom | Index pada kolom yang sering di-search (opsional, tambah migration jika perlu) |
| Memory habis saat export 50000 baris | Hard cap + stream-like processing dengan chunk (exceljs batch row add) |
| RLS bocor data lintas layanan | Test manual: login sebagai Petugas A, coba query layanan B → harus 403 |
| PostgREST `or=` dengan embedded relation limitation | Pakai pola `or=(field1.ilike.%q%,kunjungan.nama.ilike.%q%,...)` — sudah ditest di PostgREST docs |
| exceljs + Node 22 compatibility | Cek requirement di docs; fallback ke `xlsx` jika exceljs tidak support Node 22 |
