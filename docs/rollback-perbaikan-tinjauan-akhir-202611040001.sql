-- Rollback manual 202611040001 (perbaikan tinjauan akhir). Tanpa BEGIN/COMMIT: jalankan dengan --atomic.
-- Mengembalikan definisi sebelum berkas ini (sumber: 202611010001, 202611030011, 202611030013, 202611030014,
-- 202611030015, 202610290002, 202610090004). Tidak mengubah atau menghapus data.
-- Urutan: jalankan SEBELUM rollback 0015/0014/0013. Kembalikan klien dalam jendela yang sama:
--   route /api/saran kembali memakai klien sesi dan pembatas laju lokal (GRANT anon/authenticated dipulihkan,
--   catat_laju_publik dibuang di bawah), klien Kunjungan
--   memakai fallback 3 argumen (fo_kunjungan_daftar 5 argumen dibuang, 3 argumen dibuat ulang).
-- Catatan: GRANT service_role pada kirim_saran_publik dibiarkan (hak bawaan Supabase, tidak membuka apa pun).

-- 1. fo_ambil_pengunjung (202611010001)
CREATE OR REPLACE FUNCTION public.fo_ambil_pengunjung(p_id uuid)
RETURNS TABLE (nama text, asal_instansi text, kategori text, email text, kontak_hp text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role   text;
  v_batas  date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 730;
  v_jumlah int;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Front Office atau Admin aktif' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: pengunjung tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  SELECT pg_catalog.count(*) INTO v_jumlah
  FROM public.audit_log AS a
  WHERE a.actor_id = auth.uid() AND a.aksi = 'fo_ambil_pengunjung'
    AND a.created_at > pg_catalog.now() - INTERVAL '10 minutes';
  IF v_jumlah >= 60 THEN
    RAISE EXCEPTION 'RATE_LIMIT: terlalu banyak pengambilan data pengunjung; coba lagi beberapa menit lagi' USING ERRCODE = '54000';
  END IF;

  RETURN QUERY
  SELECT k.nama, k.asal_instansi, k.kategori, k.email, k.kontak_hp
  FROM public.kunjungan AS k
  WHERE k.id = p_id
    AND k.nama <> '[anonim]'
    AND k.asal_instansi IS NOT NULL AND pg_catalog.btrim(k.asal_instansi) <> ''
    AND k.tanggal >= v_batas;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pengunjung tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
  VALUES (
    auth.uid(), v_role, 'fo_ambil_pengunjung', 'kunjungan', p_id::text,
    pg_catalog.jsonb_build_object('kunjungan_id', p_id)
  );
END $$;
REVOKE ALL ON FUNCTION public.fo_ambil_pengunjung(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_ambil_pengunjung(uuid) TO authenticated;
COMMENT ON FUNCTION public.fo_ambil_pengunjung(uuid) IS
  'Fase 6 (202611010001): identitas penuh satu kunjungan terpilih untuk mengisi formulir; FO/admin; diaudit dan dibatasi 60/10 menit.';

-- 2. kirim_saran_publik (202611030011)
REVOKE ALL ON FUNCTION public.kirim_saran_publik(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_saran_publik(text, text) TO anon, authenticated;
-- Penghitung laju bersama dibuang (route lama memakai Map lokal). Baris anon_rate_limit ber-user_id NULL dibiarkan;
-- prune_anon_rate_limit membersihkannya setelah 7 hari.
DROP FUNCTION IF EXISTS public.catat_laju_publik(text, text, integer, integer);

-- 3. Pemicu pengaduan baru dibuang (pemicu 0010/0013 tidak disentuh)
DROP TRIGGER IF EXISTS trg_pengaduan_kolom_kerja ON public.pengaduan;
DROP TRIGGER IF EXISTS trg_riwayat_status ON public.pengaduan_riwayat;
DROP FUNCTION IF EXISTS public.jaga_kolom_pengaduan();
DROP FUNCTION IF EXISTS public.jaga_riwayat_status();

-- 4. linimasa_pengaduan dan v_pengaduan_kerja (202611030013)
CREATE OR REPLACE FUNCTION public.linimasa_pengaduan(p_pengaduan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_jalur   text;
  v_arr     jsonb;
  v_tambah  jsonb := '[]'::jsonb;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office yang boleh membaca riwayat pengaduan' USING ERRCODE = '42501';
  END IF;
  SELECT g.jalur INTO v_jalur FROM public.pengaduan AS g WHERE g.id = p_pengaduan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN: pengaduan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_me_role = 'front_office' AND v_jalur <> 'layanan' THEN
    RAISE EXCEPTION 'FORBIDDEN: pengaduan jalur integritas hanya untuk Admin' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           CASE WHEN r.jenis = 'status' THEN
             pg_catalog.jsonb_build_object('jenis', 'status', 'waktu', r.created_at, 'oleh_nama', po.nama,
               'status_lama', r.status_lama, 'status_baru', r.status_baru, 'catatan', r.catatan)
           ELSE
             pg_catalog.jsonb_build_object('jenis', 'penangan', 'aksi', r.jenis, 'waktu', r.created_at,
               'oleh_nama', po.nama, 'dari_nama', pl.nama, 'ke_nama', pb.nama, 'alasan', r.catatan)
           END), '[]'::jsonb)
  INTO v_arr
  FROM public.pengaduan_riwayat AS r
  LEFT JOIN public.petugas AS po ON po.id = r.diubah_oleh
  LEFT JOIN public.petugas AS pl ON pl.id = r.penangan_lama
  LEFT JOIN public.petugas AS pb ON pb.id = r.penangan_baru
  WHERE r.pengaduan_id = p_pengaduan_id;

  IF pg_catalog.to_regclass('public.pengaduan_tanggapan') IS NOT NULL THEN
    IF pg_catalog.to_regclass('public.pengaduan_lampiran') IS NOT NULL THEN
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'jenis', 'tanggapan', 'waktu', t.created_at, 'oleh_nama', po.nama, 'isi', t.isi,
               'status_baru', t.status_baru, 'kirim_email', t.kirim_email,
               'lampiran', COALESCE((
                 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('nama', a.nama_asli, 'mime', a.mime, 'ukuran', a.ukuran)
                                             ORDER BY a.created_at, a.id)
                 FROM public.pengaduan_lampiran AS a WHERE a.tanggapan_id = t.id), '[]'::jsonb))), '[]'::jsonb)
      INTO v_tambah
      FROM public.pengaduan_tanggapan AS t
      LEFT JOIN public.petugas AS po ON po.id = t.dibuat_oleh
      WHERE t.pengaduan_id = p_pengaduan_id;
    ELSE
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'jenis', 'tanggapan', 'waktu', t.created_at, 'oleh_nama', po.nama, 'isi', t.isi,
               'status_baru', t.status_baru, 'kirim_email', t.kirim_email, 'lampiran', '[]'::jsonb)), '[]'::jsonb)
      INTO v_tambah
      FROM public.pengaduan_tanggapan AS t
      LEFT JOIN public.petugas AS po ON po.id = t.dibuat_oleh
      WHERE t.pengaduan_id = p_pengaduan_id;
    END IF;
  END IF;

  RETURN (
    SELECT COALESCE(pg_catalog.jsonb_agg(x.e ORDER BY (x.e ->> 'waktu')::timestamptz, x.urut), '[]'::jsonb)
    FROM pg_catalog.jsonb_array_elements(v_arr || v_tambah) WITH ORDINALITY AS x(e, urut)
  );
END $$;
REVOKE ALL ON FUNCTION public.linimasa_pengaduan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linimasa_pengaduan(uuid) TO authenticated;

-- CREATE OR REPLACE VIEW tidak dapat membuang kolom ada_bukti; view tanpa data (security_invoker) dibuat ulang.
DROP VIEW IF EXISTS public.v_pengaduan_kerja;
CREATE OR REPLACE VIEW public.v_pengaduan_kerja
WITH (security_invoker = true) AS
SELECT g.id, g.nomor_tiket, g.jalur, g.layanan_id, l.nama AS layanan_nama, g.isi, g.anonim,
       CASE WHEN g.anonim THEN NULL ELSE g.pelapor_nama END AS pelapor_nama,
       (NOT g.anonim AND (g.kontak IS NOT NULL OR (pg_catalog.to_jsonb(g) ->> 'pelapor_email') IS NOT NULL)) AS bisa_dihubungi,
       g.sumber, g.status, g.lampiran_path,
       s.terbuka, s.kelompok, g.batas_verifikasi, g.batas_penanganan, s.batas_aktif, s.sisa_hari_kerja, s.sla_status,
       s.urutan_kerja, g.penangan_id, pt.nama AS penangan_nama, g.penangan_sejak, g.created_at, g.updated_at
FROM public.pengaduan AS g
LEFT JOIN public.layanan AS l ON l.id = g.layanan_id
LEFT JOIN public.petugas AS pt ON pt.id = g.penangan_id
CROSS JOIN LATERAL public.pengaduan_sla(g.status, g.batas_verifikasi, g.batas_penanganan) AS s;
REVOKE ALL ON public.v_pengaduan_kerja FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pengaduan_kerja TO authenticated;

-- 5. Daftar FO (202611030015)
CREATE OR REPLACE FUNCTION public.fo_antrean_daftar(
  p_tanggal date, p_layanan_id uuid DEFAULT NULL,
  p_batas integer DEFAULT 50, p_lewati integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_total bigint;
  v_selesai bigint;
  v_rata numeric;
  v_rows jsonb;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office aktif' USING ERRCODE = '42501';
  END IF;
  IF p_tanggal IS NULL OR p_batas IS NULL OR p_batas NOT BETWEEN 1 AND 200
     OR p_lewati IS NULL OR p_lewati NOT BETWEEN 0 AND 2000000 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: tanggal, batas, atau halaman tidak valid' USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE t.status = 'selesai'),
         pg_catalog.round(pg_catalog.avg(EXTRACT(EPOCH FROM (t.waktu_selesai - t.waktu_mulai_layan)) / 60)
           FILTER (WHERE t.status = 'selesai' AND t.waktu_selesai >= t.waktu_mulai_layan))
  INTO v_total, v_selesai, v_rata
  FROM public.tiket_antrean AS t
  WHERE t.tanggal = p_tanggal AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id);

  WITH halaman AS (
    SELECT t.id, t.kunjungan_id, t.layanan_id, t.dilayani_oleh, t.penanganan_asal_id, t.nomor,
           t.nomor_display, t.status, t.waktu_terbit, t.waktu_mulai_layan, t.waktu_selesai
    FROM public.tiket_antrean AS t
    WHERE t.tanggal = p_tanggal AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id)
    ORDER BY t.nomor, t.id LIMIT p_batas OFFSET p_lewati
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', h.id, 'kunjungan_id', h.kunjungan_id, 'layanan_id', h.layanan_id,
    'dilayani_oleh', h.dilayani_oleh, 'penanganan_asal_id', h.penanganan_asal_id,
    'nomor', h.nomor, 'nomor_display', h.nomor_display, 'status', h.status,
    'waktu_terbit', h.waktu_terbit, 'waktu_mulai_layan', h.waktu_mulai_layan, 'waktu_selesai', h.waktu_selesai,
    'layanan', pg_catalog.jsonb_build_object('nama', l.nama, 'form_pendataan', l.form_pendataan),
    'pelayan', CASE WHEN pg.id IS NOT NULL THEN pg_catalog.jsonb_build_object('nama', pg.nama) END,
    'kunjungan', CASE WHEN k.id IS NOT NULL THEN pg_catalog.jsonb_build_object('nama', k.nama, 'asal', k.asal, 'waktu_masuk', k.waktu_masuk) END,
    'fo_nama', COALESCE(fo.nama, CASE WHEN pembuat.role IN ('front_office', 'admin') THEN pembuat.nama END)
  ) ORDER BY h.nomor, h.id), '[]'::jsonb) INTO v_rows
  FROM halaman AS h
  LEFT JOIN public.kunjungan AS k ON k.id = h.kunjungan_id
  LEFT JOIN public.layanan AS l ON l.id = h.layanan_id
  LEFT JOIN public.petugas AS pg ON pg.id = h.dilayani_oleh
  LEFT JOIN public.petugas AS pembuat ON pembuat.id = k.dibuat_oleh
  LEFT JOIN LATERAL (
    SELECT pf.nama FROM public.penanganan AS p
    JOIN public.petugas AS pf ON pf.id = p.penangan_id
    WHERE p.kunjungan_id = h.kunjungan_id AND p.peran_tahap = 'fo'
    ORDER BY p.tahap_ke DESC LIMIT 1
  ) AS fo ON true;
  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'total', v_total,
    'statistik', pg_catalog.jsonb_build_object('totalSelesai', v_selesai, 'rataWaktuMenit', COALESCE(v_rata, 0)));
END $$;
REVOKE ALL ON FUNCTION public.fo_antrean_daftar(date, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_antrean_daftar(date, uuid, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.fo_antrean_daftar(date, uuid, integer, integer) IS NULL;

DROP FUNCTION IF EXISTS public.fo_kunjungan_daftar(date, integer, integer, text, text);
CREATE OR REPLACE FUNCTION public.fo_kunjungan_daftar(
  p_tanggal date, p_batas integer DEFAULT 50, p_lewati integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office aktif' USING ERRCODE = '42501';
  END IF;
  IF p_tanggal IS NULL OR p_batas IS NULL OR p_batas NOT BETWEEN 1 AND 200
     OR p_lewati IS NULL OR p_lewati NOT BETWEEN 0 AND 2000000 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: tanggal, batas, atau halaman tidak valid' USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.count(*) INTO v_total FROM public.kunjungan AS k WHERE k.tanggal = p_tanggal;
  WITH halaman AS (
    SELECT k.id, k.nama, k.asal, k.status, k.waktu_masuk, k.tanggal, k.dibuat_oleh
    FROM public.kunjungan AS k WHERE k.tanggal = p_tanggal
    ORDER BY k.waktu_masuk DESC NULLS LAST, k.id LIMIT p_batas OFFSET p_lewati
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', h.id, 'nama', h.nama, 'asal', h.asal, 'status', h.status,
    'waktu_masuk', h.waktu_masuk, 'tanggal', h.tanggal,
    'fo_nama', COALESCE(fo.nama, CASE WHEN pembuat.role IN ('front_office', 'admin') THEN pembuat.nama END),
    'tiket_antrean', COALESCE(tiket.baris, '[]'::jsonb)
  ) ORDER BY h.waktu_masuk DESC NULLS LAST, h.id), '[]'::jsonb) INTO v_rows
  FROM halaman AS h
  LEFT JOIN public.petugas AS pembuat ON pembuat.id = h.dibuat_oleh
  LEFT JOIN LATERAL (
    SELECT pf.nama FROM public.penanganan AS p JOIN public.petugas AS pf ON pf.id = p.penangan_id
    WHERE p.kunjungan_id = h.id AND p.peran_tahap = 'fo'
    ORDER BY p.tahap_ke DESC LIMIT 1
  ) AS fo ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'nomor_display', t.nomor_display, 'waktu_selesai', t.waktu_selesai,
      'layanan', pg_catalog.jsonb_build_object('nama', l.nama)
    ) ORDER BY t.waktu_terbit, t.id) AS baris
    FROM public.tiket_antrean AS t LEFT JOIN public.layanan AS l ON l.id = t.layanan_id
    WHERE t.kunjungan_id = h.id
  ) AS tiket ON true;
  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;
REVOKE ALL ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer) TO authenticated;

-- 6. Inti rekap (202610290002)
CREATE OR REPLACE FUNCTION public.rekap_pelayanan_inti(
  p_dari       date,
  p_sampai     date,
  p_unit       text,
  p_layanan_id uuid
)
RETURNS TABLE (
  pelayanan_id uuid,
  sumber       text,
  tanggal      date,
  urut         timestamptz,
  kunjungan_id uuid,
  tiket_id     uuid,
  tahap_ke     integer,
  unit         text,
  layanan_id   uuid,
  kanal        text,
  penangan_id  uuid,
  hasil        text,
  topik        text,
  catatan      text,
  mulai_at     timestamptz,
  selesai_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_id       uuid;
  v_role     text;
  v_layanan  uuid;
  v_koord    boolean;
  v_semua    boolean;
  v_unit_lyn uuid;
BEGIN
  IF p_dari IS NULL OR p_sampai IS NULL OR p_sampai < p_dari OR p_sampai - p_dari >= 366 THEN
    RAISE EXCEPTION 'RENTANG_TIDAK_VALID: rentang tanggal wajib diisi, urut, dan paling lama 366 hari'
      USING ERRCODE = '22023';
  END IF;
  IF p_unit IS NOT NULL AND p_unit NOT IN ('fo', 'layanan') THEN
    RAISE EXCEPTION 'UNIT_TIDAK_VALID: unit harus fo atau layanan' USING ERRCODE = '22023';
  END IF;
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_id, v_role, v_layanan, v_koord
  FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN;
  END IF;
  -- Lingkup ketat (§6.1): admin dan FO+Koordinator semua; Petugas+Koordinator unit layanannya; selain itu milik sendiri.
  v_semua := v_role = 'admin' OR (v_role = 'front_office' AND v_koord);
  v_unit_lyn := CASE WHEN v_role = 'petugas' AND v_koord THEN v_layanan END;

  RETURN QUERY
  -- A. Tahap penanganan selesai (alur Front Office -> eskalasi, chat).
  SELECT p.id, 'penanganan'::text, k.tanggal, COALESCE(p.mulai_at, p.selesai_at), p.kunjungan_id, p.tiket_id,
         p.tahap_ke, p.peran_tahap, p.layanan_id,
         CASE WHEN p.saluran = 'chat' THEN 'live_chat' ELSE 'tatap_muka' END,
         p.penangan_id, p.hasil, p.topik, p.catatan, p.mulai_at, p.selesai_at
  FROM public.penanganan AS p
  JOIN public.kunjungan AS k ON k.id = p.kunjungan_id
  WHERE p.status = 'selesai'
    AND NOT (p.peran_tahap = 'layanan' AND p.hasil = 'dikembalikan')
    AND k.tanggal BETWEEN p_dari AND p_sampai
    AND (p_unit IS NULL OR p.peran_tahap = p_unit)
    AND (p_layanan_id IS NULL OR p.layanan_id = p_layanan_id)
    AND (v_semua OR p.penangan_id = v_id
         OR (v_unit_lyn IS NOT NULL AND p.peran_tahap = 'layanan' AND p.layanan_id = v_unit_lyn))
  UNION ALL
  -- B. Tiket lama (sebelum alur penanganan) yang benar-benar diselesaikan; Pendataan draf tidak dihitung.
  SELECT t.id, 'tiket_lama'::text, COALESCE(k.tanggal, t.tanggal), COALESCE(t.waktu_mulai_layan, t.waktu_selesai),
         t.kunjungan_id, t.id, NULL::integer, 'layanan'::text, t.layanan_id, 'tatap_muka'::text,
         COALESCE(o.petugas_id, pz.petugas_id, t.dilayani_oleh), 'selesai'::text, NULL::text, NULL::text,
         t.waktu_mulai_layan, t.waktu_selesai
  FROM public.tiket_antrean AS t
  LEFT JOIN public.kunjungan AS k ON k.id = t.kunjungan_id
  LEFT JOIN public.pelayanan_oss AS o ON o.tiket_id = t.id
  LEFT JOIN public.pelayanan_perizinan AS pz ON pz.tiket_id = t.id
  WHERE t.status = 'selesai'
    AND t.waktu_selesai IS NOT NULL
    AND COALESCE(k.tanggal, t.tanggal) BETWEEN p_dari AND p_sampai
    AND (p_unit IS NULL OR p_unit = 'layanan')
    AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id)
    AND NOT EXISTS (SELECT 1 FROM public.penanganan AS p2 WHERE p2.tiket_id = t.id)
    AND COALESCE(o.status_draft, pz.status_draft, 'selesai') = 'selesai'
    AND (v_semua OR COALESCE(o.petugas_id, pz.petugas_id, t.dilayani_oleh) = v_id
         OR (v_unit_lyn IS NOT NULL AND t.layanan_id = v_unit_lyn));
END $$;
REVOKE ALL ON FUNCTION public.rekap_pelayanan_inti(date, date, text, uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.rekap_pelayanan_inti(date, date, text, uuid) IS
  '202610290002: dasar rekap terpadu, satu baris per pelayanan dilayani (tahap selesai kecuali layanan dikembalikan / tiket lama selesai ber-waktu_selesai non-draf), lingkup ketat §6.1. Internal.';

-- 7. Ringkasan dilayani (202611030015)
CREATE OR REPLACE FUNCTION public.rekap_ringkasan_dilayani(
  p_dari date, p_sampai date, p_unit text DEFAULT NULL,
  p_layanan_id uuid DEFAULT NULL, p_tanpa_form boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_layanan uuid;
  v_koord boolean;
  v_saya bigint;
  v_total bigint;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role, me.layanan_id, me.koordinator INTO v_role, v_layanan, v_koord FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office', 'petugas') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  -- FO biasa membandingkan pelayanan FO, bukan kerja Petugas yang menerima eskalasinya.
  IF v_role = 'front_office' AND NOT v_koord AND p_unit IS NULL THEN
    p_unit := 'fo';
  END IF;
  -- Inti juga memvalidasi tanggal <= 366 hari dan unit sebelum kueri total.
  SELECT pg_catalog.count(*) INTO v_saya
  FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id) AS i
  WHERE (p_tanpa_form IS NOT TRUE OR i.unit <> 'layanan'
         OR NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = i.layanan_id AND l.form_pendataan IS NOT NULL))
    AND (v_role <> 'front_office' OR v_koord OR i.unit = 'fo');

  WITH selesai AS (
    SELECT p.peran_tahap AS unit, p.layanan_id
    FROM public.penanganan AS p JOIN public.kunjungan AS k ON k.id = p.kunjungan_id
    WHERE p.status = 'selesai'
      AND NOT (p.peran_tahap = 'layanan' AND p.hasil = 'dikembalikan')
      AND k.tanggal BETWEEN p_dari AND p_sampai
      AND (p_unit IS NULL OR p.peran_tahap = p_unit)
      AND (p_layanan_id IS NULL OR p.layanan_id = p_layanan_id)
    UNION ALL
    SELECT 'layanan'::text, t.layanan_id
    FROM public.tiket_antrean AS t
    LEFT JOIN public.kunjungan AS k ON k.id = t.kunjungan_id
    LEFT JOIN public.pelayanan_oss AS o ON o.tiket_id = t.id
    LEFT JOIN public.pelayanan_perizinan AS pz ON pz.tiket_id = t.id
    WHERE t.status = 'selesai' AND t.waktu_selesai IS NOT NULL
      AND COALESCE(k.tanggal, t.tanggal) BETWEEN p_dari AND p_sampai
      AND (p_unit IS NULL OR p_unit = 'layanan')
      AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id)
      AND NOT EXISTS (SELECT 1 FROM public.penanganan AS p2 WHERE p2.tiket_id = t.id)
      AND COALESCE(o.status_draft, pz.status_draft, 'selesai') = 'selesai'
  )
  SELECT pg_catalog.count(*) INTO v_total FROM selesai AS s
  WHERE (v_role <> 'petugas' OR (s.unit = 'layanan' AND s.layanan_id = v_layanan))
    AND (v_role <> 'front_office' OR v_koord OR s.unit = 'fo')
    AND (p_tanpa_form IS NOT TRUE OR s.unit <> 'layanan'
         OR NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = s.layanan_id AND l.form_pendataan IS NOT NULL));

  RETURN pg_catalog.jsonb_build_object('saya', v_saya, 'total', v_total, 'persen',
    CASE WHEN v_total = 0 THEN 0 ELSE pg_catalog.round(v_saya * 100.0 / v_total, 2) END);
END $$;
REVOKE ALL ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) IS NULL;

-- 8. Operator (202611030014) dan audit petugas (202610090004)
CREATE OR REPLACE FUNCTION public.admin_atur_operator(p_petugas_id uuid, p_aktif boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin uuid;
  v_lama boolean;
BEGIN
  SELECT me.id INTO v_admin FROM public.staf_saya() AS me WHERE me.role = 'admin';
  IF auth.uid() IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin aktif' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF p_petugas_id IS NULL OR p_aktif IS NULL THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: akun dan penanda operator wajib diisi' USING ERRCODE = '22023';
  END IF;
  SELECT p.operator_aktif INTO v_lama FROM public.petugas AS p WHERE p.id = p_petugas_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN: akun tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_lama IS DISTINCT FROM p_aktif THEN
    UPDATE public.petugas SET operator_aktif = p_aktif WHERE id = p_petugas_id;
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
    VALUES (auth.uid(), 'admin', 'akun_operator', 'petugas', p_petugas_id::text,
      pg_catalog.jsonb_build_object('dari', v_lama, 'ke', p_aktif, 'admin_id', v_admin));
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'operator_aktif', p_aktif);
END $$;
REVOKE ALL ON FUNCTION public.admin_atur_operator(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atur_operator(uuid, boolean) TO authenticated;

DROP TRIGGER IF EXISTS trg_audit_petugas_ubah ON public.petugas;
CREATE TRIGGER trg_audit_petugas_ubah AFTER UPDATE OF role, aktif, username, layanan_id, nama ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan('id', 'nama', 'role', 'aktif', 'username', 'layanan_id');
