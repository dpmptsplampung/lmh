-- docs/rollback-backfill-identitas-kunjungan-202611010004.sql
-- Rollback 202611010004_backfill_identitas_kunjungan. HANYA pemilik, atomik, dry-run dulu:
--   node scripts/apply-migration.mjs docs/rollback-backfill-identitas-kunjungan-202611010004.sql --atomic --dry-run
-- Mengosongkan kembali HANYA kolom yang diisi backfill (daftar di audit_log aksi backfill_identitas_kunjungan) dan hanya bila
-- nilainya masih sama dengan yang diisi backfill (koreksi manual sesudahnya tidak disentuh).
UPDATE public.kunjungan AS k
   SET email = CASE WHEN d.email IS NOT NULL AND k.email = d.email THEN NULL ELSE k.email END,
       kontak_hp = CASE WHEN d.kontak_hp IS NOT NULL AND k.kontak_hp = d.kontak_hp THEN NULL ELSE k.kontak_hp END,
       asal_instansi = CASE WHEN d.asal_instansi IS NOT NULL AND k.asal_instansi = d.asal_instansi THEN NULL ELSE k.asal_instansi END,
       updated_at = pg_catalog.now()
  FROM (
    SELECT (e ->> 'id')::uuid AS id, e ->> 'email' AS email, e ->> 'kontak_hp' AS kontak_hp, e ->> 'asal_instansi' AS asal_instansi
    FROM public.audit_log AS a, pg_catalog.jsonb_array_elements(a.detail -> 'diisi') AS e
    WHERE a.aksi = 'backfill_identitas_kunjungan' AND a.entitas_id = '202611010004'
  ) AS d
 WHERE k.id = d.id;
