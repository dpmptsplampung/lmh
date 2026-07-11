-- ============================================================
-- Migration 030: Fase 2 / I3: SKM (Survei Kepuasan Masyarakat) — PermenPANRB 14/2017
-- ============================================================
--
-- Komponen:
--   1. Tabel `skm_respons`   — 9 unsur kepuasan (skala 1-4) + saran
--   2. RLS policies          — petugas SELECT layanannya, admin ALL
--   3. Function `hitung_ikm` — agregasi IKM (Indeks Kepuasan Masyarakat) 25-100
--   4. GRANT EXECUTE         — anon + authenticated (transparansi publik)
--
-- Rumus IKM (PermenPANRB 14/2017):
--   NRR_per_unsur = AVG(nilai)              — nilai 1-4
--   NRR = SUM(NRR_per_unsur) / 9            — rata-rata 9 unsur (1-4)
--   IKM = NRR * 25                          — skala 25-100
--
-- Sumber data:
--   visit.qr_token (migration 029) — token akses SKM (publik, no login)
--   visit.status = 'selesai'       — trigger SKM tersedia
--   visit.layanan_id               — agregasi per layanan
--
-- Catatan keamanan:
--   INSERT skm_respons dilakukan via Route Handler (/api/skm/submit) dengan
--   validasi token visit. Jika RLS menolak (anon tidak bisa INSERT), Route
--   Handler fallback ke service-role client. Lihat brief I3 langkah 3.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Tabel skm_respons (audit §7.4)
-- ------------------------------------------------------------
CREATE TABLE skm_respons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visit(id) ON DELETE SET NULL,
  layanan_id UUID REFERENCES layanan(id) ON DELETE RESTRICT,
  -- 9 unsur PermenPANRB 14/2017, skala 1-4
  u1_persyaratan SMALLINT CHECK (u1_persyaratan BETWEEN 1 AND 4),
  u2_prosedur SMALLINT CHECK (u2_prosedur BETWEEN 1 AND 4),
  u3_waktu SMALLINT CHECK (u3_waktu BETWEEN 1 AND 4),
  u4_biaya SMALLINT CHECK (u4_biaya BETWEEN 1 AND 4),
  u5_produk SMALLINT CHECK (u5_produk BETWEEN 1 AND 4),
  u6_kompetensi SMALLINT CHECK (u6_kompetensi BETWEEN 1 AND 4),
  u7_perilaku SMALLINT CHECK (u7_perilaku BETWEEN 1 AND 4),
  u8_sarana SMALLINT CHECK (u8_sarana BETWEEN 1 AND 4),
  u9_pengaduan SMALLINT CHECK (u9_pengaduan BETWEEN 1 AND 4),
  saran TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE skm_respons IS 'SKM (Survei Kepuasan Masyarakat) — 9 unsur PermenPANRB 14/2017';
COMMENT ON COLUMN skm_respons.u1_persyaratan IS 'U1 Persyaratan (1-4)';
COMMENT ON COLUMN skm_respons.u2_prosedur IS 'U2 Prosedur (1-4)';
COMMENT ON COLUMN skm_respons.u3_waktu IS 'U3 Waktu (1-4)';
COMMENT ON COLUMN skm_respons.u4_biaya IS 'U4 Biaya (1-4)';
COMMENT ON COLUMN skm_respons.u5_produk IS 'U5 Produk (1-4)';
COMMENT ON COLUMN skm_respons.u6_kompetensi IS 'U6 Kompetensi (1-4)';
COMMENT ON COLUMN skm_respons.u7_perilaku IS 'U7 Perilaku (1-4)';
COMMENT ON COLUMN skm_respons.u8_sarana IS 'U8 Sarana (1-4)';
COMMENT ON COLUMN skm_respons.u9_pengaduan IS 'U9 Pengaduan (1-4)';

CREATE INDEX idx_skm_layanan ON skm_respons(layanan_id);
CREATE INDEX idx_skm_visit ON skm_respons(visit_id);
CREATE INDEX idx_skm_created ON skm_respons(created_at DESC);


-- ------------------------------------------------------------
-- 2. RLS policies
-- ------------------------------------------------------------
ALTER TABLE skm_respons ENABLE ROW LEVEL SECURITY;

-- Anon/authenticated INSERT dengan validasi token visit (validasi di Route Handler)
CREATE POLICY "skm_insert" ON skm_respons
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Petugas SELECT layanannya; admin ALL
CREATE POLICY "skm_select_staff" ON skm_respons
  FOR SELECT TO authenticated
  USING (
    layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  );


-- ------------------------------------------------------------
-- 3. Function hitung_ikm — agregasi IKM per layanan + periode
--    SECURITY DEFINER → bypass RLS (untuk transparansi publik)
--    NRR = AVG(9 unsur) / 9 ... lalu * 25 → skala 25-100
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hitung_ikm(p_layanan_id UUID, p_start DATE, p_end DATE)
RETURNS TABLE (layanan_id UUID, layanan_nama TEXT, ikm NUMERIC, responden INT)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT
    p_layanan_id,
    l.nama,
    AVG(
      (u1_persyaratan + u2_prosedur + u3_waktu + u4_biaya + u5_produk +
       u6_kompetensi + u7_perilaku + u8_sarana + u9_pengaduan) / 9.0
    ) * 25 AS ikm,
    COUNT(*)::int AS responden
  FROM skm_respons s
  JOIN layanan l ON l.id = p_layanan_id
  WHERE s.layanan_id = p_layanan_id
    AND s.created_at::date BETWEEN p_start AND p_end
  GROUP BY p_layanan_id, l.nama
$$;


-- ------------------------------------------------------------
-- 4. GRANT EXECUTE — transparansi publik (anon + authenticated)
-- ------------------------------------------------------------
GRANT EXECUTE ON FUNCTION hitung_ikm(UUID, DATE, DATE) TO anon, authenticated;


-- ============================================================
-- ROLLBACK:
--   -- Revoke grants
--   REVOKE EXECUTE ON FUNCTION hitung_ikm(UUID, DATE, DATE) FROM anon, authenticated;
--
--   -- Drop function
--   DROP FUNCTION IF EXISTS hitung_ikm(UUID, DATE, DATE);
--
--   -- Drop policies
--   DROP POLICY IF EXISTS "skm_select_staff" ON skm_respons;
--   DROP POLICY IF EXISTS "skm_insert" ON skm_respons;
--
--   -- Drop tabel
--   DROP TABLE IF EXISTS skm_respons;
-- ============================================================
