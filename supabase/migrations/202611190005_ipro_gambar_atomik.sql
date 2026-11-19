-- Gambar dan status IPRO atomik. Prasyarat: 202611190001 dan 202611190002.
-- Semua penulis gambar mengambil lock proyek SEBELUM membaca jumlah/status atau mengubah utama.
DO $$
BEGIN
  IF to_regclass('public.ipro_gambar') IS NULL
    OR to_regprocedure('public.boleh_kelola_investasi()') IS NULL
    OR to_regprocedure('public.investasi_ubah_status_minat(uuid,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202611190001 dan 202611190002 wajib tersedia';
  END IF;
END $$;

-- Helper internal; dipanggil hanya setelah lock proyek diambil oleh RPC/UPDATE proyek.
CREATE FUNCTION public.ipro_kekurangan_terbit(p_proyek_id uuid) RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_proyek public.ipro_proyek; v_kurang text[] := '{}'; v_jumlah integer; v_utama boolean;
BEGIN
    SELECT p.id, p.sumber, p.status, p.slug, p.judul, p.judul_en, p.ringkasan, p.ringkasan_en, p.deskripsi,
    p.deskripsi_en, p.sektor, p.kab_kota, p.lokasi_teks, p.lat, p.lng, p.pemilik, p.nilai_investasi, p.mata_uang,
    p.nilai_teks, p.irr_persen, p.npv_nilai, p.payback_bulan, p.skema, p.status_lahan, p.luas_ha, p.tahap_kajian,
    p.perizinan, p.dokumen_id, p.kontak_instansi, p.kontak_email, p.kontak_telepon, p.sumber_url, p.sumber_slug,
    p.urutan, p.diterbitkan_pada, p.versi, p.dibuat_oleh, p.diubah_oleh, p.dibuat_pada, p.diubah_pada INTO v_proyek
    FROM public.ipro_proyek AS p WHERE p.id = p_proyek_id;
  SELECT count(*)::integer, coalesce(bool_or(g.utama), false) INTO v_jumlah, v_utama
    FROM public.ipro_gambar AS g WHERE g.proyek_id = p_proyek_id;
  IF v_proyek.kab_kota <> ALL (ARRAY[
    'Kab. Lampung Barat', 'Kab. Lampung Selatan', 'Kab. Lampung Tengah', 'Kab. Lampung Timur',
    'Kab. Lampung Utara', 'Kab. Mesuji', 'Kab. Pesawaran', 'Kab. Pesisir Barat', 'Kab. Pringsewu',
    'Kab. Tanggamus', 'Kab. Tulang Bawang', 'Kab. Tulang Bawang Barat', 'Kab. Way Kanan',
    'Kota Bandar Lampung', 'Kota Metro', 'Lintas Kabupaten/Kota'
  ]) THEN v_kurang := array_append(v_kurang, 'kab_kota'); END IF;
  IF v_proyek.sektor <> ALL (ARRAY['pertanian','perikanan','pariwisata','industri','energi',
    'infrastruktur','kawasan','jasa','lainnya']) THEN v_kurang := array_append(v_kurang, 'sektor'); END IF;
  IF v_proyek.sumber = 'foila' THEN
    IF v_proyek.sumber_url IS NULL OR v_proyek.sumber_url !~ '^https://invest\.lampungprov\.go\.id/[^[:space:]\\]*$' THEN
      v_kurang := array_append(v_kurang, 'sumber_url');
    END IF;
    IF v_jumlah <> 1 THEN v_kurang := array_append(v_kurang, 'gambar'); END IF;
  ELSE
    IF nullif(btrim(v_proyek.deskripsi, E' \t\n\r'), '') IS NULL THEN v_kurang := array_append(v_kurang, 'deskripsi'); END IF;
    IF NOT v_utama THEN v_kurang := array_append(v_kurang, 'gambar_utama'); END IF;
  END IF;
  RETURN v_kurang;
END $$;
REVOKE ALL ON FUNCTION public.ipro_kekurangan_terbit(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- UPDATE proyek sendiri sudah mengambil lock baris; trigger juga menutup bypass publish via REST tabel.
CREATE FUNCTION public.ipro_jaga_terbit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_kurang text[];
BEGIN
  IF NEW.status = 'terbit' THEN
    v_kurang := public.ipro_kekurangan_terbit(NEW.id);
    IF cardinality(v_kurang) > 0 THEN
      RAISE EXCEPTION 'SYARAT_TERBIT' USING ERRCODE = '23514', DETAIL = to_jsonb(v_kurang)::text;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ipro_jaga_terbit() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER ipro_jaga_terbit AFTER INSERT OR UPDATE ON public.ipro_proyek
  FOR EACH ROW EXECUTE FUNCTION public.ipro_jaga_terbit();

-- Cegah klien melewati serialisasi RPC. Hak SELECT per kolom dan RLS tetap berlaku.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ipro_gambar FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.ipro_tambah_gambar(p_proyek_id uuid, p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_proyek public.ipro_proyek; v_gambar public.ipro_gambar; v_jumlah integer; v_batas integer;
BEGIN
  IF NOT coalesce(public.boleh_kelola_investasi(), false) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE = '42501';
  END IF;
    SELECT p.id, p.sumber, p.status, p.slug, p.judul, p.judul_en, p.ringkasan, p.ringkasan_en, p.deskripsi,
    p.deskripsi_en, p.sektor, p.kab_kota, p.lokasi_teks, p.lat, p.lng, p.pemilik, p.nilai_investasi, p.mata_uang,
    p.nilai_teks, p.irr_persen, p.npv_nilai, p.payback_bulan, p.skema, p.status_lahan, p.luas_ha, p.tahap_kajian,
    p.perizinan, p.dokumen_id, p.kontak_instansi, p.kontak_email, p.kontak_telepon, p.sumber_url, p.sumber_slug,
    p.urutan, p.diterbitkan_pada, p.versi, p.dibuat_oleh, p.diubah_oleh, p.dibuat_pada, p.diubah_pada INTO v_proyek
    FROM public.ipro_proyek AS p WHERE p.id = p_proyek_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'; END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object'
    OR p_data - ARRAY['kunci','kunci_mini','lebar','tinggi','alt','alt_en','keterangan','keterangan_en','utama','urutan'] <> '{}'::jsonb
    OR (p_data ? 'utama' AND jsonb_typeof(p_data->'utama') <> 'boolean') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer INTO v_jumlah FROM public.ipro_gambar AS g WHERE g.proyek_id = p_proyek_id;
  v_batas := CASE WHEN v_proyek.sumber = 'foila' THEN 1 ELSE 12 END;
  IF v_jumlah >= v_batas THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE = '23514'; END IF;
  v_gambar := jsonb_populate_record(NULL::public.ipro_gambar, p_data);
  IF v_gambar.kunci NOT LIKE 'ipro-gambar/' || p_proyek_id::text || '/%'
    OR v_gambar.kunci_mini NOT LIKE 'ipro-gambar/' || p_proyek_id::text || '/%' THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;
  v_gambar.utama := v_jumlah = 0 OR coalesce(v_gambar.utama, false);
  IF v_gambar.utama THEN
    UPDATE public.ipro_gambar SET utama = false WHERE proyek_id = p_proyek_id AND utama;
  END IF;
  INSERT INTO public.ipro_gambar(proyek_id,kunci,kunci_mini,lebar,tinggi,alt,alt_en,keterangan,keterangan_en,utama,urutan,dibuat_oleh)
    VALUES(p_proyek_id,v_gambar.kunci,v_gambar.kunci_mini,v_gambar.lebar,v_gambar.tinggi,v_gambar.alt,
      v_gambar.alt_en,v_gambar.keterangan,v_gambar.keterangan_en,v_gambar.utama,coalesce(v_gambar.urutan,v_jumlah),
      (SELECT p.id FROM public.petugas AS p WHERE p.auth_user_id = auth.uid() AND p.aktif))
    RETURNING id INTO v_gambar.id;
  v_gambar.proyek_id := p_proyek_id;
  v_gambar.urutan := coalesce(v_gambar.urutan, v_jumlah);
  RETURN jsonb_build_object(
    'id', v_gambar.id, 'proyek_id', v_gambar.proyek_id, 'kunci', v_gambar.kunci,
    'kunci_mini', v_gambar.kunci_mini, 'lebar', v_gambar.lebar, 'tinggi', v_gambar.tinggi,
    'alt', v_gambar.alt, 'alt_en', v_gambar.alt_en, 'keterangan', v_gambar.keterangan,
    'keterangan_en', v_gambar.keterangan_en, 'utama', v_gambar.utama, 'urutan', v_gambar.urutan);
END $$;
REVOKE ALL ON FUNCTION public.ipro_tambah_gambar(uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ipro_tambah_gambar(uuid,jsonb) TO authenticated;

CREATE FUNCTION public.ipro_ubah_gambar(p_proyek_id uuid, p_gambar_id uuid, p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_proyek public.ipro_proyek; v_gambar public.ipro_gambar;
BEGIN
  IF NOT coalesce(public.boleh_kelola_investasi(), false) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE = '42501';
  END IF;
    SELECT p.id, p.sumber, p.status, p.slug, p.judul, p.judul_en, p.ringkasan, p.ringkasan_en, p.deskripsi,
    p.deskripsi_en, p.sektor, p.kab_kota, p.lokasi_teks, p.lat, p.lng, p.pemilik, p.nilai_investasi, p.mata_uang,
    p.nilai_teks, p.irr_persen, p.npv_nilai, p.payback_bulan, p.skema, p.status_lahan, p.luas_ha, p.tahap_kajian,
    p.perizinan, p.dokumen_id, p.kontak_instansi, p.kontak_email, p.kontak_telepon, p.sumber_url, p.sumber_slug,
    p.urutan, p.diterbitkan_pada, p.versi, p.dibuat_oleh, p.diubah_oleh, p.dibuat_pada, p.diubah_pada INTO v_proyek
    FROM public.ipro_proyek AS p WHERE p.id = p_proyek_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'; END IF;
    SELECT g.id, g.proyek_id, g.kunci, g.kunci_mini, g.lebar, g.tinggi, g.alt, g.alt_en, g.keterangan,
    g.keterangan_en, g.utama, g.urutan, g.dibuat_oleh, g.dibuat_pada INTO v_gambar FROM public.ipro_gambar AS g
    WHERE g.proyek_id = p_proyek_id AND g.id = p_gambar_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'; END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR p_data = '{}'::jsonb
    OR p_data - ARRAY['alt','alt_en','keterangan','keterangan_en','utama','urutan'] <> '{}'::jsonb
    OR (p_data ? 'utama' AND jsonb_typeof(p_data->'utama') <> 'boolean') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;
  IF v_proyek.status = 'terbit' AND v_gambar.utama AND p_data->'utama' = 'false'::jsonb THEN
    RAISE EXCEPTION 'SYARAT_TERBIT' USING ERRCODE = '23514', DETAIL = '["gambar_utama"]';
  END IF;
  IF p_data->'utama' = 'true'::jsonb THEN
    UPDATE public.ipro_gambar SET utama = false WHERE proyek_id = p_proyek_id AND utama;
  END IF;
  UPDATE public.ipro_gambar SET
    alt = CASE WHEN p_data ? 'alt' THEN p_data->>'alt' ELSE alt END,
    alt_en = CASE WHEN p_data ? 'alt_en' THEN p_data->>'alt_en' ELSE alt_en END,
    keterangan = CASE WHEN p_data ? 'keterangan' THEN p_data->>'keterangan' ELSE keterangan END,
    keterangan_en = CASE WHEN p_data ? 'keterangan_en' THEN p_data->>'keterangan_en' ELSE keterangan_en END,
    utama = CASE WHEN p_data ? 'utama' THEN (p_data->>'utama')::boolean ELSE utama END,
    urutan = CASE WHEN p_data ? 'urutan' THEN (p_data->>'urutan')::integer ELSE urutan END
      WHERE proyek_id = p_proyek_id AND id = p_gambar_id RETURNING id, proyek_id, kunci, kunci_mini, lebar, tinggi,
    alt, alt_en, keterangan, keterangan_en, utama, urutan, dibuat_oleh, dibuat_pada INTO v_gambar;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'id', v_gambar.id, 'proyek_id', v_gambar.proyek_id, 'kunci', v_gambar.kunci,
    'kunci_mini', v_gambar.kunci_mini, 'lebar', v_gambar.lebar, 'tinggi', v_gambar.tinggi,
    'alt', v_gambar.alt, 'alt_en', v_gambar.alt_en, 'keterangan', v_gambar.keterangan,
    'keterangan_en', v_gambar.keterangan_en, 'utama', v_gambar.utama, 'urutan', v_gambar.urutan);
END $$;
REVOKE ALL ON FUNCTION public.ipro_ubah_gambar(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ipro_ubah_gambar(uuid,uuid,jsonb) TO authenticated;

CREATE FUNCTION public.ipro_hapus_gambar(p_proyek_id uuid, p_gambar_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_proyek public.ipro_proyek; v_gambar public.ipro_gambar;
BEGIN
  IF NOT coalesce(public.boleh_kelola_investasi(), false) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE = '42501';
  END IF;
    SELECT p.id, p.sumber, p.status, p.slug, p.judul, p.judul_en, p.ringkasan, p.ringkasan_en, p.deskripsi,
    p.deskripsi_en, p.sektor, p.kab_kota, p.lokasi_teks, p.lat, p.lng, p.pemilik, p.nilai_investasi, p.mata_uang,
    p.nilai_teks, p.irr_persen, p.npv_nilai, p.payback_bulan, p.skema, p.status_lahan, p.luas_ha, p.tahap_kajian,
    p.perizinan, p.dokumen_id, p.kontak_instansi, p.kontak_email, p.kontak_telepon, p.sumber_url, p.sumber_slug,
    p.urutan, p.diterbitkan_pada, p.versi, p.dibuat_oleh, p.diubah_oleh, p.dibuat_pada, p.diubah_pada INTO v_proyek
    FROM public.ipro_proyek AS p WHERE p.id = p_proyek_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'; END IF;
    SELECT g.id, g.proyek_id, g.kunci, g.kunci_mini, g.lebar, g.tinggi, g.alt, g.alt_en, g.keterangan,
    g.keterangan_en, g.utama, g.urutan, g.dibuat_oleh, g.dibuat_pada INTO v_gambar FROM public.ipro_gambar AS g
    WHERE g.proyek_id = p_proyek_id AND g.id = p_gambar_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'; END IF;
  IF v_proyek.status = 'terbit' AND (v_gambar.utama OR v_proyek.sumber = 'foila') THEN
    RAISE EXCEPTION 'SYARAT_TERBIT' USING ERRCODE = '23514', DETAIL = '["gambar_utama"]';
  END IF;
  DELETE FROM public.ipro_gambar WHERE proyek_id = p_proyek_id AND id = p_gambar_id;
  RETURN jsonb_build_object('id', v_gambar.id, 'kunci', v_gambar.kunci, 'kunci_mini', v_gambar.kunci_mini);
END $$;
REVOKE ALL ON FUNCTION public.ipro_hapus_gambar(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ipro_hapus_gambar(uuid,uuid) TO authenticated;

CREATE FUNCTION public.ipro_ubah_status(p_proyek_id uuid, p_status text, p_versi integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_proyek public.ipro_proyek; v_kurang text[];
BEGIN
  IF NOT coalesce(public.boleh_kelola_investasi(), false) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE = '42501';
  END IF;
    SELECT p.id, p.sumber, p.status, p.slug, p.judul, p.judul_en, p.ringkasan, p.ringkasan_en, p.deskripsi,
    p.deskripsi_en, p.sektor, p.kab_kota, p.lokasi_teks, p.lat, p.lng, p.pemilik, p.nilai_investasi, p.mata_uang,
    p.nilai_teks, p.irr_persen, p.npv_nilai, p.payback_bulan, p.skema, p.status_lahan, p.luas_ha, p.tahap_kajian,
    p.perizinan, p.dokumen_id, p.kontak_instansi, p.kontak_email, p.kontak_telepon, p.sumber_url, p.sumber_slug,
    p.urutan, p.diterbitkan_pada, p.versi, p.dibuat_oleh, p.diubah_oleh, p.dibuat_pada, p.diubah_pada INTO v_proyek
    FROM public.ipro_proyek AS p WHERE p.id = p_proyek_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('draf','terbit','arsip') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;
  IF v_proyek.versi IS DISTINCT FROM p_versi THEN
    RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE = '40001';
  END IF;
  IF p_status = 'terbit' THEN
    v_kurang := public.ipro_kekurangan_terbit(p_proyek_id);
    IF cardinality(v_kurang) > 0 THEN
      RAISE EXCEPTION 'SYARAT_TERBIT' USING ERRCODE = '23514', DETAIL = to_jsonb(v_kurang)::text;
    END IF;
  END IF;
    UPDATE public.ipro_proyek SET status = p_status WHERE id = p_proyek_id RETURNING id, sumber, status, slug,
    judul, judul_en, ringkasan, ringkasan_en, deskripsi, deskripsi_en, sektor, kab_kota, lokasi_teks, lat, lng,
    pemilik, nilai_investasi, mata_uang, nilai_teks, irr_persen, npv_nilai, payback_bulan, skema, status_lahan,
    luas_ha, tahap_kajian, perizinan, dokumen_id, kontak_instansi, kontak_email, kontak_telepon, sumber_url,
    sumber_slug, urutan, diterbitkan_pada, versi, dibuat_oleh, diubah_oleh, dibuat_pada, diubah_pada INTO v_proyek;
  -- Hanya kolom publik sesuai kontrak admin, tanpa UUID audit staf.
  RETURN jsonb_build_object(
    'id', v_proyek.id, 'sumber', v_proyek.sumber, 'slug', v_proyek.slug,
    'judul', v_proyek.judul, 'judul_en', v_proyek.judul_en, 'ringkasan', v_proyek.ringkasan,
    'ringkasan_en', v_proyek.ringkasan_en, 'sektor', v_proyek.sektor, 'kab_kota', v_proyek.kab_kota,
    'nilai_investasi', v_proyek.nilai_investasi, 'mata_uang', v_proyek.mata_uang, 'nilai_teks', v_proyek.nilai_teks,
    'irr_persen', v_proyek.irr_persen, 'tahap_kajian', v_proyek.tahap_kajian, 'sumber_url', v_proyek.sumber_url,
    'urutan', v_proyek.urutan, 'diterbitkan_pada', v_proyek.diterbitkan_pada, 'deskripsi', v_proyek.deskripsi,
    'deskripsi_en', v_proyek.deskripsi_en, 'lokasi_teks', v_proyek.lokasi_teks, 'lat', v_proyek.lat,
    'lng', v_proyek.lng, 'pemilik', v_proyek.pemilik, 'npv_nilai', v_proyek.npv_nilai,
    'payback_bulan', v_proyek.payback_bulan, 'skema', v_proyek.skema, 'status_lahan', v_proyek.status_lahan,
    'luas_ha', v_proyek.luas_ha, 'perizinan', v_proyek.perizinan, 'dokumen_id', v_proyek.dokumen_id,
    'kontak_instansi', v_proyek.kontak_instansi, 'kontak_email', v_proyek.kontak_email, 'kontak_telepon', v_proyek.kontak_telepon,
    'diubah_pada', v_proyek.diubah_pada, 'status', v_proyek.status, 'sumber_slug', v_proyek.sumber_slug,
    'versi', v_proyek.versi, 'dibuat_pada', v_proyek.dibuat_pada);
END $$;
REVOKE ALL ON FUNCTION public.ipro_ubah_status(uuid,text,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ipro_ubah_status(uuid,text,integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
