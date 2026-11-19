# Rancangan IPRO PTSP (Investment Project Ready to Offer)

Tanggal: 2026-11-19. Branch: `investmentgallery`. Status: rancangan untuk dikerjakan worker; menunggu jawaban §13.
Keputusan pemilik yang menjadi dasar (final): IPRO PTSP lebih lengkap dari FOILA, satu tabel dua sumber,
pengelola admin + petugas bermodul `investasi`, tombol "Hubungi petugas" berpola UMKM, angka IRR/NPV/nilai publik,
formulir tanpa login, kolom `_en` sejak awal.

**Prasyarat penerapan.** Semua migrasi di sini memakai `public.staf_modul()` dan `public.lingkup_layanan_saya()`
dari `202611160001_lingkup_layanan_staf.sql`. Per 16 Nov migrasi itu BELUM diterapkan ke produksi, dan
`layanan.modul='investasi'` untuk Layanan "Investment Gallery" diisi oleh migrasi yang sama. Migrasi IPRO hanya
boleh diterapkan sesudah `202611160001`-`0004`. PM memeriksa ini (baca-saja) sebelum meminta izin pemilik.

---

## 1. Tujuan dan non-tujuan

**Tujuan**
1. Satu tabel `ipro_proyek` untuk dua jenis entri: `sumber='ptsp'` (proyek lengkap dengan halaman detail, galeri
   gambar, dokumen kajian ber-watermark, kontak dinas) dan `sumber='foila'` (kartu cuplikan yang menaut keluar ke FOILA).
2. Hub publik `/investasi` (Server Component, `revalidate = 60`) berisi: IPRO PTSP, kartu FOILA, cuplikan Dokumen
   Investasi (galeri yang ada), dan seksi Peta Potensi (sebaran per sektor dan kabupaten/kota).
3. Halaman detail `/investasi/ipro/[slug]` yang dirender di server, bisa diindeks mesin pencari, dengan tombol
   "Hubungi petugas".
4. Pesan "Hubungi petugas" masuk ke **satu Kotak Masuk Investasi** (tabel `investasi_lead` yang diperluas) yang
   dikelola admin dan petugas bermodul `investasi`, dengan notifikasi email.
5. Petugas bermodul `investasi` mendapat fitur pengelolaan (janji ADR 0004): IPRO, Kotak Masuk, dan (Paket B)
   Dokumen Investasi.
6. Paket B: unggah PDF dokumen investasi langsung ke R2 (presigned PUT, menembus batas body Vercel 4,5 MB) dan render
   halaman PNG bertahap sehingga tidak terikat batas durasi satu fungsi.

**Non-tujuan (v1)**
- Antarmuka berbahasa Inggris. Kolom `_en` sudah ada dan bisa diisi; halaman `?lang=en` menyusul.
- Peta interaktif berbasis ubin (Leaflet/OSM): butuh pustaka baru dan perubahan CSP. `lat`/`lng` disimpan sekarang.
- Penarikan otomatis data atau gambar dari FOILA (scraping atau fetch URL). Admin mengisi kartu FOILA secara manual.
- Konten IPRO sebagai sumber RAG chatbot. Bila kelak ditambahkan, hanya `sumber='ptsp'` (lihat §8).
- Markdown/HTML di deskripsi. v1 = teks polos dengan paragraf.
- Mengganti penampil dokumen `/gallery` secara menyeluruh; v1 hanya mengekstrak dialog penampilnya (§6.3).

---

## 2. Model data

### 2.1 `public.ipro_proyek`

| Kolom | Tipe | Constraint | Alasan |
|---|---|---|---|
| `id` | `uuid` PK | `DEFAULT gen_random_uuid()` | Pola semua tabel. |
| `sumber` | `text NOT NULL` | `CHECK (sumber IN ('ptsp','foila'))` | Keputusan pemilik 1: satu tabel dua jenis. |
| `status` | `text NOT NULL DEFAULT 'draf'` | `CHECK (status IN ('draf','terbit','arsip'))` | Arsip menggantikan hapus agar URL dan riwayat lead tetap. |
| `slug` | `text NOT NULL UNIQUE` | `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 120)` | URL detail stabil. Dibuat server dari judul bila kosong. Terkunci setelah pertama terbit (trigger). |
| `judul` | `text NOT NULL` | `char_length(btrim(judul)) BETWEEN 3 AND 200` | |
| `judul_en` | `text` | NULL atau 3..200 | Keputusan 6. |
| `ringkasan` | `text NOT NULL` | 1..600 | Teks kartu dan meta description. Teks polos. |
| `ringkasan_en` | `text` | NULL atau 1..600 | |
| `deskripsi` | `text` | NULL atau ≤ 20000 | Teks polos; paragraf dipisah baris kosong. Hanya PTSP. |
| `deskripsi_en` | `text` | NULL atau ≤ 20000 | |
| `sektor` | `text NOT NULL` | `CHECK (sektor IN ('pertanian','perikanan','pariwisata','industri','energi','infrastruktur','kawasan','jasa','lainnya'))` | Dipakai filter dan seksi Peta Potensi. Enam nilai pertama = `SEKTOR` di `/peta-potensi` sekarang. Daftar belum pasti (§13 P4). |
| `kab_kota` | `text NOT NULL` | `char_length BETWEEN 3 AND 60` | Daftar sah divalidasi zod dari `KABUPATEN_KOTA` (`lib/umkm-katalog/wilayah.ts`) + `'Lintas Kabupaten/Kota'`. Tidak diulang di SQL agar satu sumber daftar wilayah. |
| `lokasi_teks` | `text` | NULL atau ≤ 300 | Kecamatan/desa/kawasan. |
| `lat`, `lng` | `numeric(9,6)` | keduanya NULL atau keduanya terisi; `lat BETWEEN -6.6 AND -3.0`, `lng BETWEEN 103.0 AND 106.6` | Kotak batas Lampung (longgar). Untuk peta kelak. |
| `pemilik` | `text` | NULL atau ≤ 200 | Instansi pemilik/pemrakarsa proyek. |
| `nilai_rp` | `numeric(18,0)` | NULL atau `>= 0` | Keputusan 4: tampil publik. Rupiah utuh. |
| `irr_persen` | `numeric(6,2)` | NULL atau `BETWEEN -100 AND 1000` | |
| `npv_rp` | `numeric(18,0)` | NULL (boleh negatif) | |
| `payback_bulan` | `integer` | NULL atau `BETWEEN 1 AND 600` | UI menampilkan "x tahun y bulan". |
| `skema` | `text` | NULL atau `IN ('kpbu','b2b','bumd','swasta_penuh','lainnya')` | Belum pasti; nilai `lainnya` jadi katup. |
| `status_lahan` | `text` | NULL atau `IN ('milik_pemda','milik_bumn_bumd','milik_swasta','milik_masyarakat','belum_ditetapkan')` | Belum pasti. |
| `luas_ha` | `numeric(12,2)` | NULL atau `> 0` | |
| `tahap_kajian` | `text` | NULL atau `IN ('pra_fs','fs','ipro')` | Keputusan pemilik (Pre-FS/FS/IPRO). |
| `perizinan` | `text` | NULL atau ≤ 2000 | Ringkasan status izin, teks polos. |
| `dokumen_id` | `uuid` | `REFERENCES investment_documents(id) ON DELETE SET NULL` | Dokumen kajian ber-watermark yang sudah ada; satu dokumen utama cukup untuk v1. |
| `kontak_instansi` | `text` | NULL atau ≤ 200 | Kontak lembaga, bukan pribadi (§10). |
| `kontak_email` | `text` | NULL atau `~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'` dan ≤ 254 | |
| `kontak_telepon` | `text` | NULL atau `~ '^\+?[0-9][0-9 \-]{5,19}$'` | |
| `sumber_url` | `text` | lihat constraint `ipro_sumber_sah` | Tautan proyek FOILA. |
| `sumber_slug` | `text` | NULL atau ≤ 200 | Penanda proyek di FOILA (segmen akhir path), untuk cegah duplikat. |
| `urutan` | `integer NOT NULL DEFAULT 0` | | Urutan tampil manual. |
| `diterbitkan_pada` | `timestamptz` | | Diisi trigger saat pertama `terbit`. |
| `versi` | `integer NOT NULL DEFAULT 1` | `> 0` | Kunci optimistik; dua editor tidak saling menimpa. |
| `dibuat_oleh`, `diubah_oleh` | `uuid` | `REFERENCES petugas(id) ON DELETE SET NULL` | Diisi trigger, bukan klien. |
| `dibuat_pada`, `diubah_pada` | `timestamptz NOT NULL DEFAULT now()` | | |

Constraint tabel:
- `ipro_sumber_sah`:
  `(sumber = 'ptsp' AND sumber_url IS NULL AND sumber_slug IS NULL) OR
   (sumber = 'foila' AND sumber_url ~ '^https://invest\.lampungprov\.go\.id/[^[:space:]]*$'
     AND deskripsi IS NULL AND deskripsi_en IS NULL AND dokumen_id IS NULL
     AND kontak_instansi IS NULL AND kontak_email IS NULL AND kontak_telepon IS NULL)`.
  Alasan: kartu FOILA tidak boleh diam-diam berubah menjadi halaman detail.
- `ipro_terbit_bertanggal`: `status <> 'terbit' OR diterbitkan_pada IS NOT NULL`.

Indeks:
- `ipro_publik_urut ON (status, sumber, urutan, diterbitkan_pada DESC) WHERE status = 'terbit'` (hub).
- `ipro_sektor ON (sektor) WHERE status = 'terbit'`, `ipro_kab_kota ON (kab_kota) WHERE status = 'terbit'`.
- `ipro_foila_unik UNIQUE ON (sumber_slug) WHERE sumber = 'foila' AND sumber_slug IS NOT NULL`.
- `ipro_dokumen ON (dokumen_id)` (FK).

Trigger `BEFORE INSERT OR UPDATE` `ipro_isi_audit()` (SECURITY DEFINER, `search_path = pg_catalog, public`):
- isi `dibuat_oleh`/`diubah_oleh` dari `petugas.id` milik `auth.uid()`, `diubah_pada = now()`;
- pada UPDATE: `NEW.versi := OLD.versi + 1`; tolak `sumber` berubah (`INPUT_TIDAK_VALID`);
- tolak perubahan `slug` bila `OLD.diterbitkan_pada IS NOT NULL` (`SLUG_TERKUNCI`, ERRCODE `22023`);
- bila `NEW.status = 'terbit'` dan `NEW.diterbitkan_pada IS NULL` → isi `now()`.
Trigger `AFTER UPDATE OF status` memakai fungsi yang ada `public.audit_change('update_status')` (sama dengan
`investasi_lead`).

Syarat terbit yang lintas tabel (PTSP wajib punya gambar utama dan `deskripsi`; FOILA wajib punya satu gambar) dicek di
route `status` (§4), bukan CHECK, karena CHECK tidak bisa membaca tabel lain.

### 2.2 `public.ipro_gambar`

| Kolom | Tipe | Constraint |
|---|---|---|
| `id` | `uuid` PK | |
| `proyek_id` | `uuid NOT NULL` | `REFERENCES ipro_proyek(id) ON DELETE CASCADE` |
| `kunci` | `text NOT NULL UNIQUE` | `~ '^ipro-gambar/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'` |
| `kunci_mini` | `text NOT NULL UNIQUE` | `~ '^ipro-gambar/[0-9a-f-]{36}/[0-9a-f-]{36}-640\.webp$'` |
| `lebar`, `tinggi` | `integer NOT NULL` | `BETWEEN 1 AND 4000` |
| `alt` | `text NOT NULL` | `char_length(btrim(alt)) BETWEEN 3 AND 200` (a11y wajib) |
| `alt_en` | `text` | NULL atau 3..200 |
| `keterangan`, `keterangan_en` | `text` | NULL atau ≤ 300 |
| `utama` | `boolean NOT NULL DEFAULT false` | |
| `urutan` | `integer NOT NULL DEFAULT 0` | |
| `dibuat_oleh` | `uuid` | `REFERENCES petugas(id) ON DELETE SET NULL` |
| `dibuat_pada` | `timestamptz NOT NULL DEFAULT now()` | |

Indeks: `ipro_gambar_satu_utama UNIQUE ON (proyek_id) WHERE utama`, `ipro_gambar_proyek ON (proyek_id, urutan)`.
Alasan tabel terpisah (bukan `text[]`): perlu alt per gambar, urutan, dan satu gambar utama yang dijaga indeks.
Tidak ada FK `ipro_proyek.gambar_utama_id` supaya tidak ada FK melingkar. Batas 12 gambar per proyek PTSP dan 1 per
kartu FOILA dijaga route.

Yang disimpan adalah **kunci** objek R2, bukan URL. URL publik dibentuk di server dengan `urlPublik(kunci)`
(`lib/storage/r2.ts`) sehingga pindah domain R2 tidak butuh migrasi data.

### 2.3 Kotak Masuk Investasi: memperluas `public.investasi_lead`

**Keputusan:** pesan IPRO masuk ke `investasi_lead` yang sudah ada, bukan tabel baru `ipro_pesan`.

Alasan:
- `investasi_lead` sudah tabel minat investasi dengan alur status yang cocok untuk calon investor
  (`baru`, `dihubungi`, `berlanjut`, `ditolak`, `selesai`), trigger audit status, pencatat laju anonim
  (`trg_log_investasi_lead_insert` → `anon_rate_limit` aksi `investasi_lead_insert`), halaman `/admin/investasi-leads`,
  dan route `PATCH /api/investasi/lead/[id]`.
- Petugas Investment Gallery cukup membuka satu kotak masuk untuk lead dokumen dan pesan IPRO.
- Fungsi UMKM (`umkm_private.jaga_laju`, `kirim_publik`, `aktor`) terkunci ke aksi dan modul UMKM, jadi yang dipakai
  ulang adalah **polanya**: RPC SECURITY DEFINER untuk kiriman publik, kunci `operasi_id` idempoten, tiga lapis batas
  laju dengan advisory lock, tanda terima tanpa gema isi, dan kunci versi untuk perubahan status.

Alternatif yang ditolak: tabel `ipro_pesan` model ambil/selesai UMKM. Ditolak karena membuat dua kotak masuk investasi
dan dua halaman, dan alur investor lebih panjang dari "ditangani".

Kolom tambahan (semua nullable atau berdefault, jadi baris lama aman):

| Kolom | Tipe | Catatan |
|---|---|---|
| `kanal` | `text NOT NULL DEFAULT 'dokumen'` | `CHECK (kanal IN ('dokumen','ipro'))`. Bukan kolom turunan karena `ipro_id` bisa jadi NULL lewat `ON DELETE SET NULL`. |
| `ipro_id` | `uuid` | `REFERENCES ipro_proyek(id) ON DELETE SET NULL` |
| `no_hp` | `text` | NULL atau `~ '^\+?[0-9]{8,20}$'` (dinormalkan RPC) |
| `aktor_uid` | `uuid` | `auth.uid()` pengirim (sesi anonim). Tanpa FK, sama dengan UMKM. |
| `operasi_id` | `uuid` | Kunci idempoten dari klien. |
| `sidik` | `text` | Hash isi kiriman (`md5(jsonb::text)`) untuk mendeteksi `KONFLIK_OPERASI`. |
| `consent_id` | `uuid` | `REFERENCES consent_log(id) ON DELETE SET NULL`. Bukti persetujuan PDP untuk baris ini. |
| `petugas_id` | `uuid` | `REFERENCES petugas(id) ON DELETE SET NULL`. Penangan pertama. |
| `versi` | `integer NOT NULL DEFAULT 1` | `> 0` |
| `aktivitas_pada` | `timestamptz NOT NULL DEFAULT now()` | Dasar retensi. Backfill `aktivitas_pada = updated_at` untuk baris lama. |

Constraint: `investasi_lead_konteks_kanal CHECK ((kanal = 'ipro' AND doc_id IS NULL) OR
(kanal = 'dokumen' AND ipro_id IS NULL))` (satu baris satu konteks; baris lama otomatis `dokumen` dengan `ipro_id` NULL).
Indeks: `UNIQUE (aktor_uid, operasi_id) WHERE operasi_id IS NOT NULL`, `(kanal, status, created_at DESC)`, `(ipro_id)`,
`(petugas_id)`, `(aktivitas_pada)`.
Pemetaan isian: `pesan` formulir → kolom `catatan` (≤ 2000); `instansi` → `instansi`; `minat` tidak dipakai kanal `ipro`.

### 2.4 `public.investment_documents` (Paket B)

- Status diperluas: `CHECK (status IN ('diproses','aktif','nonaktif','gagal'))` (ganti constraint lama lewat
  `DROP CONSTRAINT ... ; ADD CONSTRAINT ...` di migrasi baru). Policy baca publik tetap `status = 'aktif'`.
- Kolom baru: `halaman_selesai integer NOT NULL DEFAULT 0` (jumlah halaman yang sudah dirender), `galat text`
  (≤ 500, pesan teknis tanpa PII), `diproses_pada timestamptz`.
- Policy baru `investment_kelola_modul FOR ALL TO authenticated USING ((SELECT public.boleh_kelola_investasi()))
  WITH CHECK (...)`. Policy lama `investment_admin_all` dibiarkan (admin tetap lolos lewat keduanya).

### 2.5 Yang jujur belum pasti

- Daftar `sektor`, `skema`, `status_lahan`: usulan arsitek, belum dicocokkan dengan klasifikasi FOILA/BKPM. Mengubahnya
  kelak = migrasi baru yang mengganti CHECK.
- Bentuk URL proyek FOILA dan apakah FOILA menampilkan nilai dalam Rupiah atau USD belum diverifikasi. `sumber_slug`
  diambil dari segmen akhir path; bila FOILA memakai query string, aturan ekstraksi di `lib/investasi/foila.ts` disesuaikan.
- Isi produksi `investasi_lead` (jumlah baris, apakah ada `status` tak lazim) belum diperiksa. Migrasi hanya menambah
  kolom dan mengganti policy, tidak mengubah isi selain backfill `aktivitas_pada`.
- Apakah `202611160001` sudah diterapkan saat migrasi ini siap: diperiksa PM (lihat Prasyarat).

---

## 3. RLS, hak akses, dan migrasi

### 3.1 Helper baru

```sql
CREATE FUNCTION public.boleh_kelola_investasi() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(
    (public.get_my_role() = 'admin' AND public.sesi_valid())
    OR public.staf_modul() = 'investasi',
  false)
$$;
REVOKE ALL ON FUNCTION public.boleh_kelola_investasi() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kelola_investasi() TO authenticated;
```
Alasan: `get_my_role()` (petugas aktif) + `sesi_valid()` untuk admin; `staf_modul()` sudah memuat `sesi_valid()` lewat
`lingkup_layanan_saya()` dan hanya bernilai untuk role `petugas`. Front Office sengaja tidak termasuk (ADR 0004: FO
tidak mengubah data layanan). Di policy selalu dibungkus `(SELECT public.boleh_kelola_investasi())` supaya dievaluasi
sekali per kueri, bukan per baris.

### 3.2 Policy

`ipro_proyek` (`ENABLE ROW LEVEL SECURITY`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; lalu
`GRANT SELECT TO anon, authenticated`, `GRANT INSERT, UPDATE, DELETE TO authenticated`):
- `ipro_publik_baca FOR SELECT TO anon, authenticated USING (status = 'terbit')`
- `ipro_kelola_baca FOR SELECT TO authenticated USING ((SELECT public.boleh_kelola_investasi()))`
- `ipro_kelola_tambah FOR INSERT TO authenticated WITH CHECK ((SELECT public.boleh_kelola_investasi()))`
- `ipro_kelola_ubah FOR UPDATE TO authenticated USING (...) WITH CHECK (...)` (helper yang sama)
- `ipro_kelola_hapus FOR DELETE TO authenticated USING ((SELECT public.boleh_kelola_investasi()) AND status = 'draf')`

`ipro_gambar` (grant sama):
- `ipro_gambar_publik FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.ipro_proyek p
   WHERE p.id = proyek_id AND p.status = 'terbit'))`
- `ipro_gambar_kelola FOR ALL TO authenticated USING (helper) WITH CHECK (helper)`

`investasi_lead`:
- `DROP POLICY investasi_lead_insert` dan `REVOKE INSERT, UPDATE ON public.investasi_lead FROM authenticated`. Semua
  sisipan lewat RPC `investasi_kirim_minat`, semua perubahan status lewat RPC `investasi_ubah_status_minat`.
  Alasan: policy lama mengizinkan klien menyisipkan baris dengan `status`/`petugas_id` sembarang lewat PostgREST.
- `DROP POLICY investasi_lead_select_staff` lalu buat ulang dengan
  `USING ((SELECT public.boleh_kelola_investasi()))`. `DROP POLICY investasi_lead_update_admin`.

### 3.3 RPC

**`public.investasi_kirim_minat(p_kanal text, p_ref_id uuid, p_nama text, p_email text, p_no_hp text,
p_instansi text, p_pesan text, p_setuju_pdp boolean, p_versi_kebijakan text, p_operasi_id uuid) RETURNS jsonb`**
(plpgsql, SECURITY DEFINER, `SET search_path = pg_catalog, pg_temp`, semua objek ditulis `public.`):
1. `auth.uid()` NULL → `LOGIN_DIPERLUKAN` (28000). `NOT public.sesi_valid()` → `DILARANG` (42501).
2. Validasi, gagal → `INPUT_TIDAK_VALID` (22023): `p_kanal IN ('ipro','dokumen')`; `p_operasi_id` dan `p_ref_id` tidak
   NULL; nama 1..200 setelah `btrim`; email ≤ 254 dan cocok pola; `p_no_hp` dinormalkan
   (`regexp_replace(..., '[[:space:].()\-]', '', 'g')`) lalu NULL atau `^\+?[0-9]{8,20}$`; instansi ≤ 200;
   pesan: kanal `ipro` wajib 10..2000, kanal `dokumen` ≤ 2000; `p_setuju_pdp IS TRUE`; versi kebijakan 1..20 karakter.
3. Konteks harus publik, gagal → `TIDAK_DITEMUKAN` (P0002): `ipro` = `ipro_proyek` `status='terbit' AND sumber='ptsp'`;
   `dokumen` = `investment_documents.status='aktif'`.
4. `pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_operasi_id::text, 0))`; bila baris
   `(aktor_uid, operasi_id)` sudah ada: `sidik` sama → kembalikan `{"id": ...}`; beda → `KONFLIK_OPERASI` (40001).
5. Batas laju (pola `umkm_private.jaga_laju`): `pg_advisory_xact_lock(hashtextextended('investasi.laju', 0))`;
   tolak `TERLALU_BANYAK` (P0001) bila `NOT check_anon_rate('investasi_lead_insert', 5, 3600)` atau
   `NOT check_anon_rate('investasi_lead_insert', 20, 86400)` atau jumlah global aksi itu dalam 600 detik ≥ 100.
   Baris laju dicatat oleh trigger lama `trg_log_investasi_lead_insert`; RPC tidak menyisipkan sendiri.
6. `INSERT INTO public.consent_log (subjek_ref, tujuan, disetujui, versi_kebijakan) VALUES (auth.uid()::text,
   'investasi_minat', true, p_versi_kebijakan) RETURNING id`.
7. `INSERT INTO public.investasi_lead (...)` dengan `status='baru'`, `kanal`, `ipro_id`/`doc_id`, `consent_id`.
8. Notifikasi (§9).
9. `RETURN jsonb_build_object('id', id_baru)`. Tidak menggemakan isi (pola tanda terima UMKM).

**`public.investasi_ubah_status_minat(p_id uuid, p_status text, p_versi integer) RETURNS jsonb`** (SECURITY DEFINER):
`NOT boleh_kelola_investasi()` → `DILARANG`; status di luar lima nilai → `INPUT_TIDAK_VALID`; `SELECT ... FOR UPDATE`;
tidak ada → `TIDAK_DITEMUKAN`; `versi <> p_versi` → `KONFLIK_VERSI` (40001). `UPDATE` status, `versi + 1`,
`aktivitas_pada = clock_timestamp()`, `petugas_id = coalesce(petugas_id, <id petugas pemanggil>)`. Kembalikan
`{id, status, versi}`. Audit tercatat oleh trigger `trg_audit_investasi_lead_status` yang ada.

Kedua RPC: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ... TO authenticated`.
Pengunjung tanpa login tetap `authenticated` karena sesi anonim Supabase (keputusan 5).

### 3.4 Retensi

Fungsi `public.investasi_bersihkan_retensi()` + `cron.schedule('investasi_retensi_harian','25 19 * * *', ...)` (pola
`202611090007_umkm_retensi.sql`): hapus `investasi_lead` dengan `status IN ('selesai','ditolak')` dan
`aktivitas_pada < now() - interval '365 days'`, batch 500, `FOR UPDATE SKIP LOCKED`. Baris `consent_log` tidak
dihapus (bukti persetujuan, hanya berisi UID). Angka 365 hari menunggu §13 P1.

### 3.5 Daftar migrasi

Nomor terakhir di repo: `202611160004`. Bila ada migrasi lain masuk lebih dulu, worker memakai nomor berikutnya yang
lebih besar. Tanpa `BEGIN/COMMIT` di berkas (dijaga `mengandungKontrolTransaksi` di test). Setiap migrasi baru
didaftarkan ke `supabase/migrations/MANIFEST.json` lewat `node scripts/gen-migration-manifest.mjs` (lokal, tidak
menyentuh DB).

| Berkas | Isi | Test kontrak |
|---|---|---|
| `202611190001_ipro_inti.sql` | `boleh_kelola_investasi()`, `ipro_proyek`, `ipro_gambar`, trigger, policy, grant | `202611190001_ipro_inti.test.ts` |
| `202611190002_investasi_kotak_masuk.sql` | kolom `investasi_lead`, policy baru, dua RPC, notifikasi, retensi + cron | `202611190002_investasi_kotak_masuk.test.ts` |
| `202611190003_investasi_dokumen_proses.sql` | Paket B: status/kolom `investment_documents`, policy modul | `202611190003_investasi_dokumen_proses.test.ts` |
| `202611190004_nav_lencana_investasi.sql` | `CREATE OR REPLACE nav_lencana_saya` + kunci `pesanInvestasi` | `202611190004_nav_lencana_investasi.test.ts` |

Penerapan ke produksi hanya oleh PM setelah izin pemilik (host + daftar berkas ditampilkan), sesuai CLAUDE.md.

---

## 4. API

Konvensi: validasi zod `.strict()`, galat berbentuk `{ error: { code, message }, request_id }`, header
`Cache-Control: private, no-store` untuk semua respons non-publik, `export const dynamic = 'force-dynamic'`. Peta kode
RPC → HTTP sama dengan UMKM: `INPUT_TIDAK_VALID` 400, `LOGIN_DIPERLUKAN` 401, `DILARANG` 403, `TIDAK_DITEMUKAN` 404,
`KONFLIK_*`/`SLUG_TERKUNCI` 409, `TERLALU_BANYAK` 429 (+ `Retry-After: 60`), lain 500. Peta ini ditulis di
`lib/investasi/http.ts` (tidak mengimpor `lib/umkm-katalog/server.ts` agar domain tidak saling bergantung).
Batas badan JSON: 16 KiB (tolak lewat `content-length` dan panjang hasil baca).

### 4.1 Publik

Hub dan detail **tidak** memakai API JSON; Server Component membaca lewat `lib/data/publik-server.ts`.

| Route | Metode | Isi | Hasil |
|---|---|---|---|
| `/api/investasi/pesan` | POST | `pesanIproSchema`: `{ ipro_id: uuid, nama: 1..200, email: z.email() ≤254, no_hp?: string, instansi?: ≤200, pesan: 10..2000, setuju_pdp: z.literal(true), operasi_id: uuid, situs_web?: string }` | 201 `{ data: { id } }` |
| `/api/investasi/lead` | POST | (diubah) `{ doc_id, nama, email, instansi?, pesan?, setuju_pdp: true, operasi_id, situs_web? }` | 201 `{ data: { id } }` |

- `situs_web` = honeypot. Bila tidak kosong: balas 201 dengan `id` acak, tidak memanggil RPC, catat
  `logServerEvent('info', { operation: 'investasi.honeypot' })` tanpa isi.
- Sesi: klien memanggil `supabase.auth.signInAnonymously()` bila belum ada sesi (pola `components/umkm-katalog/api.ts`),
  route menolak 401 tanpa user.
- `versi_kebijakan` diambil dari konstanta server `VERSI_KEBIJAKAN_INVESTASI` di `lib/investasi/konstanta.ts`, bukan dari
  klien.
- Route lama `POST /api/investasi/lead` dialihkan ke RPC yang sama (`p_kanal='dokumen'`); field `minat`/`catatan` lama
  digabung jadi `pesan`. Formulir `/gallery` diperbarui (§6.3). Kontrak lama tidak dipertahankan karena satu-satunya
  pemanggil ada di repo.

### 4.2 Pengelola (admin + petugas bermodul investasi)

Otorisasi tiap route: `createClient()` (JWT pengguna) → `auth.getUser()` (401) → `rpc('boleh_kelola_investasi')`
bukan `true` (403). Tulis memakai klien JWT yang sama sehingga RLS tetap berlaku; service role tidak dipakai kecuali R2.
Helper `requireKelolaInvestasi()` di `lib/investasi/akses-server.ts`.

| Route | Metode | Isi | Hasil |
|---|---|---|---|
| `/api/admin/ipro` | POST | `iproBuatSchema` (§5.3), status selalu `draf` | 201 `{ data: IproAdmin }` |
| `/api/admin/ipro/[id]` | PATCH | `iproUbahSchema` + `versi` | 200 `{ data }`. `UPDATE ... .eq('id').eq('versi', v)` mengembalikan 0 baris → baca ulang: tidak ada → 404, ada → 409 `KONFLIK_VERSI` |
| `/api/admin/ipro/[id]` | DELETE | — | 204; 409 `KONFLIK_STATUS` bila bukan draf; objek R2 gambarnya dihapus |
| `/api/admin/ipro/[id]/status` | POST | `{ aksi: 'terbit'\|'arsip'\|'kembali_draf', versi }` | 200; 409 `SYARAT_TERBIT` + daftar kekurangan |
| `/api/admin/ipro/[id]/gambar` | POST | `{ kunci_mentah, alt, alt_en?, keterangan?, keterangan_en?, utama? }` | 201 `{ data: GambarIpro }` |
| `/api/admin/ipro/[id]/gambar/[gambarId]` | PATCH | `{ alt?, alt_en?, keterangan?, keterangan_en?, utama?, urutan? }` | 200 |
| `/api/admin/ipro/[id]/gambar/[gambarId]` | DELETE | — | 204; objek R2 dihapus (gagal hapus objek dicatat `warn`, baris tetap dihapus) |
| `/api/investasi/lead/[id]` | PATCH | (diubah) `{ status, versi }` → RPC `investasi_ubah_status_minat` | 200 `{ data: { id, status, versi } }` |

- Syarat terbit (`SYARAT_TERBIT`): PTSP = `deskripsi` terisi, ada gambar `utama`, `kab_kota` dan `sektor` sah; FOILA =
  `sumber_url` sah dan tepat satu gambar. Admin dan petugas modul sama-sama boleh menerbitkan (keputusan 2).
- `utama: true` pada satu gambar: route mengosongkan `utama` gambar lain dalam proyek yang sama lebih dulu (dua UPDATE
  berurutan; indeks unik menangkap balapan sebagai 409).
- Setelah setiap mutasi yang mengubah data terbit (ubah proyek terbit, ubah status, gambar proyek terbit):
  `revalidateTag('publik-investasi', { expire: 0 })` langsung di route. Tidak lewat `segarkanPublik`, karena
  `/api/admin/revalidasi` khusus admin dan petugas modul juga mengubah data publik.
- `maxDuration = 30` untuk route gambar (sharp).

### 4.3 Penyimpanan (R2)

- `lib/storage/area.ts`: tambah area `'ipro-mentah'` `{ bucket: 'private', mime: GAMBAR, maksByte: 8 MiB,
  peran: ['admin','petugas'], modul: 'investasi' }` dan `'ipro-gambar'` `{ bucket: 'public', mime: ['image/webp'],
  maksByte: 2 MiB, peran: [] }` (hanya ditulis server). Tambah field opsional `modul?: ModulLayanan` ke tipe aturan.
- `api/storage/presign` dan `api/storage/konfirmasi`: bila `staf.role === 'petugas'` dan `aturan.modul` ada, wajib
  `rpc('staf_modul') === aturan.modul` (pola `bolehUnggahDraf`), selain itu 403. Area `ipro-gambar` (`peran: []`)
  otomatis ditolak 403 oleh pemeriksaan peran yang sudah ada.
- Path mentah: klien mengirim `path = <proyek_id>/<uuid>.<ext>`; route `gambar` memeriksa awalan `proyek_id` cocok
  dengan `[id]` di URL.
- Pipeline `lib/investasi/gambar-server.ts`: `getObjectBytes('private', kunci_mentah)` → `sharp(buf, { limitInputPixels:
  40_000_000 }).rotate()` → WebP lebar maks 1600 (q80) dan 640 (q75), tanpa `withMetadata()` sehingga EXIF/GPS terbuang
  → `putObject('public', 'ipro-gambar/<proyek_id>/<uuid>.webp')` dan `...-640.webp` → hapus mentah. Gagal decode →
  400 `INPUT_TIDAK_VALID` dan mentah dihapus.
- CSP tidak berubah: `connect-src` sudah memuat endpoint R2 (presigned PUT) dan `img-src` memuat `R2_PUBLIC_BASE_URL`.

### 4.4 Paket B: dokumen PDF lewat presigned PUT dan render bertahap

1. `ATURAN_AREA['investment-docs']` → `peran: ['admin','petugas'], modul: 'investasi'`.
2. Klien: `POST /api/storage/presign { area: 'investment-docs', path: 'raw/<uuid>.pdf', mime, ukuran }` → PUT langsung
   ke R2 → `POST /api/storage/konfirmasi` (magic bytes `%PDF-`, ukuran ≤ 50 MB).
3. `POST /api/investment-docs` `{ kunci, judul, kategori?, deskripsi?, nilai_investasi?, urutan_tampil? }` →
   cek objek ada, `looksEncrypted` ditolak, hitung halaman (≤ 50) → sisip baris `status='diproses'`,
   `jumlah_halaman=n`, `halaman_selesai=0` → 201 `{ id, jumlah_halaman }`.
4. `POST /api/investment-docs/[id]/render` `{ mulai }` → render paling banyak 8 halaman mulai `halaman_selesai + 1`
   (pdfjs + canvas, skala 1.5 seperti sekarang), simpan PNG, perbarui `halaman_gambar` dan `halaman_selesai` per halaman.
   Bila `mulai` ≠ `halaman_selesai + 1` → 409 (mencegah dua tab merender ganda). Selesai semua → `status='aktif'`,
   `revalidateTag('publik-investasi')`. Galat render → `status='gagal'`, `galat` diisi. `maxDuration = 60`.
   Respons `{ halaman_selesai, jumlah_halaman, selesai }`; klien mengulang sampai `selesai`.
5. Admin page menampilkan baris `diproses` dengan tombol "Lanjutkan pemrosesan" dan `gagal` dengan "Hapus".
6. `POST /api/investment-docs/upload` (multipart) dihapus setelah alur baru lolos uji; testnya dipindah ke route baru.

Alasan render dipicu klien per batch, bukan `after()` atau antrean: `after()` tetap dibatasi `maxDuration` fungsi yang
sama, dan proyek tidak punya pekerja antrean. Batch kecil bisa dilanjutkan bila tab tertutup.

---

## 5. Lapisan data `src/lib/data/investasi.ts` dan domain `src/lib/investasi/`

### 5.1 `src/lib/data/investasi.ts` (pola G0-G9: `SupabaseClient` argumen pertama, `{ data, error }`, tanpa React)

```ts
export const KOLOM_IPRO_KARTU = 'id, sumber, slug, judul, judul_en, ringkasan, ringkasan_en, sektor, kab_kota, nilai_rp, irr_persen, tahap_kajian, sumber_url, urutan, diterbitkan_pada';
export const KOLOM_IPRO_DETAIL = `${KOLOM_IPRO_KARTU}, deskripsi, deskripsi_en, lokasi_teks, lat, lng, pemilik, npv_rp, payback_bulan, skema, status_lahan, luas_ha, perizinan, dokumen_id, kontak_instansi, kontak_email, kontak_telepon, diubah_pada`;
export const KOLOM_IPRO_ADMIN = `${KOLOM_IPRO_DETAIL}, status, sumber_slug, versi, dibuat_pada`;
export const KOLOM_GAMBAR = 'id, proyek_id, kunci, kunci_mini, lebar, tinggi, alt, alt_en, keterangan, keterangan_en, utama, urutan';
export const KOLOM_MINAT_DAFTAR = 'id, kanal, status, versi, nama, instansi, created_at, aktivitas_pada, petugas_id, ipro_id, doc_id, ipro_proyek(judul), investment_documents(judul)';
export const KOLOM_MINAT_DETAIL = `${KOLOM_MINAT_DAFTAR}, email, no_hp, catatan, minat`;
```

Fungsi:
- `daftarIproTerbit(sb)` → kartu `status='terbit'`, urut `urutan, diterbitkan_pada desc`, `.limit(200)`.
- `iproTerbitBySlug(sb, slug)` → detail + gambar (`Promise.all`), hanya `sumber='ptsp'`.
- `gambarUntukProyek(sb, ids: string[])` → `.in('proyek_id', ids).limit(ids.length * 12)`.
- `daftarIproKelola(sb, { status?, sumber?, cari?, dari, sampai })` → `.range()`, `count: 'exact'`; `cari` lewat
  `.ilike('judul', ...)` dengan `%`/`_` di-escape.
- `iproKelolaById(sb, id)` → `KOLOM_IPRO_ADMIN` + gambar.
- `daftarMinat(sb, { kanal?, status?, dari, sampai })`, `minatById(sb, id)` (`KOLOM_MINAT_DETAIL`).
- `daftarDokumenAktif(sb, batas)` → `id, judul, kategori, deskripsi, nilai_investasi, jumlah_halaman, urutan_tampil`
  untuk cuplikan hub.

Tipe: `IproKartu`, `IproDetail`, `IproAdmin`, `GambarIpro`, `MinatRingkas`, `MinatDetail`, `DokumenRingkas`.
Kolom `numeric` dibaca sebagai `number | null`; nilai > 2^53 tidak realistis untuk Rupiah proyek daerah.

### 5.2 `src/lib/data/publik-server.ts` (tambahan)

- `TAG_PUBLIK.investasi = 'publik-investasi'` (otomatis masuk daftar izin `/api/admin/revalidasi`). `TAG_PUBLIK_KLIEN`
  di `segarkanPublik.ts` tidak perlu diubah: route pengelola memanggil `revalidateTag` langsung, dan test route hanya
  menjaga agar daftar klien bagian dari daftar server.
- `muatInvestasiPublik()` = `denganCache('investasi', [TAG_PUBLIK.investasi], ...)` → `{ ptsp: KartuPublik[],
  foila: KartuPublik[], dokumen: DokumenRingkas[], sebaran: { sektor, kab_kota, jumlah }[], galat: boolean }`.
  `KartuPublik` = `IproKartu` + `gambar: { url, url_mini, alt, lebar, tinggi } | null` (URL dibentuk `urlPublik`).
  Sebaran dihitung di JS dari daftar terbit (data kecil), bukan RPC baru.
- `muatIproPublik(slug)` = `denganCache('ipro-detail', [TAG_PUBLIK.investasi], ...)` dengan `slug` masuk kunci cache.
  Tidak ditemukan → `null` (halaman memanggil `notFound()`); galat sesaat → dilempar sesuai aturan `denganCache`.

### 5.3 `src/lib/investasi/`

- `konstanta.ts`: `SEKTOR_IPRO`, `TAHAP_KAJIAN`, `SKEMA_IPRO`, `STATUS_LAHAN` (nilai + label `id`/`en`),
  `KAB_KOTA_IPRO = [...KABUPATEN_KOTA, 'Lintas Kabupaten/Kota']`, `MAKS_GAMBAR_PTSP = 12`,
  `VERSI_KEBIJAKAN_INVESTASI = '1.1'`, `HOST_FOILA = 'invest.lampungprov.go.id'`.
- `skema.ts`: `iproBuatSchema` (diskriminasi `sumber`; cabang `foila` tidak punya field detail), `iproUbahSchema`,
  `statusAksiSchema`, `gambarSchema`. Teks di-`trim`; karakter kontrol C0 kecuali `\n` ditolak.
- `skema-minat.ts`: `pesanIproSchema`, `leadDokumenSchema` (dipakai route dan formulir klien).
- `foila.ts`: `validasiUrlFoila(s)` → `URL` sah bila `protocol === 'https:'`, `hostname === HOST_FOILA`, tanpa
  `username`/`password`, `port === ''`; `slugFoila(url)` = segmen path terakhir non-kosong.
- `slug.ts`: `buatSlug(judul)` (huruf kecil, buang diakritik, non-alnum → `-`, potong 100) + akhiran `-2`, `-3` bila bentrok.
- `format.ts`: `formatRupiahRingkas` (mis. "Rp 1,2 T"), `formatPersen`, `formatPayback(bulan)`.
- `http.ts`, `akses-server.ts` (`server-only`), `gambar-server.ts` (`server-only`).

---

## 6. UI publik

Semua halaman memakai token `src/styles/token.css` (tema publik `:root`), komponen `src/components/ui/` (`Tombol`,
`Kartu`, `Lencana`, `Field`, `KerangkaModal`/`Dialog`, `StatusKosong`), titik putus 640/1024/1280, tanpa hex/rgb literal
dan tanpa z-index literal (pagar `src/test/anggaran-kode.test.ts`). Tidak ada kueri di `page.tsx`.

### 6.1 Hub `/investasi`

Berkas: `src/app/investasi/page.tsx` (≤ 200 baris, `export const revalidate = 60`, `metadata` statis: judul
"Peluang Investasi Lampung", description, `alternates.canonical`), `src/app/investasi/investasi.module.css`,
`src/app/investasi/_bagian/`:
- `SeksiIproPtsp.tsx`: kartu besar (`KartuIpro`), urut `urutan`. Kosong → `StatusKosong`.
- `SaringIpro.tsx` (`'use client'`): saring sektor/kabupaten/tahap di klien atas daftar yang sudah dikirim server; nilai
  saringan disinkronkan ke hash URL (`#sektor=energi`) agar tidak membuat halaman dinamis.
- `SeksiFoila.tsx`: kartu ringkas (`KartuFoila`), judul seksi "Dari portal FOILA".
- `SeksiDokumen.tsx`: maksimal 6 dokumen aktif, tombol ke `/gallery`.
- `SeksiPetaPotensi.tsx` (`id="peta-potensi"`): kisi sektor dengan jumlah proyek dan daftar kabupaten/kota; klik =
  mengatur saringan.

Komponen bersama di `src/components/investasi/`: `KartuIpro.tsx`, `KartuFoila.tsx`, `AngkaKunci.tsx` (nilai, IRR, NPV,
payback, luas; nilai NULL tidak ditampilkan), `GaleriGambar.tsx` (client; dialog lewat `Dialog`), `FormulirHubungi.tsx`
(client), `PenampilDokumen.tsx` (client, §6.3), `investasi.module.css`.

Gambar memakai `next/image` dengan `unoptimized` (sudah dikompres server; tidak menambah `images.remotePatterns` dan
tidak memakai kuota optimasi Vercel), `width`/`height` dari kolom, `sizes` sesuai kisi; kartu memakai `url_mini`.

### 6.2 Detail `/investasi/ipro/[slug]`

Berkas `src/app/investasi/ipro/[slug]/page.tsx` + `_bagian/`:
- `export const revalidate = 60`; `export async function generateStaticParams() { return []; }` (wajib agar jalur
  runtime ikut ISR menurut docs Next 16 `generate-static-params.md`); `params: Promise<{ slug: string }>` di-`await`.
- `generateMetadata`: `title` = judul, `description` = ringkasan (≤ 160), `openGraph.images` = gambar utama,
  `alternates.canonical`. Proyek tak ada/bukan PTSP → `notFound()` (FOILA tidak punya halaman sendiri; kartunya menaut
  langsung keluar).
- Isi: remah roti (Investasi › judul), pahlawan (gambar utama, judul, sektor, kab/kota, tahap), `AngkaKunci`, deskripsi
  (paragraf dari `split(/\n{2,}/)`, dirender sebagai teks), tabel fakta (`Tabel` dengan caption: pemilik, lokasi, luas,
  skema, status lahan, perizinan), `GaleriGambar`, tombol "Lihat dokumen kajian" (membuka `PenampilDokumen` bila
  `dokumen_id` ada), kartu kontak instansi, tombol utama "Hubungi petugas" → `FormulirHubungi` dalam `KerangkaModal`.
- JSON-LD: hanya `BreadcrumbList`, ditulis `<script type="application/ld+json">` dengan
  `JSON.stringify(x).replace(/</g, '\\u003c')` (docs `json-ld.md`). Tidak ada tipe schema.org yang pas untuk tawaran
  proyek investasi, jadi tidak dipaksakan `Product`/`Offer`.
- Penanda `Diperbarui <tanggal WIB>` memakai `lib/time.ts`.

`FormulirHubungi`: field Nama, Email, Nomor HP (opsional), Instansi/Perusahaan (opsional), Pesan (10..2000, penghitung
karakter), honeypot `situs_web` (tersembunyi dari layar dan pembaca layar: `aria-hidden`, `tabIndex={-1}`,
`autoComplete="off"`), centang persetujuan wajib dengan tautan `/kebijakan-privasi`, `operasi_id` dibuat sekali per
pembukaan formulir (`crypto.randomUUID()`), kirim ulang memakai `operasi_id` yang sama. Sukses → pesan "Pesan terkirim.
Petugas akan menghubungi Anda melalui email." tanpa menampilkan ulang isian. 429 → pesan coba lagi.

### 6.3 Nasib `/gallery` dan `/peta-potensi`

- **`/gallery` dipertahankan** sebagai daftar lengkap Dokumen Investasi (judul halaman "Dokumen Investasi", remah roti
  ke `/investasi`). Dialog penampil di `src/app/gallery/page.tsx` diekstrak ke `components/investasi/PenampilDokumen.tsx`
  agar dipakai juga oleh halaman detail. Formulir minat di dialog itu diubah ke kontrak baru §4.1 (centang PDP,
  `operasi_id`, honeypot). Mengubah `/gallery` jadi Server Component penuh di luar cakupan.
- **`/peta-potensi` dialihkan** ke `/investasi#peta-potensi` (`next.config.ts` `redirects`, `permanent: false`) dan
  halamannya dihapus. Alasan: isinya daftar sektor statis bergerbang login; seksi Peta Potensi di hub menggantikannya
  dengan data nyata. Konsekuensi: pencatatan `jejak_minat_investasi` dari halaman itu berhenti (tabel tetap). Menunggu
  §13 P2.
- Tautan "Investasi" di `components/homepage/PulauPengguna.tsx` (2 tempat) dan `BlokLain.tsx` → `/investasi`; tautan
  "Peta Potensi" di `app/me/page.tsx` → `/investasi#peta-potensi`.
- Uji terdampak: `PulauPengguna.test.tsx` (href `/gallery` → `/investasi`), `me.page.test.tsx`,
  `src/test/kebersihan-dasbor.test.ts` (`folderPublik`: hapus `src/app/peta-potensi/`, tambah `src/app/investasi/` dan
  `src/components/investasi/`), `gallery-dialog.test.tsx` dan `gallery-a11y.test.tsx` (penampil pindah komponen),
  `src/test/next-config-security.test.ts` bila menguji daftar redirect.

---

## 7. UI pengelola

### 7.1 Navigasi (`src/lib/admin-nav.ts`)

```ts
{ label: 'IPRO', href: '/admin/ipro', hrefPetugas: '/petugas/investasi/ipro', iconKey: 'gallery',
  roles: ['admin', 'petugas'], group: 'kemitraan', butuhModul: 'investasi' },
{ label: 'Kotak Masuk Investasi', href: '/admin/investasi-leads', hrefPetugas: '/petugas/investasi/kotak-masuk',
  iconKey: 'leads', roles: ['admin', 'petugas'], group: 'kemitraan', butuhModul: 'investasi' },   // ganti entri 'Lead Investasi'
// Paket B: entri 'Investment Gallery' mendapat hrefPetugas '/petugas/investasi/dokumen', roles + 'petugas', butuhModul 'investasi'.
```
Subrute `/admin/ipro/[id]` dan `/petugas/investasi/ipro/[id]` tercakup `cariEntri` (awalan `href + '/'`). Komentar baris 4
("kelak Investasi") diperbarui.

### 7.2 Halaman

Pola UMKM: isi halaman di `src/components/admin/investasi/`, `page.tsx` admin dan petugas hanya membungkus.
- `/admin/ipro` dan `/petugas/investasi/ipro` → `DaftarIpro`: `Tabel` (caption) kolom Judul, Sumber (`Lencana` PTSP/FOILA),
  Sektor, Kab/Kota, Status, Diperbarui; saringan status/sumber/cari; tombol "Tambah IPRO PTSP" dan "Tambah kartu FOILA".
- `/admin/ipro/[id]` (+ `baru?sumber=ptsp|foila`) dan padanan petugas → `FormIpro` dengan `Tab`: Informasi (judul,
  ringkasan, deskripsi, sektor, tahap, skema), Angka (nilai, IRR, NPV, payback, luas), Lokasi (kab/kota, lokasi, lat/lng,
  status lahan, perizinan), Gambar (unggah presign → konfirmasi → POST gambar; atur alt, utama, urutan, hapus), Dokumen &
  Kontak (pilih `investment_documents` aktif; kontak instansi), Bahasa Inggris (semua `_en`), Pratinjau (merender
  komponen `_bagian` halaman detail publik dengan data draf, tanpa URL publik). Form FOILA hanya menampilkan field kartu
  + URL FOILA + satu gambar.
- Aksi status lewat `DialogKonfirmasi`; `SYARAT_TERBIT` ditampilkan sebagai daftar kekurangan; `KONFLIK_VERSI` → minta
  muat ulang.
- Struktur folder per halaman besar: `_logika/` (pemeta form ↔ payload, syarat terbit klien), `_hook/useFormIpro.ts`
  (≤ 250 baris), `_bagian/` (≤ 300 baris per berkas).

### 7.3 Kotak Masuk Investasi

Rekomendasi: **gabung ke `/admin/investasi-leads`** (bukan halaman baru). Halaman itu sudah punya tabel dan alur status
yang tepat; yang berubah:
- isi dipindah ke `components/admin/investasi/KotakMasuk.tsx` (+ `_hook`) sehingga `page.tsx` tidak lagi berisi kueri
  (angka `kueriDiPage` turun; perbarui `anggaran-kode.json` ke angka baru);
- kolom Jenis (Dokumen/IPRO) + judul konteks, saringan jenis dan status;
- `PanelSamping` detail (nama, instansi, email, HP, pesan lengkap, waktu WIB, penangan) dengan tombol "Balas lewat email"
  (`mailto:`) dan pemilih status yang mengirim `versi`;
- `?id=<lead>` membuka panel langsung (tautan dari email notifikasi);
- petugas: `/petugas/investasi/kotak-masuk` membungkus komponen yang sama.

---

## 8. Kartu FOILA

- Diisi manual oleh pengelola lewat form FOILA: judul, ringkasan, sektor, kab/kota, nilai (opsional), URL proyek FOILA,
  satu gambar.
- `sumber_url` divalidasi tiga lapis: zod (`validasiUrlFoila`), route (normalisasi `new URL().toString()`), CHECK DB
  (`^https://invest\.lampungprov\.go\.id/`). `sumber_slug` diturunkan server; duplikat → 409 `KONFLIK_STATUS` dengan pesan
  "Proyek FOILA ini sudah ada".
- Gambar: pengelola mengunduh gambar dari FOILA lalu mengunggahnya lewat alur yang sama dengan gambar PTSP (dikompres
  WebP, disimpan di R2 kita). Tidak ada hotlink dan tidak ada fetch server ke FOILA (tidak ada permukaan SSRF).
- Tampilan: lencana "Sumber: FOILA", seluruh kartu satu tautan `<a href={sumber_url} target="_blank"
  rel="noopener noreferrer external">` dengan teks tersembunyi "(membuka situs FOILA di tab baru)".
- Hak cipta/AI: `robots.txt` FOILA memberi `use=reference` dan `ai-train=no`. Isi `ipro_proyek` (kedua sumber) tidak
  dimasukkan ke `faq_knowledge_base`/`dokumen_peraturan` di v1. Komentar penjaga di `lib/investasi/konstanta.ts`:
  sumber RAG mana pun kelak wajib menyaring `sumber = 'ptsp'`.

---

## 9. Notifikasi dan lencana

**Email** (di dalam `investasi_kirim_minat`, pola `202610310002_chat_luar_jam.sql`):
- Penerima: `petugas` aktif `role='petugas'` yang `layanan.modul='investasi'` dengan `email_notifikasi` terverifikasi.
  Bila tidak ada satu pun → admin aktif dengan email terverifikasi.
- `INSERT INTO public.notifikasi (tujuan_email, kanal, subjek, body, payload, idempotency_key) ... ON CONFLICT
  (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`.
- Subjek "Pesan baru di Kotak Masuk Investasi"; isi tanpa PII pengirim: jenis (IPRO/Dokumen), judul proyek/dokumen
  (data publik), tautan `<public_url>/petugas/investasi/kotak-masuk?id=<lead>` (petugas) atau
  `/admin/investasi-leads?id=<lead>` (admin). `public_url` dari `site_settings` dengan cadangan seperti chat.
- `payload = {type:'investasi_minat', lead_id, kanal}`; kunci `investasi_minat:<lead_id>:<petugas_id>`.
- Pengiriman memakai pipeline yang ada (`api/notif/send` via cron).

**Lencana sidebar** (Paket P7): `AdminBadgeKey` + `'pesanInvestasi'`, `ADMIN_BADGE_ROLES.pesanInvestasi = ['admin',
'petugas']`, `badgeKey: 'pesanInvestasi'` pada entri Kotak Masuk. Migrasi `202611190004` mengganti
`nav_lencana_saya` dengan menyalin badan terbaru dari `202611110002_nav_lencana.sql` utuh lalu menambah kunci
`'pesanInvestasi', CASE WHEN public.boleh_kelola_investasi() THEN (SELECT count(*) FROM public.investasi_lead
WHERE status = 'baru') END`. Fungsi tetap SECURITY INVOKER sehingga RLS tetap membatasi. `useNavBadges.ts` membaca kunci
baru. Uji perilaku: tambah kasus ke `scripts/lokal-rantai/skenario-nav-lencana.mjs`.

---

## 10. Keamanan dan privasi

| Ancaman | Kontrol |
|---|---|
| Spam/banjir formulir | Sesi anonim wajib; honeypot; batas 5/jam dan 20/hari per UID + 100/10 menit global (advisory lock); `operasi_id` idempoten; badan ≤ 16 KiB. |
| Penyalahgunaan sesi anonim baru per kiriman | Batas global menahan banjir lintas UID. Captcha tidak ditambah di v1 (keputusan "tanpa login", tanpa layanan pihak ketiga baru). |
| IDOR pada lead/proyek | Tidak ada baca lead untuk pengirim (tanda terima hanya `id`); staf dibatasi RLS `boleh_kelola_investasi()`; route admin memakai JWT pengguna, bukan service role. Gambar: route memeriksa `gambar.proyek_id = [id]` dan awalan path mentah. |
| Draf bocor | Policy publik hanya `status='terbit'`; pratinjau draf hanya di halaman pengelola; detail memanggil loader yang menyaring terbit. |
| XSS di ringkasan/deskripsi/alt | Semua teks dirender sebagai teks React; tidak ada `dangerouslySetInnerHTML` kecuali JSON-LD yang di-escape `<`. Karakter kontrol ditolak zod. |
| Injeksi URL sumber / open redirect | Host FOILA tunggal di zod, route, dan CHECK; hanya `https`; tautan `rel="noopener noreferrer"`. Tidak ada redirect server ke URL simpanan. |
| SSRF | Tidak ada fetch server ke URL masukan pengguna (gambar FOILA diunggah manual). |
| Berkas berbahaya | Presign membatasi mime/ukuran; konfirmasi memeriksa magic bytes; sharp me-decode ulang ke WebP (`limitInputPixels`), metadata EXIF/GPS dibuang; PDF terenkripsi ditolak. |
| PII pesan | Email/HP hanya terbaca staf berwenang; notifikasi tanpa PII; log server tanpa isi formulir; retensi 365 hari setelah selesai/ditolak; persetujuan tercatat di `consent_log` dalam transaksi yang sama. Ekspor CSV kotak masuk (bila kelak) wajib `lib/csv.ts` (`escapeCsvCell` menangkal injeksi formula). |
| Petugas lain/FO mengubah IPRO | Helper hanya admin atau petugas bermodul `investasi`; FO tidak termasuk. |
| Dua editor menimpa | `versi` di `ipro_proyek` dan `investasi_lead`; 409 `KONFLIK_VERSI`. |
| Slug berubah setelah terbit | Trigger `SLUG_TERKUNCI`. |

Dokumen yang wajib diperbarui: `docs/KEBIJAKAN_PDP.md` (tujuan `investasi_minat`, data yang dikumpulkan, retensi 365
hari, penerima), teks persetujuan formulir menyebut versi `1.1`.

---

## 11. Rencana uji dan kriteria selesai

Perintah sempit: `npx vitest run --pool=vmForks <berkas>`. Perilaku DB: harness PGlite
(`npm i --no-save @electric-sql/pglite`; `node scripts/lokal-rantai/skenario-baru-ipro.mjs`). Gate penuh
`npm run verify:baseline` dijalankan PM per gelombang.

**Kontrak migrasi (statis)**
- `0001`: tabel, semua CHECK di §2.1/2.2 ada; `ENABLE ROW LEVEL SECURITY` dua tabel; policy publik hanya
  `status = 'terbit'`; tidak ada `GRANT ... TO anon` selain `SELECT`; helper `SECURITY DEFINER` + `search_path` +
  `REVOKE ... FROM PUBLIC, anon, authenticated`; tidak ada `DROP TABLE`/`TRUNCATE`; tanpa kontrol transaksi.
- `0002`: `DROP POLICY investasi_lead_insert`; `REVOKE INSERT, UPDATE ... FROM authenticated`; RPC memanggil
  `check_anon_rate('investasi_lead_insert', 5, 3600)` dan `(..., 20, 86400)`; ada `pg_advisory_xact_lock`; ada
  `INSERT INTO public.consent_log`; isi notifikasi tidak memuat `p_nama`/`p_email`/`p_no_hp`/`p_pesan`; `cron.schedule`
  bernama `investasi_retensi_harian`.
- `0003`, `0004`: hanya objek yang disebut di §2.4/§9; `0004` memuat semua kunci lama `nav_lencana_saya`.
- `manifest.test.ts` hijau setelah generator dijalankan.

**Perilaku PGlite** (`skenario-baru-ipro.mjs`, ≥ 30 cek): anon membaca hanya terbit; anon tidak bisa insert/update
`ipro_proyek`; petugas modul `umkm` dan FO ditolak tulis; petugas modul `investasi` dan admin boleh; hapus hanya draf;
slug terkunci setelah terbit; constraint FOILA menolak `deskripsi`; RPC kirim: sukses, idempoten, `KONFLIK_OPERASI`,
`TERLALU_BANYAK` pada kiriman ke-6 dalam satu jam, `TIDAK_DITEMUKAN` untuk proyek draf/FOILA, `consent_log` tercipta,
notifikasi untuk petugas modul investasi saja; ubah status: `KONFLIK_VERSI`, `DILARANG` bagi FO; insert langsung ke
`investasi_lead` ditolak.

**Route** (`*.test.ts` di sebelah route, Supabase di-stub): kode HTTP §4 tiap cabang; honeypot tidak memanggil RPC;
`setuju_pdp` false → 400; `revalidateTag` dipanggil setelah mutasi data terbit; presign menolak petugas modul lain;
render menolak `mulai` salah (409).

**Unit**: `foila.ts` (host mirip `invest.lampungprov.go.id.evil.com`, `http:`, userinfo, port), `slug.ts`, `format.ts`,
`skema.ts`, `_logika` form.

**Komponen dan a11y** (Testing Library: peran, nama aksesibel, fokus; repo belum memakai `jest-axe`, jangan menambah
dependensi; pemeriksaan sumber statis boleh mengikuti pola `gallery-a11y.test.tsx`):
`FormulirHubungi` (label, pesan galat terhubung `aria-describedby`, honeypot tidak terjangkau tab, fokus kembali ke
pemicu setelah tutup), `KartuFoila` (nama tautan menyebut tab baru), `GaleriGambar` (alt wajib, navigasi papan ketik),
hub (`h1` tunggal, urutan heading), detail (JSON-LD ter-escape), `DaftarIpro`/`FormIpro`/`KotakMasuk`.

**Kriteria selesai umum per paket**: test sempit paket hijau; `npm run lint` dan `npm run typecheck` tanpa galat pada
berkas paket; angka `anggaran-kode.json` tidak naik; tidak ada `select('*')`; tidak ada atribusi alat di berkas.

---

## 12. Paket kerja

Urutan gelombang. Satu berkas hanya dimiliki satu paket dalam satu gelombang.

| Paket | Gel. | Peran | Ukuran | Bergantung | Berkas yang disentuh |
|---|---|---|---|---|---|
| **P1 Migrasi inti + kotak masuk** | 1 | Backend | L | — | `supabase/migrations/202611190001_ipro_inti.{sql,test.ts}`, `202611190002_investasi_kotak_masuk.{sql,test.ts}`, `MANIFEST.json`, `scripts/lokal-rantai/skenario-baru-ipro.mjs` |
| **P2 Domain + data + API pengelola + R2** | 2 | Backend | L | P1 | `src/lib/investasi/{konstanta,skema,foila,slug,format,http,akses-server,gambar-server}.ts` (+ test), `src/lib/data/investasi.ts` (+ test), `src/lib/data/publik-server.ts`, `src/app/api/admin/ipro/**`, `src/lib/storage/area.ts`, `src/app/api/storage/{presign,konfirmasi}/route.ts` (+ test) |
| **P3 API publik minat** | 2 | Backend | S | P1 | `src/lib/investasi/skema-minat.ts`, `src/app/api/investasi/pesan/**`, `src/app/api/investasi/lead/route.ts`, `src/app/api/investasi/lead/[id]/route.ts` (+ test keduanya) |
| **P4 UI publik** | 3 | Frontend | L | P2, P3 | `src/app/investasi/**`, `src/components/investasi/**`, `src/app/gallery/**`, `src/app/peta-potensi/**` (hapus), `next.config.ts` (redirect), `src/components/homepage/{PulauPengguna,BlokLain}.tsx` (+ test), `src/app/me/page.tsx` (+ test), `src/test/kebersihan-dasbor.test.ts`, `src/test/next-config-security.test.ts` bila perlu |
| **P5 UI pengelola IPRO** | 3 | Frontend | L | P2 | `src/components/admin/investasi/{DaftarIpro,FormIpro}*` + `_logika/_hook/_bagian`, `src/app/admin/ipro/**`, `src/app/petugas/investasi/ipro/**`, `src/lib/admin-nav.ts` (+ `admin-nav.test.ts`) |
| **P6 Kotak Masuk** | 3 | Frontend | M | P3 | `src/components/admin/investasi/KotakMasuk*` (+ `_hook`), `src/app/admin/investasi-leads/**`, `src/app/petugas/investasi/kotak-masuk/**`, `src/test/anggaran-kode.json` |
| **P7 Lencana** | 4 | Backend + Frontend | S | P5, P6 | `supabase/migrations/202611190004_nav_lencana_investasi.{sql,test.ts}`, `MANIFEST.json`, `src/lib/admin-nav.ts`, `src/lib/hooks/useNavBadges.ts` (+ test), `scripts/lokal-rantai/skenario-nav-lencana.mjs` |
| **P8 Paket B: PDF presigned + render bertahap** | 4 | Backend (+ Frontend admin gallery) | L | P2 (area.ts), P5 (admin-nav.ts) | `supabase/migrations/202611190003_investasi_dokumen_proses.{sql,test.ts}`, `MANIFEST.json`, `src/lib/storage/area.ts`, `src/app/api/investment-docs/route.ts`, `src/app/api/investment-docs/[id]/render/**`, `src/app/api/investment-docs/upload/**` (hapus), `src/app/admin/gallery/**`, `src/app/petugas/investasi/dokumen/**`, `src/lib/admin-nav.ts` |
| **P9 Tinjauan keamanan + QA + dokumen** | 5 | Keamanan, QA | M | semua | test a11y tambahan, `docs/KEBIJAKAN_PDP.md`, `docs/MIGRATIONS.md`, `docs/fase/investasi-ipro.md` (baru), `GLOSSARY.md` (IPRO, FOILA, Kotak Masuk Investasi), `CLAUDE.md` (Peta file/database, satu baris tiap bagian) |

Catatan konflik: `MANIFEST.json` disentuh P1, P7, P8 dan `admin-nav.ts` disentuh P5, P7, P8; karena itu P7 dan P8
berjalan setelah gelombang 3 dan P7/P8 tidak boleh paralel di `MANIFEST.json`/`admin-nav.ts` (PM menjadwalkan P8 setelah
P7, atau satu worker mengerjakan keduanya). P8 Frontend bagian `admin/gallery` boleh dipisah ke worker Frontend asal
berkas tidak beririsan.

Setiap spec worker memuat: aturan Next.js 16 (baca `node_modules/next/dist/docs/`), WIB lewat `lib/time.ts`, migrasi
baru saja, CSP di `next.config.ts`, PII lewat `lib/pii.ts`/`lib/csv.ts`, larangan menyentuh DB produksi dan `.env*`,
larangan commit/push, larangan atribusi alat apa pun di kode/komentar/dokumen/commit.

---

## 13. Pertanyaan terbuka untuk pemilik

1. **Retensi pesan Kotak Masuk Investasi.** Default yang disarankan: dihapus 365 hari setelah status `selesai`/`ditolak`
   (UMKM memakai 180 hari; minat investasi berjalan lebih lama). Baris yang masih aktif tidak dihapus.
2. **`/peta-potensi`.** Default: dialihkan ke `/investasi#peta-potensi` dan halaman lama dihapus, dengan konsekuensi
   pencatatan `jejak_minat_investasi` berhenti. Alternatif: dipertahankan dengan login seperti sekarang.
3. **Peta interaktif.** Default: v1 tanpa peta ubin (seksi Peta Potensi = kisi sektor dan kabupaten/kota), `lat`/`lng`
   disimpan untuk tahap berikut. Alternatif: Leaflet + ubin OSM sekarang (pustaka baru dan perubahan CSP `img-src`/
   `connect-src`).
4. **Daftar sektor.** Default: pertanian, perikanan, pariwisata, industri, energi, infrastruktur, kawasan, jasa, lainnya.
   Mohon dikoreksi bila DPMPTSP memakai klasifikasi baku (mis. sektor BKPM/FOILA).
5. **Kontak di halaman detail.** Default: hanya kontak lembaga (nama instansi, email dinas, telepon kantor) yang tampil
   publik; nomor pribadi petugas tidak pernah tampil, dan calon investor diarahkan ke tombol "Hubungi petugas".
