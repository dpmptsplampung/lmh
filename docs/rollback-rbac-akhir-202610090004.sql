-- Rollback manual migrasi 202610090004_kelola_layanan_audit.sql.
-- URUTAN ROLLBACK (kebalikan penerapan): 0005 -> 0004 -> 0003 -> 0002 -> 0001. Jangan melompati; lihat docs/RUNBOOK_RBAC_PENERAPAN.md.
-- PERINGATAN: menghapus kolom layanan.tampil_di_layar dan audit_log.nilai_lama/nilai_baru beserta ISINYA
-- (entri audit lama tetap ada, hanya nilai lama->baru hilang). Entri audit baru yang ditulis trigger
-- tetap tersimpan sebagai baris biasa. Mengembalikan hak tulis audit_log langsung oleh pengguna (celah S14).
-- Terapkan secara ATOMIK:  node scripts/apply-migration.mjs docs/rollback-rbac-akhir-202610090004.sql --atomic --yes

-- 3. Audit
DROP TRIGGER IF EXISTS trg_audit_petugas_ubah ON public.petugas;
CREATE TRIGGER trg_audit_petugas_role AFTER UPDATE OF role ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('update_role');
DROP TRIGGER IF EXISTS trg_audit_layar_token ON public.layar_token;
DROP TRIGGER IF EXISTS trg_audit_faq ON public.faq_knowledge_base;
DROP TRIGGER IF EXISTS trg_audit_landing_content ON public.landing_content;
DROP TRIGGER IF EXISTS trg_audit_site_settings ON public.site_settings;
DROP TRIGGER IF EXISTS trg_audit_layanan_libur ON public.layanan_libur;
DROP TRIGGER IF EXISTS trg_audit_layanan_jadwal ON public.layanan_jadwal;
DROP TRIGGER IF EXISTS trg_audit_layanan ON public.layanan;
DROP FUNCTION IF EXISTS public.audit_perubahan();
DROP FUNCTION IF EXISTS public.audit_saring(jsonb, text[]);

GRANT INSERT ON TABLE public.audit_log TO authenticated;
DROP POLICY IF EXISTS audit_log_insert_own ON public.audit_log;
CREATE POLICY audit_log_insert_own ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND actor_role = public.get_my_role()
  );
DROP INDEX IF EXISTS public.idx_audit_log_aksi;
DROP INDEX IF EXISTS public.idx_audit_log_entitas_waktu;
ALTER TABLE public.audit_log DROP COLUMN IF EXISTS nilai_baru, DROP COLUMN IF EXISTS nilai_lama;

-- 2. Buku tamu
DROP POLICY IF EXISTS buku_tamu_admin_delete ON public.buku_tamu;
DROP POLICY IF EXISTS buku_tamu_admin_update ON public.buku_tamu;
DROP POLICY IF EXISTS buku_tamu_staff_insert ON public.buku_tamu;
DROP POLICY IF EXISTS buku_tamu_staff_select ON public.buku_tamu;
DROP POLICY IF EXISTS buku_tamu_fo_admin_all ON public.buku_tamu;
CREATE POLICY buku_tamu_fo_admin_all ON public.buku_tamu
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','front_office'))
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));

-- 1. Layanan (view dikembalikan DULU sebelum kolom dihapus)
DROP VIEW IF EXISTS public.v_layanan_publik;
CREATE OR REPLACE VIEW public.v_layar_antrian AS
SELECT
  l.id          AS layanan_id,
  l.nama        AS layanan_nama,
  l.tipe,
  count(t.id) FILTER (WHERE t.status = 'menunggu')   AS antre_count,
  count(t.id) FILTER (WHERE t.status = 'dilayani')   AS dilayani_count,
  max(t.nomor)  FILTER (WHERE t.status = 'dilayani') AS nomor_sedang_dilayani,
  max(t.nomor_display) FILTER (WHERE t.status = 'dilayani') AS nomor_display_dilayani,
  COALESCE((
    SELECT avg(EXTRACT(EPOCH FROM (t2.waktu_selesai - t2.waktu_mulai_layan)) / 60.0)
    FROM public.tiket_antrean t2
    WHERE t2.layanan_id = l.id
      AND t2.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
      AND t2.waktu_selesai    IS NOT NULL
      AND t2.waktu_mulai_layan IS NOT NULL
  ), 15) AS estimasi_durasi_menit,
  count(t.id) FILTER (WHERE t.status = 'menunggu') * COALESCE((
    SELECT avg(EXTRACT(EPOCH FROM (t3.waktu_selesai - t3.waktu_mulai_layan)) / 60.0)
    FROM public.tiket_antrean t3
    WHERE t3.layanan_id = l.id
      AND t3.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
      AND t3.waktu_selesai    IS NOT NULL
      AND t3.waktu_mulai_layan IS NOT NULL
  ), 15) AS estimasi_tunggu_total_menit
FROM public.layanan l
LEFT JOIN public.tiket_antrean t
  ON  t.layanan_id = l.id
  AND t.status IN ('menunggu', 'dilayani')
  AND t.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
WHERE l.aktif = true
GROUP BY l.id, l.nama, l.tipe;
REVOKE ALL  ON public.v_layar_antrian FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_layar_antrian TO anon, authenticated;
COMMENT ON COLUMN public.layanan.status_tampilan IS NULL;
ALTER TABLE public.layanan DROP COLUMN IF EXISTS tampil_di_layar;
