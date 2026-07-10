-- ========================================================
-- MIGRATION: 023_revoke_hardcoded_accounts
-- Fase 0 / K4: Revoke akun hardcode dari migration 013/015
-- ========================================================
--
-- TUJUAN:
--   Menghapus 9 akun petugas yang dibuat dengan password hardcode
--   `password123` pada migration 013 dan 015. Akun-akun ini menjadi
--   vektor serangan karena siapa pun dengan akses repo dapat login.
--
-- PERINGATAN PENTING (PRODUKSI):
--   Migration ini bersifat DESTRUKTIF. Pada instance yang sudah
--   menjalankan migration 013/015, akun berikut akan DIHAPUS:
--     oss@lmh.go.id, halal@lmh.go.id, bpjs@lmh.go.id,
--     banklampung@lmh.go.id, umkm@lmh.go.id, gallery@lmh.go.id,
--     balmon@lmh.go.id, perikanan@lmh.go.id, industri@lmh.go.id
--
--   SEBELUM menerapkan migration ini di produksi:
--     1. Buat akun pengganti via invite Route Handler
--        (POST /api/admin/petugas/invite) untuk setiap petugas
--        yang masih aktif menggunakannya.
--     2. Rotasi password akun existing via Supabase Dashboard
--        (out-of-band, ditangani oleh admin/manusia).
--
--   Setelah migration ini berjalan, login lama dengan password
--   `password123` tidak lagi memungkinkan. Akun baru hanya dapat
--   dibuat via invite flow (magic-link recovery).
--
--   Pada instance fresh (yang baru menjalankan semua migration
--   dari awal), migration 013/015 masih membuat akun berpassword
--   `password123` lalu migration 023 menghapusnya — sehingga
--   state akhir bersih tanpa akun hardcode.
-- ========================================================

-- 1. Hapus baris petugas yang merujuk akun hardcode (via join ke auth.users)
DELETE FROM public.petugas
WHERE auth_user_id IN (
  SELECT id FROM auth.users
  WHERE email IN (
    'oss@lmh.go.id','halal@lmh.go.id','bpjs@lmh.go.id',
    'banklampung@lmh.go.id','umkm@lmh.go.id','gallery@lmh.go.id',
    'balmon@lmh.go.id','perikanan@lmh.go.id','industri@lmh.go.id'
  )
);

-- 2. Hapus user dari auth.users (cascade ke auth.identities)
DELETE FROM auth.users
WHERE email IN (
  'oss@lmh.go.id','halal@lmh.go.id','bpjs@lmh.go.id',
  'banklampung@lmh.go.id','umkm@lmh.go.id','gallery@lmh.go.id',
  'balmon@lmh.go.id','perikanan@lmh.go.id','industri@lmh.go.id'
);

-- Akun petugas baru HARUS dibuat via invite Route Handler:
--   POST /api/admin/petugas/invite
-- yang menggunakan Supabase Auth admin API (admin.createUser +
-- admin.generateLink) untuk provisioning magic-link, bukan
-- password hardcode. Lihat: src/app/api/admin/petugas/invite/route.ts
-- Untuk kebutuhan dev/staging, gunakan: supabase/seed-demo.sql

-- ROLLBACK:
--   Rollback TIDAK dapat memulihkan akun yang dihapus karena:
--     - Password hardcode `password123` tidak boleh dipulihkan
--       (itu adalah celah keamanan yang sedang diperbaiki).
--     - auth.users.id dihasilkan oleh gen_random_uuid() pada
--       migration asli — ID lama hilang setelah DELETE.
--   Jika akun petugas perlu dibuat ulang setelah rollback,
--   gunakan invite Route Handler (/api/admin/petugas/invite)
--   untuk provisioning akun baru dengan magic-link, ATAU jalankan
--   supabase/seed-demo.sql pada instance dev/staging saja.
--   JANGAN mengembalikan password hardcode ke migration manapun.
