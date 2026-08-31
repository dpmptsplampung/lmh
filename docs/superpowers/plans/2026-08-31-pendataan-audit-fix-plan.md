# Plan Perbaikan Audit — Fitur Pendataan Pelayanan

- **Tanggal:** 2026-08-31
- **Basis:** commit `07482a1` (feat(pelayanan): wizard pendataan) di branch `development`
- **Sumber temuan:** audit manual API route, wizard modal, migrasi SQL, dan gate lint/typecheck/test
- **Aturan:** migrasi baru murni aditif (OPS-01), tidak mengubah tabel/flow existing; semua timestamp dari DB `now()` (I-09)

## Ringkasan Temuan → Perbaikan

| # | Temuan | Prioritas | Solusi |
|---|--------|-----------|--------|
| 1 | API tidak cek petugas vs layanan tiket | Sedang | Helper otorisasi bersama |
| 2 | Finalize tidak atomik, error update status diabaikan | Sedang | RPC `finalize_pelayanan()` |
| 3 | Upsert menimpa `petugas_id` → petugas asli kehilangan akses edit | Sedang | Pindah upsert ke RPC, `petugas_id` hanya di INSERT |
| 4 | Finalize bisa pada tiket yang belum `dilayani` | Sedang | Guard status di RPC |
| 5 | `asal_instansi` dipetakan ke `alamat_pemohon` | Minor | Field/prapopulasi dipisah jelas |
| 6 | Pesan error DB mentah bocor ke client | Minor | Generic error + log server |
| 7 | Timeout autosave tidak dibersihkan saat unmount | Minor | Cleanup useEffect |
| 8 | Logika `determineFormType`/`isLayananPendataan` terduplikasi 3 tempat | Minor | Ekstrak ke `src/lib/pelayanan.ts` |
| 9 | Coverage test API tipis (2 test / 413 baris) | Minor | Tambah test kasus penting |

## Fase 0 — Persiapan
- Buat branch `fix/pendataan-audit` dari `development`.
- Pastikan `git status` bersih sebelum mulai.

## Fase 1 — Ekstraksi Helper Bersama (Fix #1, #8)
**File:** `src/lib/pelayanan.ts` (BARU), `src/app/api/admin/pelayanan/[tiketId]/route.ts`, `src/app/admin/antrian/page.tsx`

1. Pindahkan `determineFormType` + `isLayananPendataan` ke `src/lib/pelayanan.ts` sebagai satu sumber kebenaran; route, halaman antrian, dan modal memakai helper ini.
2. Tambah helper otorisasi `canAccessPelayanan(staff, tiketLayananId)`:
   - `admin` / `front_office` → akses semua.
   - `petugas` → hanya jika `staff.layanan_id === tiket.layanan_id` (konsisten dengan policy RLS read).
3. Terapkan di GET, PATCH, POST setelah fetch tiket:
   - GET: pilih `layanan_id` sudah ada di select — tinggal cek.
   - PATCH/POST: tambahkan `layanan_id` ke select tiket.
   - Return `403 Forbidden` bila tidak berhak.

## Fase 2 — RPC Finalize Atomik (Fix #2, #3, #4)
**File:** `supabase/migrations/202608310001_finalize_pelayanan_rpc.sql` (BARU), `route.ts`, `supabase/migrations/migration-test-utils.ts` (daftarkan file migrasi baru), `supabase/migrations/pendataan_pelayanan.test.ts`

1. Buat fungsi `public.finalize_pelayanan(p_tiket_id uuid, p_form_type text, p_payload jsonb) RETURNS jsonb`:
   - `SECURITY DEFINER`, `SET search_path = pg_catalog, public`.
   - Validasi di dalam: role pemanggil (admin / petugas pemilik layanan), `tiket.status = 'dilayani'` (tolak jika belum/bukan), data belum `is_locked` (kecuali admin).
   - Upsert ke `pelayanan_oss` / `pelayanan_perizinan` via `INSERT ... ON CONFLICT (tiket_id) DO UPDATE SET ...` **tanpa** menyentuh `petugas_id` pada DO UPDATE (Fix #3), set `status_draft='selesai', is_locked=true`.
   - Update `visit` / `tiket_antrean` ke `selesai` dengan `waktu_selesai = now()` **dalam transaksi yang sama** (Fix #2).
   - Return `{ ok, waktu_selesai }` atau RAISE EXCEPTION dengan pesan jelas per kasus.
2. `GRANT EXECUTE` hanya ke `authenticated`; `REVOKE` dari `anon`/`PUBLIC`.
3. POST route.ts diganti jadi panggil `supabase.rpc('finalize_pelayanan', ...)`; map exception DB → HTTP 403/409/422 yang tepat, dan **jangan** kirim pesan error DB mentah ke client (Fix #6): log detail via `console.error`, balas pesan generik berbahasa Indonesia.
4. PATCH (draft) tetap via supabase-js upsert, tapi payload TIDAK lagi mengirim `petugas_id` saat baris sudah ada — gunakan pola: cek eksisting; jika ada → `update` (tanpa `petugas_id`), jika belum → `insert` (dengan `petugas_id`). Sederhana dan tanpa migrasi tambahan.

## Fase 3 — Perbaikan Minor UI/API (Fix #5, #6, #7)
**File:** `route.ts`, `PelayananWizardModal.tsx`

1. GET: hentikan pemetaan `asal_instansi → alamat_pemohon`. Tambah field `asal_instansi` pada `PelayananInitialData`, prapopulasi ke field yang benar di wizard (label "Asal Instansi / Instansi Pemohon" dipertahankan; `alamat_pemohon` kosong kecuali benar-benar alamat).
2. Semua `return NextResponse.json({ error: upsertErr.message })` diganti pesan generik (log detail di server).
3. Modal: tambah cleanup `clearTimeout(autosaveTimeoutRef.current)` pada unmount (useEffect return) agar tidak ada PATCH liar setelah modal ditutup.

## Fase 4 — Test (Fix #9)
**File:** `src/app/api/admin/pelayanan/[tiketId]/route.test.ts`, `supabase/migrations/pendataan_pelayanan.test.ts`, `PelayananWizardModal.test.tsx`

Kasus API baru (mengikuti pola mock yang ada):
1. Petugas layanan beda → 403 di GET/PATCH/POST.
2. Petugas pemilik layanan → 200/ok.
3. Draft autosave: baris baru → insert dengan petugas_id; baris eksisting → update tanpa mengubah petugas_id.
4. Finalize pada tiket belum `dilayani` → 409.
5. Finalize pada data terkunci (non-admin) → 403.
6. Test migrasi: fungsi `finalize_pelayanan` ada, `REVOKE` dari anon, `GRANT` ke authenticated, DO UPDATE tidak menyertakan `petugas_id`.
7. Test komponen: cleanup timer (tidak ada PATCH setelah unmount/close).

## Fase 5 — Verifikasi & Penutup
1. `npm run lint` → 0 warning.
2. `npm run typecheck` → bersih (hapus `.next/dev` dulu bila types korup).
3. `npm test` → semua pass termasuk test baru.
4. `npm run build` → sukses.
5. Baca diff final, scan secret, commit dengan pesan konvensional:
   `fix(pelayanan): otorisasi layanan, finalize atomik via RPC, dan perbaikan minor hasil audit`
6. **Tidak push** tanpa instruksi eksplisit user.

## Kriteria Selesai
- [ ] Semua temuan #1–#9 tertangani
- [ ] Lint + typecheck + test + build hijau
- [ ] Tidak ada perubahan pada tabel/flow existing (aditif murni)
- [ ] Pesan error client tidak membocorkan detail DB
