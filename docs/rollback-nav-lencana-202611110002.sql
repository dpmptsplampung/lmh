-- Rollback 202611110002_nav_lencana.sql: klien otomatis jatuh ke jalur query lama bila fungsi tidak ada.
DROP FUNCTION IF EXISTS public.nav_lencana_saya(date, boolean);
