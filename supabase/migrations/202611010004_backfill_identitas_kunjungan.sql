-- 202611010004_backfill_identitas_kunjungan.sql
-- BACKFILL DATA LAMA (keputusan pemilik 2026-10-27). MENGUBAH DATA NYATA: hanya pemilik yang menerapkan, setelah dry-run dan
-- setelah membaca daftar periksa di docs/MIGRATIONS.md. Terpisah dari 202611010003 agar logika bisa diterapkan tanpa data lama.
--
-- ISI
--   Mengisi KOLOM KOSONG pada `kunjungan` (email, kontak_hp, asal_instansi) dari formulir pendataan SELESAI terbaru
--   (pelayanan_oss / pelayanan_perizinan) pada kunjungan yang sama. TIDAK menimpa nilai yang sudah ada. Nilai pengganti
--   ("Tidak berlaku", "-", "Belum ada", dst.) dan nilai tak valid diabaikan (email format valid; HP 08xxxxxxxxxx;
--   instansi 3-120 karakter). Kunjungan teranonimkan ('[anonim]') dilewati. status tidak berubah, jadi tidak ada notifikasi
--   atau email survei baru yang terkirim.
--   Satu baris audit_log (aksi backfill_identitas_kunjungan) menyimpan jumlah dan, per kunjungan, kolom yang DIISI beserta
--   nilainya; dipakai docs/rollback-backfill-identitas-kunjungan-202611010004.sql untuk membalikkan.
-- SYARAT / URUTAN: setelah 202611010003 (email_nyata). Idempoten: dijalankan ulang tidak mengisi apa pun lagi.
-- PENERAPAN (pemilik; atomik; dry-run dulu):
--   node scripts/apply-migration.mjs supabase/migrations/202611010004_backfill_identitas_kunjungan.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202611010004_backfill_identitas_kunjungan.sql --atomic
-- ROLLBACK: docs/rollback-backfill-identitas-kunjungan-202611010004.sql.

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.email_nyata(text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202611010003_identitas_satu_kesatuan belum diterapkan';
  END IF;
END $$;

WITH formulir AS (
  SELECT o.kunjungan_id, o.email, o.no_hp, o.alamat_pemohon, o.updated_at FROM public.pelayanan_oss AS o
  WHERE o.status_draft = 'selesai'
  UNION ALL
  SELECT z.kunjungan_id, z.email, z.no_hp, z.alamat_pemohon, z.updated_at FROM public.pelayanan_perizinan AS z
  WHERE z.status_draft = 'selesai'
), terbaru AS (
  -- Per kolom, nilai nyata dari formulir selesai TERBARU yang memilikinya.
  SELECT f.kunjungan_id,
         (SELECT public.email_nyata(x.email) FROM formulir AS x
           WHERE x.kunjungan_id = f.kunjungan_id AND public.email_nyata(x.email) IS NOT NULL
           ORDER BY x.updated_at DESC LIMIT 1) AS email,
         (SELECT h.hp FROM (
             SELECT CASE WHEN pg_catalog.left(d.digit, 2) = '62' THEN '0' || pg_catalog.substr(d.digit, 3) ELSE d.digit END AS hp,
                    x.updated_at
             FROM formulir AS x
             CROSS JOIN LATERAL (SELECT pg_catalog.regexp_replace(COALESCE(x.no_hp, ''), '[^0-9]', '', 'g') AS digit) AS d
             WHERE x.kunjungan_id = f.kunjungan_id) AS h
           WHERE h.hp ~ '^08[1-9][0-9]{7,10}$'
           ORDER BY h.updated_at DESC LIMIT 1) AS hp,
         (SELECT pg_catalog.btrim(x.alamat_pemohon) FROM formulir AS x
           WHERE x.kunjungan_id = f.kunjungan_id
             AND pg_catalog.char_length(pg_catalog.btrim(COALESCE(x.alamat_pemohon, ''))) BETWEEN 3 AND 120
             AND pg_catalog.lower(pg_catalog.btrim(x.alamat_pemohon)) NOT IN ('-', '--', 'tidak berlaku', 'belum ada', 'tidak ada', 'n/a', 'na')
           ORDER BY x.updated_at DESC LIMIT 1) AS asal
  FROM (SELECT DISTINCT kunjungan_id FROM formulir) AS f
), isi AS (
  SELECT k.id,
         CASE WHEN pg_catalog.btrim(COALESCE(k.email, '')) = '' THEN t.email END AS email,
         CASE WHEN pg_catalog.btrim(COALESCE(k.kontak_hp, '')) = '' THEN t.hp END AS kontak_hp,
         CASE WHEN pg_catalog.btrim(COALESCE(k.asal_instansi, '')) = '' THEN t.asal END AS asal_instansi
  FROM public.kunjungan AS k
  JOIN terbaru AS t ON t.kunjungan_id = k.id
  WHERE k.nama <> '[anonim]'
), diubah AS (
  UPDATE public.kunjungan AS k
     SET email = COALESCE(i.email, k.email),
         kontak_hp = COALESCE(i.kontak_hp, k.kontak_hp),
         asal_instansi = COALESCE(i.asal_instansi, k.asal_instansi),
         updated_at = pg_catalog.now()
    FROM isi AS i
   WHERE k.id = i.id AND (i.email IS NOT NULL OR i.kontak_hp IS NOT NULL OR i.asal_instansi IS NOT NULL)
  RETURNING i.id, i.email, i.kontak_hp, i.asal_instansi
)
INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
SELECT NULL, 'sistem', 'backfill_identitas_kunjungan', 'kunjungan', '202611010004',
       pg_catalog.jsonb_build_object(
         'migrasi', '202611010004', 'jumlah', pg_catalog.count(*),
         'diisi', pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
           'id', d.id, 'email', d.email, 'kontak_hp', d.kontak_hp, 'asal_instansi', d.asal_instansi))))
FROM diubah AS d
HAVING pg_catalog.count(*) > 0;
