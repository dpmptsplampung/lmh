-- WP-21 / OPS-02: traceable one-time backfill and atomic visit dual-write.
-- `visit` remains the transition source of truth; this migration never mutates it.

BEGIN;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER TABLE public.kunjungan
  ADD COLUMN IF NOT EXISTS legacy_visit_id uuid REFERENCES public.visit(id) ON DELETE RESTRICT;
ALTER TABLE public.kunjungan
  DROP CONSTRAINT IF EXISTS kunjungan_legacy_visit_id_key;
ALTER TABLE public.kunjungan
  ADD CONSTRAINT kunjungan_legacy_visit_id_key UNIQUE (legacy_visit_id);

CREATE INDEX IF NOT EXISTS idx_kunjungan_legacy_visit_id
  ON public.kunjungan(legacy_visit_id) WHERE legacy_visit_id IS NOT NULL;

ALTER TABLE public.tiket_antrean
  ADD COLUMN IF NOT EXISTS legacy_visit_id uuid REFERENCES public.visit(id) ON DELETE RESTRICT;
ALTER TABLE public.tiket_antrean
  DROP CONSTRAINT IF EXISTS tiket_antrean_legacy_visit_id_key;
ALTER TABLE public.tiket_antrean
  ADD CONSTRAINT tiket_antrean_legacy_visit_id_key UNIQUE (legacy_visit_id);

DO $$
BEGIN
  IF to_regclass('public.wp21_backfill_ledger') IS NULL THEN
    CREATE TABLE public.wp21_backfill_ledger (
      visit_id uuid PRIMARY KEY REFERENCES public.visit(id) ON DELETE RESTRICT,
      kunjungan_id uuid REFERENCES public.kunjungan(id) ON DELETE RESTRICT,
      tiket_id uuid REFERENCES public.tiket_antrean(id) ON DELETE RESTRICT,
      buku_tamu_id uuid REFERENCES public.buku_tamu(id) ON DELETE RESTRICT,
      backed_up_at timestamptz NOT NULL DEFAULT now(),
      CHECK (
        (kunjungan_id IS NOT NULL AND buku_tamu_id IS NULL)
        OR (kunjungan_id IS NULL AND tiket_id IS NULL AND buku_tamu_id IS NOT NULL)
      )
    );
  END IF;
END $$;

ALTER TABLE public.wp21_backfill_ledger ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.wp21_backfill_ledger TO authenticated;
DROP POLICY IF EXISTS wp21_backfill_ledger_admin_read ON public.wp21_backfill_ledger;
CREATE POLICY wp21_backfill_ledger_admin_read ON public.wp21_backfill_ledger
  FOR SELECT TO authenticated USING (public.get_my_role() = 'admin');

-- Block concurrent source/target writes so the source snapshot and trigger handoff
-- cannot leave a visit between the backfill and dual-write phases.
LOCK TABLE public.visit, public.kunjungan, public.tiket_antrean, public.buku_tamu,
  public.wp21_backfill_ledger IN SHARE ROW EXCLUSIVE MODE;

-- This is deliberately all-or-nothing: a partially populated target cannot be
-- distinguished from a completed backfill without violating traceability.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.kunjungan)
    OR EXISTS (SELECT 1 FROM public.tiket_antrean)
    OR EXISTS (SELECT 1 FROM public.buku_tamu)
    OR EXISTS (SELECT 1 FROM public.wp21_backfill_ledger) THEN
    RAISE EXCEPTION 'WP-21 backfill requires empty kunjungan, tiket_antrean, buku_tamu, and ledger tables';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.visit
    WHERE tujuan = 'loket' AND layanan_id IS NULL
  ) THEN
    RAISE EXCEPTION 'WP-21 tidak dapat memetakan visit loket tanpa layanan_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.visit
    WHERE tujuan = 'bertemu_seseorang'
      AND waktu_scan IS NOT NULL
      AND nama_yang_ditemui IS NULL
  ) THEN
    RAISE EXCEPTION 'WP-21 tidak dapat memetakan kedatangan tamu tanpa nama_yang_ditemui';
  END IF;
END $$;

INSERT INTO public.kunjungan (
  legacy_visit_id, pengunjung_id, nama, kontak_hp, asal, qr_token,
  tanggal, waktu_masuk, status, created_at, updated_at
)
SELECT
  v.id,
  v.pengunjung_id,
  v.nama,
  v.kontak_hp,
  v.asal,
  v.qr_token,
  COALESCE(
    v.tanggal_rencana,
    (v.waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date,
    (v.created_at AT TIME ZONE 'Asia/Jakarta')::date
  ),
  COALESCE(v.waktu_masuk, v.created_at),
  v.status,
  v.created_at,
  v.updated_at
FROM public.visit AS v
WHERE v.tujuan = 'loket'
ORDER BY v.id
ON CONFLICT (legacy_visit_id) DO NOTHING;

INSERT INTO public.buku_tamu (
  legacy_visit_id, nama, asal, no_hp, menemui_siapa, keperluan,
  waktu_masuk, created_at
)
SELECT
  v.id,
  v.nama,
  v.asal_instansi,
  v.kontak_hp,
  v.nama_yang_ditemui,
  v.keperluan,
  COALESCE(v.waktu_scan, v.waktu_masuk, v.created_at),
  v.created_at
FROM public.visit AS v
WHERE v.tujuan = 'bertemu_seseorang'
  AND v.waktu_scan IS NOT NULL
ORDER BY v.id
ON CONFLICT (legacy_visit_id) DO NOTHING;

WITH historical_tickets AS (
  SELECT
    v.id AS visit_id,
    k.id AS kunjungan_id,
    v.layanan_id,
    k.tanggal,
    v.status,
    COALESCE(v.waktu_scan, v.waktu_masuk, v.created_at) AS waktu_terbit,
    v.waktu_mulai_layan,
    v.waktu_selesai,
    v.created_at,
    v.updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY v.layanan_id, k.tanggal
      ORDER BY COALESCE(v.waktu_masuk, v.created_at), v.id
    )::int AS nomor
  FROM public.visit AS v
  INNER JOIN public.kunjungan AS k ON k.legacy_visit_id = v.id
  WHERE v.tujuan = 'loket'
    AND v.status <> 'terjadwal'
    AND (
      v.asal = 'walk_in'
      OR (v.asal = 'reservasi' AND v.status <> 'terjadwal')
    )
)
INSERT INTO public.tiket_antrean (
  legacy_visit_id, kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status,
  waktu_terbit, waktu_mulai_layan, waktu_selesai, created_at, updated_at
)
SELECT
  h.visit_id,
  h.kunjungan_id,
  h.layanan_id,
  h.tanggal,
  h.nomor,
  COALESCE(l.prefiks_antrean, upper(substr(l.nama, 1, 1)))
    || '-' || lpad(h.nomor::text, 3, '0'),
  h.status,
  h.waktu_terbit,
  h.waktu_mulai_layan,
  h.waktu_selesai,
  h.created_at,
  h.updated_at
FROM historical_tickets AS h
INNER JOIN public.layanan AS l ON l.id = h.layanan_id
ORDER BY h.layanan_id, h.tanggal, h.nomor;

INSERT INTO public.wp21_backfill_ledger (
  visit_id, kunjungan_id, tiket_id, buku_tamu_id
)
SELECT
  v.id,
  k.id,
  t.id,
  NULL
FROM public.visit AS v
INNER JOIN public.kunjungan AS k ON k.legacy_visit_id = v.id
LEFT JOIN public.tiket_antrean AS t ON t.legacy_visit_id = v.id
WHERE v.tujuan = 'loket'
UNION ALL
SELECT
  v.id,
  NULL,
  NULL,
  b.id
FROM public.visit AS v
INNER JOIN public.buku_tamu AS b ON b.legacy_visit_id = v.id
WHERE v.tujuan = 'bertemu_seseorang';

INSERT INTO public.antrean_counter (layanan_id, tanggal, nomor_terakhir)
SELECT layanan_id, tanggal, max(nomor)
FROM public.tiket_antrean
GROUP BY layanan_id, tanggal
ON CONFLICT (layanan_id, tanggal) DO UPDATE
  SET nomor_terakhir = GREATEST(
    public.antrean_counter.nomor_terakhir,
    EXCLUDED.nomor_terakhir
  );

CREATE OR REPLACE FUNCTION public.sync_visit_dual_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_kunjungan_id uuid;
  v_tiket_id uuid;
  v_buku_tamu_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NOT (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.waktu_masuk IS DISTINCT FROM OLD.waktu_masuk
      OR NEW.waktu_scan IS DISTINCT FROM OLD.waktu_scan
      OR NEW.waktu_mulai_layan IS DISTINCT FROM OLD.waktu_mulai_layan
      OR NEW.waktu_selesai IS DISTINCT FROM OLD.waktu_selesai
    ) THEN
    RETURN NEW;
  END IF;

  IF NEW.tujuan = 'loket' THEN
    IF NEW.layanan_id IS NULL THEN
      RAISE EXCEPTION 'Kunjungan dual-write membutuhkan layanan_id untuk visit %', NEW.id;
    END IF;

    IF TG_OP = 'INSERT' THEN
      INSERT INTO public.kunjungan (
        legacy_visit_id, pengunjung_id, nama, kontak_hp, asal, qr_token,
        tanggal, waktu_masuk, status, created_at, updated_at
      ) VALUES (
        NEW.id, NEW.pengunjung_id, NEW.nama, NEW.kontak_hp, NEW.asal, NEW.qr_token,
        COALESCE(
          NEW.tanggal_rencana,
          (COALESCE(NEW.waktu_masuk, NEW.created_at) AT TIME ZONE 'Asia/Jakarta')::date
        ),
        COALESCE(NEW.waktu_masuk, NEW.created_at),
        NEW.status,
        NEW.created_at,
        NEW.updated_at
      ) ON CONFLICT (legacy_visit_id) DO NOTHING
      RETURNING id INTO v_kunjungan_id;

      SELECT id INTO v_kunjungan_id
      FROM public.kunjungan WHERE legacy_visit_id = NEW.id;

      IF NEW.asal = 'walk_in'
        AND NEW.status <> 'terjadwal'
        AND NOT EXISTS (
          SELECT 1
          FROM public.tiket_antrean AS t
          WHERE t.legacy_visit_id = NEW.id
        ) THEN
        v_tiket_id := public.terbit_tiket(v_kunjungan_id, NEW.layanan_id);
        UPDATE public.tiket_antrean
        SET legacy_visit_id = NEW.id
        WHERE id = v_tiket_id;
      END IF;
    ELSE
      SELECT k.id INTO v_kunjungan_id
      FROM public.kunjungan AS k
      WHERE k.legacy_visit_id = NEW.id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Kunjungan dual-write tidak ditemukan untuk visit %', NEW.id;
      END IF;

      UPDATE public.kunjungan
      SET status = NEW.status,
          waktu_masuk = COALESCE(NEW.waktu_masuk, public.kunjungan.waktu_masuk),
          updated_at = NEW.updated_at
      WHERE id = v_kunjungan_id;

      IF (
        (
          NEW.asal = 'walk_in'
          AND OLD.status = 'terjadwal'
          AND NEW.status = 'menunggu'
        )
        OR (
          NEW.asal = 'reservasi'
          AND OLD.status = 'terjadwal'
          AND NEW.status = 'menunggu'
          AND OLD.waktu_scan IS NULL
          AND NEW.waktu_scan IS NOT NULL
        )
      )
        AND NOT EXISTS (
          SELECT 1
          FROM public.tiket_antrean AS t
          WHERE t.legacy_visit_id = NEW.id
        ) THEN
        v_tiket_id := public.terbit_tiket(v_kunjungan_id, NEW.layanan_id);
        UPDATE public.tiket_antrean
        SET legacy_visit_id = NEW.id
        WHERE id = v_tiket_id;
      END IF;

      SELECT t.id INTO v_tiket_id
      FROM public.tiket_antrean AS t
      WHERE t.legacy_visit_id = NEW.id
      FOR UPDATE;

      IF FOUND THEN
        IF NEW.status = 'terjadwal' THEN
          RAISE EXCEPTION 'Tiket antrean tidak dapat kembali ke status terjadwal untuk visit %', NEW.id;
        END IF;

        UPDATE public.tiket_antrean
        SET status = NEW.status,
            waktu_mulai_layan = NEW.waktu_mulai_layan,
            waktu_selesai = NEW.waktu_selesai,
            updated_at = NEW.updated_at
        WHERE id = v_tiket_id;
      END IF;
    END IF;
  ELSIF NEW.tujuan = 'bertemu_seseorang' THEN
    IF NEW.waktu_scan IS NOT NULL AND NEW.nama_yang_ditemui IS NULL THEN
      RAISE EXCEPTION 'Buku tamu dual-write membutuhkan nama_yang_ditemui untuk visit %', NEW.id;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.status = 'menunggu' AND NEW.waktu_scan IS NOT NULL THEN
      INSERT INTO public.buku_tamu (
        legacy_visit_id, nama, asal, no_hp, menemui_siapa, keperluan, waktu_masuk
      ) VALUES (
        NEW.id,
        NEW.nama,
        NEW.asal_instansi,
        NEW.kontak_hp,
        NEW.nama_yang_ditemui,
        NEW.keperluan,
        COALESCE(NEW.waktu_scan, NEW.waktu_masuk, now())
      ) ON CONFLICT (legacy_visit_id) DO UPDATE
      SET waktu_masuk = EXCLUDED.waktu_masuk
      RETURNING id INTO v_buku_tamu_id;
    ELSIF TG_OP = 'UPDATE' THEN
      SELECT b.id INTO v_buku_tamu_id
      FROM public.buku_tamu AS b
      WHERE b.legacy_visit_id = NEW.id
      FOR UPDATE;

      IF FOUND THEN
        UPDATE public.buku_tamu
        SET waktu_masuk = COALESCE(NEW.waktu_scan, NEW.waktu_masuk, now())
        WHERE id = v_buku_tamu_id;
      ELSIF OLD.status IS DISTINCT FROM 'menunggu'
        AND NEW.status = 'menunggu'
        AND NEW.waktu_scan IS NOT NULL THEN
        INSERT INTO public.buku_tamu (
          legacy_visit_id, nama, asal, no_hp, menemui_siapa, keperluan, waktu_masuk
        ) VALUES (
          NEW.id,
          NEW.nama,
          NEW.asal_instansi,
          NEW.kontak_hp,
          NEW.nama_yang_ditemui,
          NEW.keperluan,
          COALESCE(NEW.waktu_scan, NEW.waktu_masuk, now())
        ) ON CONFLICT (legacy_visit_id) DO UPDATE
        SET waktu_masuk = EXCLUDED.waktu_masuk
        RETURNING id INTO v_buku_tamu_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.sync_visit_dual_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_visit_dual_write ON public.visit;
CREATE TRIGGER trg_visit_dual_write
AFTER INSERT OR UPDATE ON public.visit
FOR EACH ROW EXECUTE FUNCTION public.sync_visit_dual_write();

COMMIT;
