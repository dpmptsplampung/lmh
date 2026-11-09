-- Rollback 202611090012: kembalikan deteksi kontak versi 202611090002.
-- Jalankan satu transaksi: node scripts/apply-migration.mjs docs/rollback-umkm-kontak-kata-utuh-202611090012.sql --atomic
-- Tidak mengubah data.
CREATE OR REPLACE FUNCTION umkm_private.ada_kontak(p_teks text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE teks text; kelompok text[]; grup text[]; sisa text; i integer;
BEGIN
  teks := translate(normalize(coalesce(p_teks,''), NFKC),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९', '012345678901234567890123456789');
  FOR i IN 0..9 LOOP teks := replace(teks, '%3' || i::text, i::text); END LOOP;
  IF teks ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,}|tel:|mailto:'
    OR teks ~* 'wa[[:space:]]*[.][[:space:]]*(me|link)|whatsapp[[:space:]]*[.][[:space:]]*com'
    OR teks ~* 't[[:space:]]*[.][[:space:]]*me|linktr[[:space:]]*[.][[:space:]]*ee' THEN
    RETURN true;
  END IF;
  teks := regexp_replace(teks, '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', ' ', 'gi');
  teks := regexp_replace(teks, '\mrp[.]?[[:space:]]*[1-9][0-9.,]*', ' ', 'gi');
  teks := regexp_replace(teks, '[^[:alnum:]]+', ' ', 'g');
  FOR kelompok IN SELECT regexp_matches(teks, '[0-9]+(?:[^[:alnum:]]{1,3}[0-9]+)*', 'g') LOOP
    grup := regexp_split_to_array(kelompok[1], '[^0-9]+');
    sisa := '';
    FOR i IN REVERSE array_length(grup,1)..1 LOOP
      sisa := grup[i] || sisa;
      EXIT WHEN length(sisa) > 15;
      IF length(sisa) >= 9 AND sisa ~ '^(0[1-9]|62|8[1-9])' THEN RETURN true; END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION umkm_private.ada_kontak(text) FROM PUBLIC, anon, authenticated, service_role;
