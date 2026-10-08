-- Rollback manual migrasi 202610090003_konsol_pengaturan.sql.
-- URUTAN ROLLBACK (kebalikan penerapan): 0005 -> 0004 -> 0003 -> 0002 -> 0001. Jangan melompati; lihat docs/RUNBOOK_RBAC_PENERAPAN.md.
-- PERINGATAN: menghapus pengaturan berversi, riwayat, dan rahasia terenkripsi (kunci API gateway).
-- Sistem kembali memakai env (LLM_CHAT_PROVIDERS / GEMINI_API_KEY); kunci perlu dimasukkan ulang bila migrasi diterapkan lagi.
-- Terapkan secara ATOMIK:  node scripts/apply-migration.mjs docs/rollback-rbac-konsol-202610090003.sql --atomic --yes
DROP FUNCTION IF EXISTS public.match_dokumen_layanan(extensions.vector, double precision, integer, uuid);
DROP FUNCTION IF EXISTS public.rollback_pengaturan(text, integer, uuid, text);
DROP FUNCTION IF EXISTS public.aktifkan_pengaturan(text, integer, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.simpan_draf_pengaturan(text, text, jsonb, uuid, text);
DROP TABLE IF EXISTS public.pengaturan_riwayat;
DROP TABLE IF EXISTS public.pengaturan_sistem;
DROP TABLE IF EXISTS public.rahasia_pengaturan;
