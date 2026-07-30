-- 202607290012_layanan_kontak_notifikasi.sql
-- WP-18 / NOT-01..07 / SVC-06: kontak institusional + notifikasi bersyarat + eskalasi.
--
-- Email layanan bersifat INSTITUSIONAL dan tidak berganti meski PIC berubah (menjawab
-- kebutuhan di balik RBA-07). ADITIF.

-- ============================================================
-- 1. Tabel layanan_kontak (NOT-01, SVC-06).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.layanan_kontak (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id    uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  email         text,
  peran         text CHECK (peran IN ('pic','atasan','cc')),
  aktif         boolean NOT NULL DEFAULT true,
  -- Kontak resmi instansi (SVC-06) untuk pengalihan saat alpa (P3):
  nama_pic      text,
  telepon_wa    text,
  alamat_kantor text,
  jam_layanan   text,
  tautan_online text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_layanan_kontak_layanan ON public.layanan_kontak(layanan_id) WHERE aktif;

ALTER TABLE public.layanan_kontak ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS layanan_kontak_public_read ON public.layanan_kontak;
CREATE POLICY layanan_kontak_public_read ON public.layanan_kontak FOR SELECT USING (aktif = true);
DROP POLICY IF EXISTS layanan_kontak_admin_write ON public.layanan_kontak;
CREATE POLICY layanan_kontak_admin_write ON public.layanan_kontak FOR ALL
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');

-- ============================================================
-- 2. Helper: email penerima per layanan per peran.
-- ============================================================
CREATE OR REPLACE FUNCTION public.email_layanan(p_layanan_id uuid, p_peran text)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(array_agg(email), '{}')
  FROM public.layanan_kontak
  WHERE layanan_id = p_layanan_id AND peran = p_peran AND aktif = true AND email IS NOT NULL
$$;

-- ============================================================
-- 3. Jumlah reservasi/antrean terdaftar untuk layanan pada suatu tanggal (untuk NOT-02
--    syarat ke-3: sudah ada yang mendaftar).
-- ============================================================
CREATE OR REPLACE FUNCTION public.jumlah_terdaftar(p_layanan_id uuid, p_tanggal date)
RETURNS int
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::int FROM public.visit
  WHERE layanan_id = p_layanan_id
    AND status IN ('terjadwal','menunggu','dilayani')
    AND (
      (asal = 'reservasi' AND tanggal_rencana = p_tanggal)
      OR ((waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date = p_tanggal)
    )
$$;

-- ============================================================
-- 4. NOT-02 + NOT-04: pengingat bersyarat & eskalasi berjenjang.
--    p_jenis: 'h1' (H-1 sore), 'pagi' (H-0 pagi), 'eskalasi' (lewat batas).
--    Mengirim 1 email per layanan per jenis per tanggal (idempoten, NOT-05).
-- ============================================================
CREATE OR REPLACE FUNCTION public.kirim_pengingat_petugas(p_jenis text, p_tanggal date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  rec record;
  v_count int := 0;
  v_emails text[];
  v_idem text;
  v_subjek text;
  v_body text;
  v_terdaftar int;
  v_layanan_nama text;
  v_batas time;
BEGIN
  FOR rec IN
    SELECT DISTINCT p.layanan_id
    FROM public.petugas p
    WHERE p.layanan_id IS NOT NULL AND p.aktif = true
      AND public.is_layanan_buka_jadwal(p.layanan_id, p_tanggal, NULL)
  LOOP
    SELECT nama INTO v_layanan_nama FROM public.layanan WHERE id = rec.layanan_id;
    v_terdaftar := public.jumlah_terdaftar(rec.layanan_id, p_tanggal);

    IF p_jenis IN ('h1','pagi') THEN
      -- Syarat 3: sudah ada yang terdaftar. Tanpa itu, jangan kirim (NOT-02).
      IF v_terdaftar = 0 THEN
        CONTINUE;
      END IF;
      -- Syarat 2 (hanya untuk 'pagi'): petugas belum absen hari itu.
      IF p_jenis = 'pagi' AND public.antrean_dibuka(rec.layanan_id, p_tanggal) THEN
        CONTINUE; -- sudah ada yang absen -> tidak perlu diingatkan
      END IF;

      v_emails := public.email_layanan(rec.layanan_id, 'pic');
      IF array_length(v_emails, 1) IS NULL THEN
        CONTINUE; -- tidak ada PIC terdaftar
      END IF;

      v_idem := format('pengingat:%s:%s:%s', rec.layanan_id, p_tanggal, p_jenis);
      v_subjek := CASE WHEN p_jenis = 'h1'
        THEN format('[LMH] Besok Anda standby: %s (%s reservasi)', v_layanan_nama, v_terdaftar)
        ELSE format('[LMH] Hari ini Anda standby: %s (%s reservasi, mohon absen di FO)', v_layanan_nama, v_terdaftar)
      END;
      v_body := CASE WHEN p_jenis = 'h1'
        THEN format(E'Yth. PIC %s,\n\nBesok (%s) Anda dijadwalkan standby di kantor DPMPTSP. Saat ini ada %s warga yang sudah terdaftar.\n\nMohon hadir tepat waktu. Terima kasih.', v_layanan_nama, p_tanggal, v_terdaftar)
        ELSE format(E'Yth. PIC %s,\n\nHari ini (%s) Anda dijadwalkan standby. Ada %s warga terdaftar.\n\nMohon segera absen di meja Front Office. Terima kasih.', v_layanan_nama, p_tanggal, v_terdaftar)
      END;

      INSERT INTO public.notifikasi (kanal, tujuan_email, subjek, body, status, idempotency_key, payload)
      SELECT 'email', e, v_subjek, v_body, 'pending', v_idem,
             jsonb_build_object('layanan_id', rec.layanan_id, 'tanggal', p_tanggal, 'jenis', p_jenis)
      FROM unnest(v_emails) AS e
      WHERE NOT EXISTS (SELECT 1 FROM public.notifikasi n WHERE n.idempotency_key = v_idem);

      IF FOUND THEN
        v_count := v_count + 1;
      END IF;

    ELSIF p_jenis = 'eskalasi' THEN
      -- Lewat batas absen & belum ada kehadiran -> eskalasi ke ATASAN + FO (bukan petugas).
      v_batas := COALESCE((SELECT value::time FROM public.site_settings WHERE key='batas_jam_alpa'), time '10:00');
      IF (now() AT TIME ZONE 'Asia/Jakarta')::time < v_batas THEN
        RETURN 0; -- belum lewat batas
      END IF;
      IF public.antrean_dibuka(rec.layanan_id, p_tanggal) THEN
        CONTINUE; -- sudah ada kehadiran
      END IF;

      v_emails := public.email_layanan(rec.layanan_id, 'atasan') || public.email_layanan(rec.layanan_id, 'cc');
      IF array_length(v_emails, 1) IS NULL THEN
        CONTINUE;
      END IF;

      v_idem := format('eskalasi:%s:%s', rec.layanan_id, p_tanggal);
      v_subjek := format('[LMH] Layanan %s belum ada kehadiran (%s warga terdampak)', v_layanan_nama, v_terdaftar);
      v_body := format(E'Yth. Bapak/Ibu Atasan & Front Office,\n\nSampai batas absen (%s WIB), layanan %s belum mencatat kehadiran hari ini (%s). Sebanyak %s warga terdampak.\n\nMohon tindak lanjut. Email ini dikirim otomatis oleh sistem.', v_batas, v_layanan_nama, p_tanggal, v_terdaftar);

      INSERT INTO public.notifikasi (kanal, tujuan_email, subjek, body, status, idempotency_key, payload)
      SELECT 'email', e, v_subjek, v_body, 'pending', v_idem,
             jsonb_build_object('layanan_id', rec.layanan_id, 'tanggal', p_tanggal, 'jenis', 'eskalasi', 'terdampak', v_terdaftar)
      FROM unnest(v_emails) AS e
      WHERE NOT EXISTS (SELECT 1 FROM public.notifikasi n WHERE n.idempotency_key = v_idem);

      IF FOUND THEN
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.kirim_pengingat_petugas(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_pengingat_petugas(text, date) TO service_role;

-- Cron: H-1 sore (16:00 WIB = 09:00 UTC) & pagi (07:00 WIB = 00:00 UTC) & eskalasi (tiap 15 mnt).
SELECT cron.schedule('notif_h1_sore',   '0 9 * * *',  $$SELECT public.kirim_pengingat_petugas('h1', ((now() AT TIME ZONE 'Asia/Jakarta')::date + 1))$$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='notif_h1_sore');
SELECT cron.schedule('notif_h0_pagi',   '0 0 * * *',  $$SELECT public.kirim_pengingat_petugas('pagi', (now() AT TIME ZONE 'Asia/Jakarta')::date)$$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='notif_h0_pagi');
SELECT cron.schedule('notif_eskalasi',  '*/15 * * * *', $$SELECT public.kirim_pengingat_petugas('eskalasi', (now() AT TIME ZONE 'Asia/Jakarta')::date)$$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='notif_eskalasi');

-- ============================================================
-- 5. NOT-07: metrik kepatuhan per layanan per rentang tanggal.
--    % hadir, hari alpa, warga terdampak, rata-rata keterlambatan absen (menit).
-- ============================================================
CREATE OR REPLACE FUNCTION public.metrik_kepatuhan(p_layanan_id uuid, p_awal date, p_akhir date)
RETURNS TABLE (
  hari_dijadwalkan int,
  hari_hadir int,
  hari_alpa int,
  persen_hadir numeric,
  warga_terdampak int,
  rata2_telat_menit numeric
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batas time := COALESCE((SELECT value::time FROM public.site_settings WHERE key='batas_jam_alpa'), time '10:00');
BEGIN
  RETURN QUERY
  WITH hari AS (
    SELECT d::date AS t
    FROM generate_series(p_awal, p_akhir, interval '1 day') d
    WHERE public.is_layanan_buka_jadwal(p_layanan_id, d::date, NULL)
  ),
  kehadiran AS (
    SELECT h.t,
      EXISTS (
        SELECT 1 FROM public.absensi_petugas a JOIN public.petugas p ON p.id=a.petugas_id
        WHERE p.layanan_id=p_layanan_id AND a.tanggal=h.t AND a.status='approved'
      ) AS hadir,
      (SELECT min(a.jam_masuk) FROM public.absensi_petugas a JOIN public.petugas p ON p.id=a.petugas_id
        WHERE p.layanan_id=p_layanan_id AND a.tanggal=h.t AND a.status='approved') AS jam_masuk
    FROM hari h
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE hadir)::int,
    count(*) FILTER (WHERE NOT hadir)::int,
    ROUND(100.0 * count(*) FILTER (WHERE hadir) / NULLIF(count(*),0), 1),
    COALESCE((SELECT count(*) FROM public.visit v
      WHERE v.layanan_id=p_layanan_id AND v.status='tidak_terlayani'
        AND (v.waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_awal AND p_akhir),0)::int,
    ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (jam_masuk::time - v_batas))/60) FILTER (WHERE hadir AND jam_masuk IS NOT NULL),0)::numeric, 1)
  FROM kehadiran;
END $$;

REVOKE ALL ON FUNCTION public.metrik_kepatuhan(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metrik_kepatuhan(uuid, date, date) TO authenticated;
