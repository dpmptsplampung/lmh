-- 202610140008_wp24_tutup_otomatis_retensi.sql
-- WP-24 / Tahap B9 lanjutan (B-DB2). Menjawab pertanyaan terbuka kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §9
-- butir 3 (tahap 'berjalan' yang lupa ditutup) dan butir 6 (retensi/anonimisasi kolom PII baru).
--
-- ISI
--   1. penanganan.batal_karena += 'tidak_ditutup' (CHECK penanganan_batal_karena_check diganti; nilai lama tetap sah).
--   2. tutup_penanganan_tertinggal() + job pg_cron 'penanganan_tutup_otomatis' (23:00 WIB = 16:00 UTC, setelah jam tutup
--      dan setelah sesi staf berakhir; TIDAK digabung ke job 16:00 agar petugas yang masih menuntaskan layanan terakhir
--      tidak terpotong). Untuk setiap kunjungan yang punya tahap 'berjalan' (non-chat, mulai hari ini atau lebih awal)
--      atau tiket 'dilayani' (tanggal <= hari ini, termasuk tiket lama tanpa tahap):
--        - tiket 'dilayani' -> 'selesai'; waktu_selesai SENGAJA DIBIARKAN NULL (durasi tidak diketahui) sehingga tidak
--          mencemari mv_estimasi_layanan dan rata_durasi rekap (keduanya mensyaratkan waktu_selesai terisi);
--        - tahap 'berjalan' -> 'batal' (batal_karena 'tidak_ditutup', selesai_at jam server, catatan sistem) + baris
--          audit_log 'tutup_otomatis_penanganan' (aktor system) per tahap;
--        - kunjungan 'dilayani' -> 'selesai' bila tak ada tahap/tiket lain yang terbuka.
--      KEPUTUSAN status kunjungan = 'selesai' (bukan 'tidak_terlayani'): tahap 'berjalan' berarti pengunjung SUDAH
--      ditemui dan dilayani staf; yang terlupa hanya penutupan catatan. 'tidak_terlayani' akan memalsukan statistik
--      (dipakai untuk "warga tidak terlayani" / metrik_kepatuhan) dan menutup hak pengunjung mengisi SKM. Kejujuran data
--      dijaga di tahapnya (batal/tidak_ditutup, tanpa topik/hasil) sehingga rekap performa per orang tetap menunjukkan
--      "lupa menutup". Akibat sadar: kunjungan itu memicu notifikasi SKM (trigger 202610140007) pada malam hari.
--      Tahap saluran 'chat' tidak disentuh (Tahap C).
--   3. anonymize_inactive_pengunjung() (job 'anonymize_inactive_pengunjung' 02:00 UTC yang sudah ada, tidak dijadwal
--      ulang) diperluas, batas 730 hari:
--        (a) pengunjung: perilaku lama apa adanya (updated_at > 730 hari, email terisi -> nama '[anonim]', email/foto NULL).
--            Trigger trg_jaga_nama_pengunjung (202610140006) membebaskan pemanggil tanpa auth.uid() (pg_cron), jadi
--            nama yang terkunci tetap teranonimkan.
--        (b) kunjungan bertanggal > 730 hari: nama '[anonim]', kontak_hp, email, asal_instansi, nama_yang_ditemui,
--            keperluan -> NULL.
--        (c) penanganan.catatan milik kunjungan itu -> '[anonim]' (tetap tidak kosong: CHECK tahap 'selesai' mewajibkan
--            catatan).
--        (d) arsip visit bertanggal > 730 hari: nama '[anonim]', kontak_hp, asal_instansi, keperluan, nama_yang_ditemui,
--            catatan_petugas -> NULL (lewat flag transaksi-lokal lmh.visit_arsip yang dihormati trg_visit_arsip).
--      TIDAK dicakup (pertanyaan terbuka): pelayanan_oss/pelayanan_perizinan (data pemohon), buku_tamu, chat.
--
-- SYARAT: 202610140007 (penjaga bagian 0). PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO):
--   node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic
-- Idempoten. Rollback: docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql (SEBELUM rollback 202610140007).

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.visit_arsip_jaga()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140007_wp24_akhiri_dual_write belum diterapkan (visit_arsip_jaga tidak ada)';
  END IF;
  IF pg_catalog.to_regclass('public.penanganan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel penanganan belum ada (202610140003)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron') THEN
    RAISE EXCEPTION 'PRASYARAT: ekstensi pg_cron (skema cron) tidak ada';
  END IF;
END $$;

-- ============================================================
-- 1. batal_karena += 'tidak_ditutup'
-- ============================================================
DO $$
DECLARE
  r record;
BEGIN
  -- Constraint kolom batal_karena (satu-satunya CHECK penanganan yang menyebut 'diambil_alih').
  FOR r IN
    SELECT c.conname FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.penanganan'::regclass AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'diambil_alih'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.penanganan DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.penanganan ADD CONSTRAINT penanganan_batal_karena_check
  CHECK (batal_karena IN ('dialihkan', 'diambil_alih', 'tidak_terlayani', 'tidak_ditutup'));

-- ============================================================
-- 2. Penutupan otomatis tahap 'berjalan' yang tertinggal
-- ============================================================
CREATE OR REPLACE FUNCTION public.tutup_penanganan_tertinggal()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today   date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_now     timestamptz := pg_catalog.now();
  v_catatan text := 'Ditutup otomatis oleh sistem: tahap tidak ditutup sampai akhir hari';
  v_jumlah  integer := 0;
  r         record;
  p         record;
BEGIN
  FOR r IN
    SELECT DISTINCT x.kunjungan_id
    FROM (
      SELECT q.kunjungan_id FROM public.penanganan AS q
      WHERE q.status = 'berjalan' AND q.saluran <> 'chat'
        AND (q.mulai_at AT TIME ZONE 'Asia/Jakarta')::date <= v_today
      UNION
      SELECT t.kunjungan_id FROM public.tiket_antrean AS t
      WHERE t.status = 'dilayani' AND t.tanggal <= v_today
        AND NOT EXISTS (SELECT 1 FROM public.penanganan AS c
                        WHERE c.tiket_id = t.id AND c.status = 'berjalan' AND c.saluran = 'chat')
    ) AS x
  LOOP
    -- Urutan kunci global: kunjungan -> tiket -> penanganan.
    PERFORM 1 FROM public.kunjungan AS k WHERE k.id = r.kunjungan_id FOR UPDATE;

    UPDATE public.tiket_antrean AS t
       SET status = 'selesai', updated_at = v_now
     WHERE t.kunjungan_id = r.kunjungan_id AND t.status = 'dilayani' AND t.tanggal <= v_today;

    FOR p IN
      UPDATE public.penanganan AS q
         SET status = 'batal', batal_karena = 'tidak_ditutup', selesai_at = v_now,
             catatan = COALESCE(q.catatan, v_catatan)
       WHERE q.kunjungan_id = r.kunjungan_id AND q.status = 'berjalan' AND q.saluran <> 'chat'
         AND (q.mulai_at AT TIME ZONE 'Asia/Jakarta')::date <= v_today
      RETURNING q.id, q.peran_tahap, q.layanan_id, q.tiket_id, q.penangan_id, q.mulai_at
    LOOP
      INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
      VALUES (
        NULL, 'system', 'tutup_otomatis_penanganan', 'penanganan', p.id::text,
        pg_catalog.jsonb_build_object('kunjungan_id', r.kunjungan_id, 'tiket_id', p.tiket_id, 'peran_tahap', p.peran_tahap,
          'layanan_id', p.layanan_id, 'penangan_id', p.penangan_id, 'mulai_at', p.mulai_at),
        pg_catalog.jsonb_build_object('status', 'berjalan'),
        pg_catalog.jsonb_build_object('status', 'batal', 'batal_karena', 'tidak_ditutup')
      );
    END LOOP;

    UPDATE public.kunjungan AS k
       SET status = 'selesai', updated_at = v_now
     WHERE k.id = r.kunjungan_id AND k.status = 'dilayani'
       AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x
                       WHERE x.kunjungan_id = r.kunjungan_id AND x.status IN ('menunggu', 'berjalan'))
       AND NOT EXISTS (SELECT 1 FROM public.tiket_antrean AS y
                       WHERE y.kunjungan_id = r.kunjungan_id AND y.status IN ('menunggu', 'dipanggil', 'dilayani'));

    v_jumlah := v_jumlah + 1;
  END LOOP;

  RETURN v_jumlah;
END $$;

REVOKE ALL ON FUNCTION public.tutup_penanganan_tertinggal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tutup_penanganan_tertinggal() TO service_role;

-- Jadwal: 23:00 WIB setiap hari (dijadwal ulang berdasarkan nama; idempoten).
DO $$
BEGIN
  PERFORM cron.unschedule(job.jobid) FROM cron.job AS job WHERE job.jobname = 'penanganan_tutup_otomatis';
  PERFORM cron.schedule('penanganan_tutup_otomatis', '0 16 * * *', 'SELECT public.tutup_penanganan_tertinggal()');
END $$;

-- ============================================================
-- 3. Retensi PII 730 hari (job anonymize_inactive_pengunjung yang sudah ada)
-- ============================================================
CREATE OR REPLACE FUNCTION public.anonymize_inactive_pengunjung()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batas date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 730;
BEGIN
  -- (a) Profil pengunjung tidak aktif (perilaku sebelum WP-24, apa adanya).
  UPDATE public.pengunjung
  SET nama = '[anonim]', email = NULL, foto_url = NULL
  WHERE updated_at < pg_catalog.now() - INTERVAL '730 days' AND email IS NOT NULL;

  -- (b) Kunjungan lama: kolom PII.
  UPDATE public.kunjungan AS k
     SET nama = '[anonim]', kontak_hp = NULL, email = NULL, asal_instansi = NULL,
         nama_yang_ditemui = NULL, keperluan = NULL
   WHERE k.tanggal < v_batas
     AND (k.nama IS DISTINCT FROM '[anonim]' OR k.kontak_hp IS NOT NULL OR k.email IS NOT NULL
          OR k.asal_instansi IS NOT NULL OR k.nama_yang_ditemui IS NOT NULL OR k.keperluan IS NOT NULL);

  -- (c) Catatan penanganan kunjungan lama (bisa memuat data pribadi yang diceritakan pengunjung).
  UPDATE public.penanganan AS p
     SET catatan = '[anonim]'
   WHERE p.catatan IS NOT NULL AND p.catatan <> '[anonim]'
     AND EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p.kunjungan_id AND k.tanggal < v_batas);

  -- (d) Arsip visit lama (penjaga trg_visit_arsip dilewati hanya di transaksi ini).
  PERFORM pg_catalog.set_config('lmh.visit_arsip', 'on', true);
  UPDATE public.visit AS v
     SET nama = '[anonim]', kontak_hp = NULL, asal_instansi = NULL, keperluan = NULL,
         nama_yang_ditemui = NULL, catatan_petugas = NULL
   WHERE COALESCE(v.tanggal_rencana, (v.created_at AT TIME ZONE 'Asia/Jakarta')::date) < v_batas
     AND (v.nama IS DISTINCT FROM '[anonim]' OR v.kontak_hp IS NOT NULL OR v.asal_instansi IS NOT NULL
          OR v.keperluan IS NOT NULL OR v.nama_yang_ditemui IS NOT NULL OR v.catatan_petugas IS NOT NULL);
  PERFORM pg_catalog.set_config('lmh.visit_arsip', 'off', true);
END $$;

REVOKE EXECUTE ON FUNCTION public.anonymize_inactive_pengunjung() FROM PUBLIC, anon, authenticated;
