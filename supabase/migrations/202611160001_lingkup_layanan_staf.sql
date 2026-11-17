-- G2: lingkup baca satu layanan per petugas; FO/admin membaca seluruh layanan.
-- Lokal saja. Basis fungsi hidup: akses 202611030015, rekap 202611040001.
-- Jalankan sebagai satu transaksi oleh pelaksana migrasi; tidak mengubah hak tulis/pengambilalihan.
DO $$
DECLARE
  v_signature text;
  v_marker text;
  v_comment text;
BEGIN
  FOR v_signature, v_marker IN SELECT * FROM (VALUES
    ('public.boleh_penanganan(uuid,text,uuid,uuid,text)', '202611030015:%'),
    ('public.boleh_kunjungan(uuid)', '202611030015:%'),
    ('public.boleh_baca_pendataan(uuid,uuid)', '202611030015:%'),
    ('public.boleh_tiket_baca(uuid,uuid,date)', '202611030015:%'),
    ('public.rekap_pelayanan_inti(date,date,text,uuid)', '202611040001:%'),
    ('public.rekap_ringkasan_dilayani(date,date,text,uuid,boolean)', '202611040001:%')
  ) AS syarat(signature, marker) LOOP
    v_comment := coalesce(pg_catalog.obj_description(pg_catalog.to_regprocedure(v_signature), 'pg_proc'), '');
    IF v_comment NOT LIKE v_marker AND v_comment NOT LIKE '202611160001:%' THEN
      RAISE EXCEPTION 'PRASYARAT: fungsi akses 202611030015 dan rekap 202611040001 wajib tersedia (%)', v_signature;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.lingkup_layanan_saya()
RETURNS TABLE (semua boolean, layanan_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT me.role IN ('admin', 'front_office'),
         CASE WHEN me.role = 'petugas' THEN me.layanan_id END
  FROM public.staf_lingkup() AS me
  WHERE auth.uid() IS NOT NULL AND public.sesi_valid()
    AND me.role IN ('admin', 'front_office', 'petugas')
$$;
REVOKE ALL ON FUNCTION public.lingkup_layanan_saya() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lingkup_layanan_saya() TO authenticated, service_role;

ALTER TABLE public.layanan ADD COLUMN IF NOT EXISTS modul text
  CONSTRAINT layanan_modul_check CHECK (modul IN ('umkm', 'investasi'));
-- Nama berasal dari supabase/seed.sql; tidak bergantung pada UUID instalasi.
UPDATE public.layanan SET modul = 'umkm' WHERE nama = 'Matchmaking UMKM' AND modul IS DISTINCT FROM 'umkm';
UPDATE public.layanan SET modul = 'investasi' WHERE nama = 'Investment Gallery' AND modul IS DISTINCT FROM 'investasi';
COMMENT ON COLUMN public.layanan.modul IS 'Modul staf berdasarkan layanan; NULL berarti layanan tanpa modul.';

CREATE OR REPLACE FUNCTION public.staf_modul()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT l.modul
  FROM public.lingkup_layanan_saya() AS s
  JOIN public.layanan AS l ON l.id = s.layanan_id
  WHERE NOT s.semua
$$;
REVOKE ALL ON FUNCTION public.staf_modul() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staf_modul() TO authenticated, service_role;

-- Signature akses 202611030015 dipertahankan. Semua keputusan baca berasal dari helper lingkup.
CREATE OR REPLACE FUNCTION public.boleh_kunjungan(p_kunjungan uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lingkup_layanan_saya() AS s
    WHERE s.semua OR (s.layanan_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.tiket_antrean AS t WHERE t.kunjungan_id = p_kunjungan AND t.layanan_id = s.layanan_id)
      OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = s.layanan_id)
      OR EXISTS (
        SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS c ON c.id = k.chat_sesi_id
        WHERE k.id = p_kunjungan AND k.asal = 'online' AND c.layanan_id = s.layanan_id
      )
    ))
  )
$$;

CREATE OR REPLACE FUNCTION public.boleh_penanganan(
  p_kunjungan uuid, p_peran_tahap text, p_layanan uuid, p_penangan uuid, p_status text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lingkup_layanan_saya() AS s
    WHERE s.semua OR (s.layanan_id IS NOT NULL AND (
      (p_peran_tahap = 'layanan' AND p_layanan = s.layanan_id)
      OR (p_peran_tahap = 'fo' AND public.boleh_kunjungan(p_kunjungan))
    ))
  )
$$;

-- Baca tabel langsung FO mengikuti basis hidup 202611030015 (tanpa jendela lintas pembuat).
CREATE OR REPLACE FUNCTION public.boleh_baca_pendataan(p_tiket uuid, p_petugas uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lingkup_layanan_saya() AS s
    JOIN public.staf_lingkup() AS me ON true
    JOIN public.tiket_antrean AS t ON t.id = p_tiket
    WHERE me.role = 'admin'
       OR (me.role = 'petugas' AND s.layanan_id IS NOT NULL AND t.layanan_id = s.layanan_id)
       OR (me.role = 'front_office' AND (
         me.koordinator OR p_petugas = me.id OR t.dilayani_oleh = me.id
         OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = t.id AND p.penangan_id = me.id)
         OR EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = t.kunjungan_id AND k.dibuat_oleh = me.id)
       ))
  )
$$;

CREATE OR REPLACE FUNCTION public.boleh_tiket_baca(p_kunjungan uuid, p_layanan uuid, p_tanggal date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lingkup_layanan_saya() AS s
    WHERE s.semua OR (s.layanan_id IS NOT NULL AND p_layanan = s.layanan_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.boleh_baca_khusus(p_penanganan uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lingkup_layanan_saya() AS s
    JOIN public.staf_lingkup() AS me ON true
    JOIN public.penanganan AS p ON p.id = p_penanganan
    WHERE me.role = 'admin'
       OR (me.role = 'petugas' AND s.layanan_id IS NOT NULL AND p.layanan_id = s.layanan_id)
       OR (me.role = 'front_office' AND (
         me.koordinator OR p.penangan_id = me.id
         OR EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p.kunjungan_id AND k.dibuat_oleh = me.id)
       ))
  )
$$;

-- Batch jawaban rekap dengan lingkup yang sama seperti baris rekap.
-- RLS tabel sensitif tetap ketat; pembacaan FO lintas pembuat diaudit di transaksi ini.
CREATE OR REPLACE FUNCTION public.rekap_khusus_peta(p_penanganan uuid[])
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_semua boolean;
  v_layanan uuid;
  v_role text;
  v_me uuid;
  v_lintas uuid[];
  v_hasil jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT s.semua, s.layanan_id, me.role, me.id INTO v_semua, v_layanan, v_role, v_me
    FROM public.lingkup_layanan_saya() AS s CROSS JOIN public.staf_lingkup() AS me;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(pg_catalog.cardinality(p_penanganan), 0) > 500 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: maksimum 500 pelayanan per batch' USING ERRCODE = '22023';
  END IF;
  -- Menolak seluruh batch, termasuk ID hilang/NULL, sebelum membaca jawaban apa pun.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_penanganan) AS r(id)
    LEFT JOIN public.penanganan AS p ON p.id = r.id
    WHERE p.id IS NULL OR NOT (v_semua OR (v_layanan IS NOT NULL
      AND p.peran_tahap = 'layanan' AND p.layanan_id = v_layanan))
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: pelayanan tidak tersedia dalam lingkup rekap' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'front_office' THEN
    SELECT pg_catalog.array_agg(p.id ORDER BY p.id) INTO v_lintas
      FROM public.penanganan AS p JOIN public.kunjungan AS k ON k.id = p.kunjungan_id
      WHERE p.id = ANY(p_penanganan) AND k.dibuat_oleh IS DISTINCT FROM v_me;
    IF pg_catalog.cardinality(v_lintas) > 0 THEN
      INSERT INTO public.audit_log(actor_id,actor_role,aksi,entitas,detail)
        VALUES(auth.uid(),v_role,'lihat_data','rekap_khusus',
          pg_catalog.jsonb_build_object('penanganan_ids',v_lintas,'jumlah',pg_catalog.cardinality(v_lintas)));
    END IF;
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_object_agg(x.penanganan_id::text,x.isian),'{}'::jsonb) INTO v_hasil
    FROM (
      SELECT j.penanganan_id, pg_catalog.jsonb_object_agg(j.field_id::text,j.nilai) AS isian
      FROM public.pendataan_khusus_jawaban AS j WHERE j.penanganan_id = ANY(p_penanganan)
      GROUP BY j.penanganan_id
    ) AS x;
  RETURN v_hasil;
END $$;
REVOKE ALL ON FUNCTION public.rekap_khusus_peta(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rekap_khusus_peta(uuid[]) TO authenticated;
COMMENT ON FUNCTION public.rekap_khusus_peta(uuid[]) IS
  '202611160001: batch <=500, lingkup per pelayanan dan audit FO lintas pembuat atomik; RLS tabel tetap ketat.';

-- Rekap: basis 202611040001, hanya otorisasi lingkup yang berubah.
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
  SELECT s.semua, s.layanan_id INTO v_semua, v_unit_lyn
  FROM public.lingkup_layanan_saya() AS s;
  IF NOT FOUND THEN
    RETURN;
  END IF;

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
    AND (v_semua OR (v_unit_lyn IS NOT NULL AND p.peran_tahap = 'layanan' AND p.layanan_id = v_unit_lyn))
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
    AND (v_semua OR (v_unit_lyn IS NOT NULL AND t.layanan_id = v_unit_lyn));
END $$;

CREATE OR REPLACE FUNCTION public.rekap_ringkasan_dilayani(
  p_dari date, p_sampai date, p_unit text DEFAULT NULL,
  p_layanan_id uuid DEFAULT NULL, p_tanpa_form boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_semua boolean;
  v_layanan uuid;
  v_saya bigint;
  v_total bigint;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT s.semua, s.layanan_id INTO v_semua, v_layanan FROM public.lingkup_layanan_saya() AS s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  -- Inti juga memvalidasi tanggal <= 366 hari dan unit sebelum kueri total.
  SELECT pg_catalog.count(*) INTO v_saya
  FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id) AS i
  WHERE i.penangan_id IS NOT NULL
    AND (p_tanpa_form IS NOT TRUE OR i.unit <> 'layanan'
         OR NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = i.layanan_id AND l.form_pendataan IS NOT NULL));

  WITH selesai AS (
    SELECT p.peran_tahap AS unit, p.layanan_id, p.penangan_id
    FROM public.penanganan AS p JOIN public.kunjungan AS k ON k.id = p.kunjungan_id
    WHERE p.status = 'selesai'
      AND NOT (p.peran_tahap = 'layanan' AND p.hasil = 'dikembalikan')
      AND k.tanggal BETWEEN p_dari AND p_sampai
      AND (p_unit IS NULL OR p.peran_tahap = p_unit)
      AND (p_layanan_id IS NULL OR p.layanan_id = p_layanan_id)
    UNION ALL
    SELECT 'layanan'::text, t.layanan_id, COALESCE(o.petugas_id, pz.petugas_id, t.dilayani_oleh)
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
  WHERE s.penangan_id IS NOT NULL
    AND (v_semua OR (s.unit = 'layanan' AND s.layanan_id = v_layanan))
    AND (p_tanpa_form IS NOT TRUE OR s.unit <> 'layanan'
         OR NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = s.layanan_id AND l.form_pendataan IS NOT NULL));

  RETURN pg_catalog.jsonb_build_object('saya', v_saya, 'total', v_total, 'persen',
    CASE WHEN v_total = 0 THEN 0 ELSE pg_catalog.round(v_saya * 100.0 / v_total, 2) END);
END $$;
REVOKE ALL ON FUNCTION public.boleh_kunjungan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kunjungan(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_kunjungan(uuid) IS '202611160001: baca mengikuti lingkup_layanan_saya; hak tulis tetap pada pemilik dan RPC lama.';
REVOKE ALL ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) IS '202611160001: baca mengikuti lingkup_layanan_saya; hak tulis tetap pada pemilik dan RPC lama.';
REVOKE ALL ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) IS '202611160001: baca mengikuti lingkup_layanan_saya; hak tulis tetap pada pemilik dan RPC lama.';
REVOKE ALL ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) IS '202611160001: baca mengikuti lingkup_layanan_saya; hak tulis tetap pada pemilik dan RPC lama.';
REVOKE ALL ON FUNCTION public.boleh_baca_khusus(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_baca_khusus(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_baca_khusus(uuid) IS '202611160001: baca mengikuti lingkup_layanan_saya; hak tulis tetap pada pemilik dan RPC lama.';
REVOKE ALL ON FUNCTION public.rekap_pelayanan_inti(date, date, text, uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.rekap_pelayanan_inti(date, date, text, uuid) IS '202611160001: basis 202611040001; FO/admin semua, petugas seluruh layanan; internal.';
REVOKE ALL ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) IS '202611160001: populasi berpenangan 202611040001, lingkup baca layanan terpusat.';

-- Basis 202611090001_umkm_inti.sql
CREATE OR REPLACE FUNCTION umkm_private.aktor(p_admin boolean DEFAULT false) RETURNS public.petugas
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE = '28000'; END IF;
  SELECT * INTO a FROM public.petugas WHERE auth_user_id = auth.uid() AND aktif;
  IF a.id IS NULL OR NOT public.sesi_valid()
    OR EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND is_anonymous)
    OR COALESCE(auth.jwt()->>'is_anonymous','false') = 'true'
    OR (p_admin AND a.role <> 'admin')
    OR (NOT p_admin AND NOT coalesce(a.role='admin' OR public.staf_modul()='umkm', false)) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END $$;

-- Basis 202611090002_umkm_katalog.sql
CREATE OR REPLACE FUNCTION umkm_private.aktor_hapus() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  IF NOT public.sesi_valid() OR NOT EXISTS (SELECT 1 FROM public.petugas a
    WHERE a.auth_user_id=auth.uid() AND a.aktif AND (a.role IN ('admin','front_office')
      OR coalesce(public.staf_modul()='umkm', false))) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
END $$;

-- Basis 202611090009_umkm_permintaan_petugas.sql
CREATE OR REPLACE FUNCTION umkm_private.laporan_statistik(p_cursor text,p_ekspor boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; aktif boolean; c jsonb; hasil jsonb; berikut text; daftar jsonb;
  batas integer := CASE WHEN p_ekspor THEN 10000 ELSE 20 END;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  SELECT p.* INTO a FROM public.petugas p WHERE p.auth_user_id=auth.uid() AND p.aktif;
  IF a.id IS NULL OR NOT public.sesi_valid() OR coalesce(auth.jwt()->>'is_anonymous','false')='true'
    OR EXISTS (SELECT 1 FROM auth.users WHERE id=auth.uid() AND is_anonymous)
    OR NOT (a.role='admin' OR coalesce(public.staf_modul()='umkm', false)) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  SELECT telemetri_opsional_aktif INTO aktif FROM umkm_private.statistik WHERE tunggal;
  c := umkm_private.baca_cursor(p_cursor,'laporan-statistik');
  IF c IS NOT NULL AND (c->>'aktif')::boolean IS DISTINCT FROM aktif THEN
    RAISE EXCEPTION 'SNAPSHOT_BERUBAH' USING ERRCODE='40001'; END IF;
  WITH halaman AS MATERIALIZED (
    SELECT p.id,umkm_private.teks_pengawasan(r.nama,'Profil belum terbit') nama,
      coalesce(t.suka,0) suka,CASE WHEN aktif THEN coalesce(t.dilihat,0) ELSE NULL END dilihat,
      CASE WHEN aktif THEN coalesce(t.klik_formulir,0) ELSE NULL END klik_formulir,
      CASE WHEN aktif THEN coalesce(t.dilihat,0) ELSE coalesce(t.suka,0) END nilai
    FROM public.umkm_profil p LEFT JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    LEFT JOIN public.umkm_stat_total t ON t.profil_id=p.id
    WHERE c IS NULL OR (-(CASE WHEN aktif THEN coalesce(t.dilihat,0) ELSE coalesce(t.suka,0) END),p.id)>
      (-(c->>'nilai')::bigint,(c->>'id')::uuid)
    ORDER BY nilai DESC,p.id LIMIT batas+1
  ), nomor AS (
    SELECT h.*,row_number() OVER (ORDER BY nilai DESC,id) n FROM halaman h
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'nama',nama,'suka',suka,
      'dilihat',dilihat,'klik_formulir',klik_formulir,'permintaan',
      (SELECT count(*) FROM public.umkm_permintaan_kontak p WHERE p.profil_id=nomor.id))
      ORDER BY n) FILTER(WHERE n<=batas),'[]'::jsonb),
    CASE WHEN count(*)>batas AND NOT p_ekspor THEN umkm_private.buat_cursor('laporan-statistik',
      jsonb_build_object('aktif',aktif,'nilai',max(nilai) FILTER(WHERE n=batas),
        'id',max(id::text) FILTER(WHERE n=batas))) ELSE NULL END INTO daftar,berikut FROM nomor;
  WITH profil AS (
    SELECT count(*) FILTER(WHERE status='diajukan') diajukan,count(*) FILTER(WHERE status='terbit') terbit,
      count(*) FILTER(WHERE status='disembunyikan') disembunyikan,count(*) FILTER(WHERE status='ditolak') ditolak
    FROM public.umkm_profil
  ), pesan AS (
    SELECT count(*) FILTER(WHERE status='baru') baru,count(*) FILTER(WHERE status='ditangani') ditangani
    FROM public.umkm_pesan_kontak
  ), laporan AS (
    SELECT count(*) FILTER(WHERE status='baru') baru,count(*) FILTER(WHERE status='ditangani') ditangani
    FROM public.umkm_laporan
  ), total AS (
    SELECT coalesce(sum(suka),0) suka,coalesce(sum(dilihat),0) dilihat FROM public.umkm_stat_total
  ), kelompok AS (
    SELECT hari,kategori,kabupaten_kota,jumlah FROM public.umkm_stat_tanpa_hasil
    WHERE aktif ORDER BY hari DESC,kategori,kabupaten_kota LIMIT CASE WHEN p_ekspor THEN 5000 ELSE 20 END
  ) SELECT public.umkm_statistik_status() || jsonb_build_object(
    'profil',to_jsonb(p),'suka',t.suka,'dilihat',CASE WHEN aktif THEN t.dilihat ELSE NULL END,
    'tanpa_hasil',CASE WHEN aktif THEN coalesce((SELECT sum(jumlah) FROM public.umkm_stat_tanpa_hasil),0)
      +coalesce((SELECT sum(tanpa_hasil) FROM public.umkm_stat_bulanan),0) ELSE NULL END,
    'pesan',to_jsonb(m),'laporan',to_jsonb(l),'profil_statistik',daftar,'next_cursor',berikut,
    'kelompok_tanpa_hasil',coalesce((SELECT jsonb_agg(to_jsonb(k)
      ORDER BY hari DESC,kategori,kabupaten_kota) FROM kelompok k),'[]'::jsonb))
    INTO hasil FROM profil p CROSS JOIN pesan m CROSS JOIN laporan l CROSS JOIN total t;
  RETURN hasil||umkm_private.ringkasan_permintaan()||jsonb_build_object('hasil',
    (SELECT jsonb_build_object('belum_diketahui',count(*) FILTER(WHERE b.hasil='belum_diketahui'),
      'kerja_sama',count(*) FILTER(WHERE b.hasil='kerja_sama'),
      'tidak_berlanjut',count(*) FILTER(WHERE b.hasil='tidak_berlanjut')) FROM public.umkm_pembukaan_nomor b));
END $$;

-- Basis 202611100002_umkm_produk_mutasi.sql
CREATE OR REPLACE FUNCTION umkm_private.mutasi(p_aksi text,p_params jsonb,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a public.petugas; p public.umkm_profil; lama public.umkm_riwayat; r public.umkm_revisi;
  d jsonb; f jsonb; hasil jsonb; h text; rid uuid; kid uuid; nomor_lama text; alasan text;
  status_lama text; tujuan_id uuid; target_foto public.umkm_foto; petugas_lama uuid; sekarang
    timestamptz := clock_timestamp();
BEGIN
  IF p_aksi='atur_pemeriksa' THEN
    RAISE EXCEPTION 'DIHENTIKAN: akses UMKM ditentukan modul layanan' USING ERRCODE='0A000';
  END IF;
  a := umkm_private.aktor();
  IF p_operasi_id IS NULL OR p_params IS NULL THEN RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text || p_operasi_id::text,0));
  SELECT encode(extensions.hmac(convert_to(jsonb_build_object('aksi',p_aksi,'params',p_params)::text,'UTF8'),kunci,
    'sha256'),'hex')
    INTO h FROM umkm_private.rahasia WHERE tunggal;
  SELECT * INTO lama FROM public.umkm_riwayat WHERE aktor_id=a.id AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash <> h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  IF p_params->>'profil_id' IS NOT NULL THEN
    SELECT * INTO p FROM public.umkm_profil WHERE id=(p_params->>'profil_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
    IF p.versi IS DISTINCT FROM (p_params->>'expected_version')::integer THEN
      RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE='40001'; END IF;
    IF p_aksi <> 'ambil' AND p.petugas_id IS DISTINCT FROM a.id THEN
      RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
    status_lama := p.status; petugas_lama := p.petugas_id;
  ELSIF p_aksi <> 'simpan' OR p_params->>'expected_version' IS NOT NULL THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023';
  END IF;
  IF p_aksi='simpan' THEN
    d := p_params->'data'; PERFORM umkm_private.validasi(d);
    IF p.id IS NULL THEN
      INSERT INTO public.umkm_profil(sumber,sumber_ref,petugas_id)
        VALUES (d->>'sumber',d->>'sumber_ref',a.id) RETURNING * INTO p;
    ELSE
      UPDATE public.umkm_profil SET versi=versi+1,sumber=d->>'sumber',sumber_ref=d->>'sumber_ref',
        status=CASE WHEN status='terbit' THEN 'terbit' ELSE 'diajukan' END WHERE id=p.id RETURNING * INTO p;
    END IF;
    rid := umkm_private.tulis_revisi(p, d, a.id, NULL);
    IF d ? 'nomor' THEN
      SELECT nomor INTO nomor_lama FROM public.umkm_kontak_versi WHERE id=p.kontak_terakhir_id;
      IF nomor_lama IS DISTINCT FROM d->>'nomor' THEN
        IF p.kontak_terakhir_id IS NOT NULL THEN
          INSERT INTO public.umkm_izin(profil_id,kontak_versi_id,status,aktor_id,dibuat_pada)
            VALUES(p.id,p.kontak_terakhir_id,'dicabut',a.id,sekarang);
        END IF;
        kid := NULL;
        IF d->>'nomor' IS NOT NULL THEN
          INSERT INTO public.umkm_kontak_versi(profil_id,nomor,dibuat_oleh) VALUES(p.id,d->>'nomor',a.id) RETURNING
            id INTO kid;
        END IF;
        p.kontak_terakhir_id := kid;
      END IF;
    END IF;
    UPDATE public.umkm_profil SET revisi_terakhir_id=rid,kontak_terakhir_id=p.kontak_terakhir_id WHERE id=p.id
      RETURNING * INTO p;
  ELSIF p_aksi='ambil' THEN
    UPDATE public.umkm_profil SET petugas_id=a.id,versi=versi+1 WHERE id=p.id RETURNING * INTO p;
  ELSIF p_aksi='putusan' THEN
    SELECT * INTO r FROM public.umkm_revisi WHERE id=p.revisi_terakhir_id;
    alasan := nullif(btrim(p_params->>'alasan'),'');
    IF coalesce(p_params->>'keputusan','') NOT IN ('terbit','ditolak') OR r.keputusan IS NOT NULL
      OR p.status='disembunyikan' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
    IF (p_params->>'keputusan'='ditolak' AND alasan IS NULL) OR length(alasan)>240 OR
      umkm_private.ada_kontak(alasan) THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    IF p_params->>'keputusan'='terbit' THEN
      IF jsonb_array_length(umkm_private.peringatan(r.id))>0 THEN RAISE EXCEPTION 'KONTAK_PUBLIK' USING
        ERRCODE='40001'; END IF;
      UPDATE public.umkm_revisi SET keputusan='terbit' WHERE id=r.id;
      UPDATE public.umkm_foto SET perlu_review=false,diperiksa_oleh=a.id,diperiksa_pada=sekarang WHERE revisi_id=r.id;
      UPDATE public.umkm_profil SET status='terbit',versi=versi+1,revisi_disetujui_id=r.id,
        terbit_pada=coalesce(terbit_pada,sekarang),mendesak=false WHERE id=p.id RETURNING * INTO p;
    ELSE
      UPDATE public.umkm_revisi SET keputusan='ditolak' WHERE id=r.id;
      UPDATE public.umkm_profil SET status=CASE WHEN status='terbit' THEN 'terbit' ELSE 'ditolak' END,versi=versi+1,
        mendesak=false
        WHERE id=p.id RETURNING * INTO p;
    END IF;
  ELSIF p_aksi='visibilitas' THEN
    IF coalesce(p_params->>'aksi','') NOT IN ('sembunyikan','pulihkan') THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    IF p_params->>'foto_id' IS NOT NULL THEN
      SELECT f.* INTO target_foto FROM public.umkm_foto f JOIN public.umkm_revisi rr ON rr.id=f.revisi_id
        WHERE f.id=(p_params->>'foto_id')::uuid AND rr.profil_id=p.id
          AND f.revisi_id IN (p.revisi_terakhir_id,p.revisi_disetujui_id);
      IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
      -- Pemulihan tidak mengubah foto lama menjadi terlihat; salin menjadi revisi privat untuk diperiksa.
      IF p_params->>'aksi'='sembunyikan' THEN
        UPDATE public.umkm_foto SET tersembunyi=true
          WHERE revisi_id IN (p.revisi_terakhir_id,p.revisi_disetujui_id) AND asal=target_foto.asal
            AND url IS NOT DISTINCT FROM target_foto.url AND r2_key IS NOT DISTINCT FROM target_foto.r2_key;
      ELSE
        IF target_foto.revisi_id <> p.revisi_terakhir_id THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING
          ERRCODE='40001'; END IF;
        SELECT * INTO r FROM public.umkm_revisi WHERE id=p.revisi_terakhir_id;
        rid := umkm_private.salin_revisi(r.id, p.versi+1, a.id, (p_params->>'foto_id')::uuid);
        UPDATE public.umkm_profil SET revisi_terakhir_id=rid WHERE id=p.id;
      END IF;
      UPDATE public.umkm_profil SET versi=versi+1 WHERE id=p.id RETURNING * INTO p;
    ELSIF p_params->>'aksi'='sembunyikan' THEN
      UPDATE public.umkm_profil SET status='disembunyikan',versi=versi+1 WHERE id=p.id RETURNING * INTO p;
    ELSE
      IF p.status <> 'disembunyikan' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
      SELECT * INTO r FROM public.umkm_revisi WHERE id=p.revisi_terakhir_id;
      rid := umkm_private.salin_revisi(r.id, p.versi+1, a.id, NULL);
      UPDATE public.umkm_profil SET status='diajukan',versi=versi+1,revisi_terakhir_id=rid WHERE id=p.id RETURNING
        * INTO p;
    END IF;
  ELSIF p_aksi='izin' THEN
    IF p.kontak_terakhir_id IS NULL THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
    IF coalesce(p_params->>'status','') NOT IN ('diberikan','dicabut') THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    INSERT INTO public.umkm_izin(profil_id,kontak_versi_id,status,aktor_id,dibuat_pada)
      VALUES(p.id,p.kontak_terakhir_id,p_params->>'status',a.id,sekarang);
    UPDATE public.umkm_profil SET versi=versi+1 WHERE id=p.id RETURNING * INTO p;
  ELSE RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023';
  END IF;
  tujuan_id := p.id;
  hasil := jsonb_build_object('id',p.id,'versi',p.versi,'status',p.status,'revisi_id',p.revisi_terakhir_id,
    'peringatan_kontak',umkm_private.peringatan(p.revisi_terakhir_id));
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,alasan,operasi_id,
    payload_hash,hasil,referensi,dibuat_pada)
    VALUES(tujuan_id,'profil',p_aksi,a.id,a.role,
      status_lama,p.status,alasan,p_operasi_id,h,hasil,
      jsonb_strip_nulls(jsonb_build_object('profil_id',p.id,'revisi_id',p.revisi_terakhir_id,
        'kontak_versi_id',p.kontak_terakhir_id,'foto_id',target_foto.id,
        'petugas_sebelum',petugas_lama,'petugas_sesudah',p.petugas_id,
        'aksi_visibilitas',CASE WHEN p_aksi='visibilitas' THEN p_params->>'aksi' END,
        'keputusan',CASE WHEN p_aksi='putusan' THEN p_params->>'keputusan' END,
        'status_izin',CASE WHEN p_aksi='izin' THEN p_params->>'status' END)),sekarang);
  RETURN hasil;
END $$;

CREATE OR REPLACE FUNCTION public.umkm_atur_pemeriksa(p_petugas_id uuid,p_pemeriksa_umkm boolean,p_operasi_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'DIHENTIKAN: akses UMKM ditentukan modul layanan' USING ERRCODE='0A000';
END $$;
REVOKE ALL ON FUNCTION public.umkm_atur_pemeriksa(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.umkm_atur_pemeriksa(uuid, boolean, uuid) TO authenticated;
-- CREATE OR REPLACE mempertahankan ACL helper privat; kunci kembali secara eksplisit.
REVOKE ALL ON FUNCTION umkm_private.aktor(boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.aktor_hapus() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.laporan_statistik(text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.mutasi(text, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Internal: hanya dipanggil RPC pengambilan data, sehingga klien tidak dapat membuat audit tanpa membaca.
CREATE INDEX IF NOT EXISTS idx_audit_lihat_data_dedup
  ON public.audit_log(actor_id, entitas_id, created_at DESC)
  WHERE aksi = 'lihat_data' AND entitas = 'tiket_antrean';
CREATE OR REPLACE FUNCTION public.audit_lihat_data(p_tiket uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id uuid;
  v_role text;
  v_pembuat uuid;
  v_layanan uuid;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE='42501';
  END IF;
  SELECT me.id, me.role INTO v_id, v_role FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE='42501';
  END IF;
  SELECT k.dibuat_oleh, t.layanan_id INTO v_pembuat, v_layanan
  FROM public.tiket_antrean AS t LEFT JOIN public.kunjungan AS k ON k.id=t.kunjungan_id
  WHERE t.id=p_tiket;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE='P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lingkup_layanan_saya() AS s
    WHERE s.semua OR (s.layanan_id IS NOT NULL AND s.layanan_id = v_layanan)) THEN
    RAISE EXCEPTION 'FORBIDDEN: di luar lingkup layanan' USING ERRCODE='42501';
  END IF;
  IF v_role='front_office' AND v_pembuat IS DISTINCT FROM v_id THEN
    -- Serialize pasangan aktor+tiket agar permintaan serentak tidak menggandakan audit.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_tiket::text, 0));
    IF NOT EXISTS (SELECT 1 FROM public.audit_log AS a
      WHERE a.aksi = 'lihat_data' AND a.entitas = 'tiket_antrean'
        AND a.actor_id = auth.uid() AND a.entitas_id = p_tiket::text
        AND a.created_at >= pg_catalog.statement_timestamp() - interval '1 minute') THEN
      INSERT INTO public.audit_log(actor_id, actor_role, aksi, entitas, entitas_id, detail)
      VALUES(auth.uid(), v_role, 'lihat_data', 'tiket_antrean', p_tiket::text,
        pg_catalog.jsonb_build_object('lintas_pembuat', true, 'layanan_id', v_layanan));
    END IF;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.audit_lihat_data(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.audit_lihat_data(uuid) IS '202611160001: audit Lihat Data FO lintas pembuat; identitas aktor dari sesi, tanpa isian/kontak.';

-- Satu transaksi untuk pemeriksaan sesi/lingkup, audit, dan pembacaan data sensitif.
CREATE OR REPLACE FUNCTION public.lihat_data_pelayanan(p_tiket uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_hasil jsonb;
  v_khusus jsonb;
  v_draf jsonb;
  v_definisi jsonb;
  v_layanan uuid;
BEGIN
  PERFORM public.audit_lihat_data(p_tiket);
  SELECT t.layanan_id INTO v_layanan FROM public.tiket_antrean AS t WHERE t.id = p_tiket;
  SELECT COALESCE(pg_catalog.jsonb_agg(x.baris ORDER BY x.tersembunyi, x.urut, x.penanganan_id, x.field_id), '[]'::jsonb)
    INTO v_khusus
  FROM (
    SELECT j.penanganan_id, j.field_id, f.tersembunyi, f.urut,
      pg_catalog.jsonb_build_object('penanganan_id', j.penanganan_id, 'field_id', j.field_id,
        'label', f.label, 'jenis', f.jenis, 'nilai', j.nilai, 'opsi', f.opsi,
        'label_snapshot', j.label_snapshot, 'jenis_snapshot', j.jenis_snapshot,
        'tersembunyi', f.tersembunyi, 'urut', f.urut, 'diisi_oleh', j.diisi_oleh, 'created_at', j.created_at) AS baris
    FROM public.penanganan AS p
    JOIN public.pendataan_khusus_jawaban AS j ON j.penanganan_id = p.id
    JOIN public.pendataan_khusus_field AS f ON f.id = j.field_id
    WHERE p.tiket_id = p_tiket
    ORDER BY f.tersembunyi, f.urut, j.penanganan_id, j.field_id LIMIT 1001
  ) AS x;
  IF pg_catalog.jsonb_array_length(v_khusus) > 1000 THEN
    RAISE EXCEPTION 'DATA_TERLALU_BESAR: terlalu banyak jawaban' USING ERRCODE = '54000';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f) ORDER BY f.tersembunyi, f.urut, f.id), '[]'::jsonb)
    INTO v_definisi FROM (
      SELECT f.id, f.label, f.jenis, f.opsi, f.wajib, f.tersembunyi, f.urut
      FROM public.pendataan_khusus_field AS f WHERE f.layanan_id = v_layanan
      ORDER BY f.tersembunyi, f.urut, f.id LIMIT 40
    ) AS f;
  -- 0002 membuat tabel draf; 0001 tetap bisa dijalankan dan diuji sendiri.
  IF pg_catalog.to_regclass('public.pendataan_khusus_draf') IS NOT NULL THEN
    SELECT pg_catalog.to_jsonb(d) INTO v_draf FROM public.pendataan_khusus_draf AS d WHERE d.tiket_id = p_tiket;
  END IF;
  v_hasil := pg_catalog.jsonb_build_object(
    'oss', (SELECT pg_catalog.to_jsonb(o) FROM public.pelayanan_oss AS o WHERE o.tiket_id = p_tiket),
    'perizinan', (SELECT pg_catalog.to_jsonb(p) FROM public.pelayanan_perizinan AS p WHERE p.tiket_id = p_tiket),
    'khusus', v_khusus, 'definisi_khusus', v_definisi, 'draf', v_draf);
  IF pg_catalog.octet_length(v_hasil::text) > 1048576 THEN
    RAISE EXCEPTION 'DATA_TERLALU_BESAR: data melebihi 1 MiB' USING ERRCODE = '54000';
  END IF;
  RETURN v_hasil;
END $$;
REVOKE ALL ON FUNCTION public.lihat_data_pelayanan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lihat_data_pelayanan(uuid) TO authenticated;
COMMENT ON FUNCTION public.lihat_data_pelayanan(uuid) IS
  '202611160001: Lihat Data semua jenis layanan; FO lintas pembuat diaudit atomik, maksimum 1000 jawaban/1 MiB.';
