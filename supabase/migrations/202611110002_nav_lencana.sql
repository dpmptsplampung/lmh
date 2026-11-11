-- 202611110002_nav_lencana.sql
-- Refaktor G2.2: lencana navigasi admin dalam SATU panggilan RPC (sebelumnya sampai 8 query head-count per tick
-- dari useNavBadges.ts). Predikat disalin satu per satu dari hitungBadge(); SECURITY INVOKER sehingga RLS
-- pemanggil tetap yang membatasi angka (tidak ada perluasan akses). Hanya menambah fungsi; rollback =
-- docs/rollback-nav-lencana-202611110002.sql.
--
-- Hasil jsonb (kunci yang tidak berhak untuk role pemanggil tidak ada):
--   kotakMasukFo {semua, kembali} | liveChat n | penangananFo n | antrian n | pengaduan n | saran n
-- Argumen tambahan p_hari_tanpa_layanan: keputusan "Layanan petugas tidak beroperasi hari ini" dihitung klien
-- (muatStatusLayananChat), bukan di sini; true menolkan liveChat persis seperti perilaku klien lama.

CREATE OR REPLACE FUNCTION public.nav_lencana_saya(
  p_tanggal date,
  p_hari_tanpa_layanan boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH me AS (
    SELECT s.id, s.role, s.layanan_id
    FROM public.petugas AS s
    WHERE s.auth_user_id = auth.uid() AND s.aktif = true
    LIMIT 1
  )
  SELECT COALESCE((
    SELECT jsonb_strip_nulls(jsonb_build_object(
      -- kotakMasukFo: admin, front_office
      'kotakMasukFo', CASE WHEN me.role IN ('admin', 'front_office') THEN jsonb_build_object(
        'semua', (SELECT count(*) FROM public.penanganan p
                  WHERE p.peran_tahap = 'fo' AND p.status = 'menunggu' AND p.saluran <> 'chat'),
        'kembali', (SELECT count(*) FROM public.penanganan p
                    WHERE p.peran_tahap = 'fo' AND p.status = 'menunggu' AND p.saluran <> 'chat' AND p.tahap_ke > 1)
      ) END,
      -- liveChat: admin, petugas, front_office
      'liveChat', CASE
        WHEN me.role NOT IN ('admin', 'petugas', 'front_office') THEN NULL
        WHEN p_hari_tanpa_layanan THEN 0
        WHEN me.role = 'front_office' THEN
          (SELECT count(*) FROM public.penanganan p
           WHERE p.saluran = 'chat' AND p.peran_tahap = 'fo' AND p.status = 'menunggu')
        WHEN me.role = 'petugas' AND me.layanan_id IS NOT NULL THEN
          (SELECT count(*) FROM public.chat_sesi c WHERE c.status = 'eskalasi' AND c.layanan_id = me.layanan_id)
        ELSE
          (SELECT count(*) FROM public.chat_sesi c WHERE c.status = 'eskalasi')
      END,
      -- penangananFo: admin, front_office (milik saya)
      'penangananFo', CASE WHEN me.role IN ('admin', 'front_office') THEN
        (SELECT count(*) FROM public.penanganan p
         WHERE p.peran_tahap = 'fo' AND p.status = 'berjalan' AND p.penangan_id = me.id) END,
      -- antrian: admin, petugas, front_office
      'antrian', CASE
        WHEN me.role = 'petugas' THEN
          CASE WHEN me.layanan_id IS NULL THEN NULL ELSE
            (SELECT count(*) FROM public.tiket_antrean t
             WHERE t.tanggal = p_tanggal AND t.status IN ('menunggu', 'dipanggil') AND t.layanan_id = me.layanan_id) END
        WHEN me.role IN ('admin', 'front_office') THEN
          (SELECT count(*) FROM public.tiket_antrean t WHERE t.tanggal = p_tanggal AND t.status = 'menunggu')
      END,
      -- pengaduan: admin (semua jalur), front_office (jalur layanan saja)
      'pengaduan', CASE
        WHEN me.role = 'admin' THEN
          (SELECT count(*) FROM public.pengaduan g WHERE g.status = 'baru')
        WHEN me.role = 'front_office' THEN
          (SELECT count(*) FROM public.pengaduan g WHERE g.status = 'baru' AND g.jalur = 'layanan')
      END,
      -- saran: admin, front_office
      'saran', CASE WHEN me.role IN ('admin', 'front_office') THEN
        (SELECT count(*) FROM public.saran r WHERE r.ditinjau_pada IS NULL) END
    ))
    FROM me
  ), '{}'::jsonb)
$$;

REVOKE EXECUTE ON FUNCTION public.nav_lencana_saya(date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nav_lencana_saya(date, boolean) TO authenticated;
