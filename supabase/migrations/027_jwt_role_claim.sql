-- ============================================================
-- Migration 027: Fase 1 / A1 — Set role di JWT claims via auth hook
-- ============================================================
--
-- Fungsi ini dipanggil oleh Supabase Auth "JWT Hook" (GoTrue hook)
-- untuk mengisi `app_metadata.role` pada saat JWT diterbitkan.
-- Setelah hook dikonfigurasi, proxy.ts membaca role langsung dari
-- JWT — tidak perlu query tabel `petugas` di setiap request `/admin/*`.
--
-- Fallback: jika hook belum dikonfigurasi, proxy.ts tetap query
-- tabel `petugas` (lihat src/proxy.ts).
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_user_role_claim()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
STABLE
AS $$
  SELECT jsonb_build_object(
    'role',
    COALESCE(
      (SELECT role FROM public.petugas WHERE auth_user_id = auth.uid()),
      'pengunjung'
    )
  )
$$;

-- Cara konfigurasi (DASHBOARD ACTION - dilakukan manusia):
-- 1. Buka Supabase Dashboard → Authentication → Hooks
-- 2. Tambah "JWT Hook" yang memanggil fungsi public.set_user_role_claim()
-- 3. Setelah itu, setiap JWT yang diterbitkan akan berisi app_metadata.role
-- 4. proxy.ts akan baca role dari JWT, fallback ke DB query jika belum dikonfigurasi

-- ROLLBACK: DROP FUNCTION IF EXISTS public.set_user_role_claim();
