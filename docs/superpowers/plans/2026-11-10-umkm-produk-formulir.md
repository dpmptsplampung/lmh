# UMKM: produk, foto utama, dan formulir rapi (P-39, P-40) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UMKM dan petugas dapat mengisi profil usaha yang lebih lengkap (kecamatan, bentuk usaha, tahun mulai, rentang omzet dan tenaga kerja, nama pemilik tertutup), menambah produk beserta kapasitas dan satu foto per produk, memilih foto utama, dan menambah foto lewat unggah atau tautan sejak pendaftaran pertama; menu `/me` memuat Usaha saya, Cari pemasok, dan Lacak pengaduan.

**Architecture:** Tiga migrasi maju baru: skema dan validasi, penulisan revisi lewat dua helper bersama yang menggantikan semua tempat penyisipan revisi, lalu fungsi baca publik dan detail. Foto produk tetap baris `umkm_foto` yang menunjuk produk lewat `produk_urutan`, sehingga alur pemeriksaan, sembunyikan, dan publikasi foto yang sudah ada berlaku tanpa perubahan. Di klien, bagian formulir dipecah ke `src/components/umkm-form/` dan dipakai bersama oleh formulir UMKM dan formulir petugas.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, zod, Supabase Postgres (plpgsql, SECURITY DEFINER, skema `umkm_private`), Cloudflare R2, CSS Modules, Vitest, PGlite (`scripts/lokal-rantai/harness.mjs`).

**Spec:** `docs/umkm/KEPUTUSAN-PEMILIK.md` (P-38, P-39, P-40), `.tim/umkm-kurasi/KRITERIA.md` (bagian "Produk (P-39)" dan "B. Omzet dan tenaga kerja"), `docs/superpowers/specs/2026-10-08-umkm-aturan-pelabelan.md` (taksonomi), `.tim/umkm-kurasi/CATATAN-RENCANA-P39-P40.md` (keputusan desain PM).

## Global Constraints

- Next.js 16 punya breaking changes: baca `node_modules/next/dist/docs/` sebelum menulis kode Next.js.
- Waktu dan tahun berjalan lewat `src/lib/time.ts` (WIB); di SQL pakai `(now() AT TIME ZONE 'Asia/Jakarta')`.
- Migrasi: file baru bertimestamp lebih besar, tanpa `BEGIN`/`COMMIT` (`mengandungKontrolTransaksi(sql) === false`), test kontrak di sebelahnya. Jangan mengedit migrasi lama.
- Fungsi baru: `SET search_path = pg_catalog, pg_temp`, nama tabel berkualifikasi skema, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` untuk fungsi `umkm_private`, sama dengan pola `202611090012`.
- Rollback: satu berkas `docs/rollback-umkm-produk-202611100001-0003.sql` yang hanya memulihkan definisi fungsi lama. Tidak ada `DROP TABLE`, `DROP COLUMN`, atau `TRUNCATE` (AGENTS.md).
- Nomor WhatsApp UMKM tidak pernah publik. RPC publik tidak pernah memuat `nama_pemilik`, `alamat`, atau `omzet_rentang` mentah.
- Label omzet publik hanya untuk rentang Rp50 juta ke atas, teks persis: "Omzet lebih dari Rp50 juta per tahun", "Omzet lebih dari Rp300 juta per tahun", "Omzet lebih dari Rp2 miliar per tahun", "Omzet lebih dari Rp15 miliar per tahun".
- Kapasitas tampil publik dengan teks "(menurut UMKM)" dan hanya dari revisi yang sudah disetujui petugas.
- Bahasa UI dan komentar: Indonesia sederhana, tanpa em dash. CSS Modules, tanpa Tailwind.
- Tanpa atribusi asisten AI (trailer, tanda tangan, watermark) di kode, komentar, dokumen, atau pesan commit.
- Worker dilarang menjalankan `scripts/apply-migration.mjs`, `npm run test:rls`, `scripts/selftest-wp*.mjs`, `scripts/verify-wp*.mjs`, membaca `.env*`, atau `git push`.
- Test sempit: `npx vitest run --pool=vmForks <file>`. Test basis data butuh `npm i --no-save @electric-sql/pglite`; tanpa paket itu test dilewati, jadi pastikan keluarannya menyebut test LULUS, bukan dilewati.
- Prinsip pemilik (keputusan 36): jangan menambah aturan atau batasan di luar yang tertulis di sini.

## Review Focus

1. Nomor WhatsApp atau tautan kontak ditulis di nama produk, keterangan produk, satuan kapasitas, atau kecamatan: petugas harus mendapat peringatan dan persetujuan ditolak `KONTAK_PUBLIK`, sama dengan kolom lama. Test: Task 3.
2. Foto profil atau foto produk yang disembunyikan petugas tidak boleh tampil lagi hanya karena UMKM atau petugas mengirim ulang formulir, atau karena revisi disalin saat sembunyikan/pulihkan. Test: Task 4.
3. Foto utama disembunyikan atau dihapus: kartu katalog memakai foto profil tampil berikutnya; foto produk tidak pernah menjadi sampul kartu atau masuk galeri profil. Test: Task 5.
4. Akun lain memakai folder unggahan milik akun orang lain (lewat presign atau lewat `r2_key` saat daftar atau draf): ditolak 403 atau `DILARANG`. Test: Task 4 dan Task 6.
5. JSON publik dan kartu tidak memuat `nama_pemilik`, `alamat`, `omzet_rentang`, maupun label omzet untuk rentang di bawah Rp50 juta; `bentuk_usaha` "Lainnya" tidak tampil. Test: Task 5.

---

### Task 1: Konstanta taksonomi, wilayah, dan rentang

**Files:**
- Create: `src/lib/umkm-katalog/taksonomi.ts`, `src/lib/umkm-katalog/wilayah.ts`
- Test: `src/lib/umkm-katalog/taksonomi.test.ts`

**Interfaces:**
- Produces (`taksonomi.ts`):
  - `JENIS_USAHA = ['Produk', 'Bahan Baku', 'Jasa'] as const`, `type JenisUsaha`.
  - `KATEGORI_PER_JENIS: Readonly<Record<JenisUsaha, readonly string[]>>`, 31 nama tanpa kode, urutan sesuai spesifikasi pelabelan:
    - Produk (11): Makanan Olahan; Minuman Olahan; Pakaian & Tekstil; Kerajinan & Suvenir; Mebel & Produk Kayu; Bahan Bangunan Olahan; Produk Logam & Alat; Kosmetik, Herbal & Kebersihan; Kemasan; Tanaman & Hewan Hias; Grosir Barang Konsumsi.
    - Bahan Baku (10): Hasil Perkebunan; Tanaman Pangan; Sayur & Buah Segar; Peternakan; Perikanan; Kayu, Bambu & Rotan; Pangan Setengah Jadi; Galian & Bahan Alam Bangunan; Barang Bekas & Daur Ulang; Pupuk, Bibit & Pakan.
    - Jasa (10): Katering & Nasi Kotak; Penjahitan Pesanan; Angkutan & Logistik; Kebersihan, Laundry & Pertamanan; Percetakan, Sablon & Desain; Bengkel, Las & Perbaikan; Konstruksi & Pertukangan; Acara & Dokumentasi; Jasa Pertanian & Perikanan; Pelatihan & Jasa Profesional.
  - `kategoriSah(jenis: string, kategori: string): boolean`.
  - `BENTUK_USAHA = ['Perorangan', 'CV', 'PT', 'Firma', 'Yayasan', 'NV', 'Lainnya'] as const`, `type BentukUsaha`.
  - `OMZET_RENTANG = ['sd_10jt', '10_50jt', '50_300jt', '300jt_2m', '2_15m', '15_50m'] as const`, `type OmzetRentang`, `LABEL_OMZET: Record<OmzetRentang, string>` (pilihan formulir): "Sampai Rp10 juta", "Lebih dari Rp10 juta sampai Rp50 juta", "Lebih dari Rp50 juta sampai Rp300 juta", "Lebih dari Rp300 juta sampai Rp2 miliar", "Lebih dari Rp2 miliar sampai Rp15 miliar", "Lebih dari Rp15 miliar sampai Rp50 miliar".
  - `TENAGA_KERJA_RENTANG = ['1-4', '5-19', '20-99', '100+'] as const`, `type TenagaKerjaRentang`, `LABEL_TENAGA_KERJA`: "1 sampai 4 orang", "5 sampai 19 orang", "20 sampai 99 orang", "100 orang atau lebih".
  - `PERIODE_KAPASITAS = ['hari', 'minggu', 'bulan', 'tahun'] as const`, `type PeriodeKapasitas`.
  - `SARAN_SATUAN = ['kg', 'ton', 'liter', 'pcs', 'unit', 'paket', 'porsi', 'lembar', 'meter', 'karung'] as const` (saran datalist, bukan batasan).
  - `formatKapasitas(p: { kapasitas_jumlah: number; kapasitas_satuan: string; kapasitas_periode: PeriodeKapasitas }): string` menghasilkan `"Kapasitas 1.500 kg per bulan (menurut UMKM)"` (angka `toLocaleString('id-ID')`).
- Produces (`wilayah.ts`): `WILAYAH_LAMPUNG: Readonly<Record<string, readonly string[]>>` (salin isi `.tim/umkm-kurasi/wilayah-lampung.json` ke literal TS; berkas `.tim/` tidak ikut git), `KABUPATEN_KOTA: readonly string[]` (15 kunci, mis. "Kab. Lampung Barat", "Kota Bandar Lampung"), `kecamatanDari(kab: string): readonly string[]` (tidak dikenal = `[]`).

- [ ] **Step 1: Tulis test gagal** `taksonomi.test.ts`:
  - `it('31 kategori terbagi 11/10/10')`: panjang tiap jenis 11, 10, 10; tidak ada nama ganda lintas jenis.
  - `it('kategoriSah menolak kategori dari jenis lain')`: `kategoriSah('Produk', 'Makanan Olahan') === true`, `kategoriSah('Jasa', 'Makanan Olahan') === false`, `kategoriSah('Produk', 'Pangan') === false`.
  - `it('wilayah 15 kab/kota dan 229 kecamatan')`: `KABUPATEN_KOTA.length === 15`, total kecamatan 229, `kecamatanDari('Kota Metro').length > 0`, `kecamatanDari('Lampung') ` sama dengan `[]`.
  - `it('formatKapasitas')`: `{1500, 'kg', 'bulan'}` menjadi `"Kapasitas 1.500 kg per bulan (menurut UMKM)"`.
- [ ] **Step 2:** `npx vitest run --pool=vmForks src/lib/umkm-katalog/taksonomi.test.ts`, harus GAGAL (modul belum ada).
- [ ] **Step 3:** Tulis kedua modul sesuai Interfaces.
- [ ] **Step 4:** Jalankan ulang, harus LULUS.
- [ ] **Step 5:** Commit `feat(umkm): konstanta taksonomi, wilayah, dan rentang profil`.

### Task 2: Skema zod dan tipe

**Files:**
- Modify: `src/lib/umkm-katalog/schemas.ts:11-32`, `src/lib/umkm-katalog/types.ts:2-15,39-46`, `src/lib/umkm-katalog/types-g5.ts` (`DetailUsaha`)
- Test: `src/lib/umkm-katalog/schemas.test.ts` (baru); perbarui fixture yang memakai kategori atau kabupaten tidak sah, minimal `src/lib/umkm-katalog/pemilik-server.test.ts:15` dan test route di `src/app/api/umkm-katalog/` serta `src/app/api/umkm-pemilik/` yang gagal setelah perubahan (ganti ke `jenis: 'Produk', kategori: 'Makanan Olahan', kabupaten_kota: 'Kota Bandar Lampung'`).

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `fotoSchema` = foto profil, tambahan `utama: z.boolean().optional()`; `fotoProdukSchema` = foto tanpa `utama`. Keduanya memakai aturan asal/url/r2_key yang sama dengan sekarang (pisahkan objek dasar dan `superRefine` agar bisa dipakai ulang).
  - `produkSchema = z.object({ nama: teks(100).min(1), keterangan: opsional(500), kapasitas_jumlah: z.number().positive().max(1e9).multipleOf(0.01).nullable().optional(), kapasitas_satuan: opsional(20), kapasitas_periode: z.enum(PERIODE_KAPASITAS).nullable().optional(), foto: fotoProdukSchema.nullable().optional() }).strict()` dengan refine kapasitas: ketiganya terisi atau ketiganya kosong; pesan "Isi jumlah, satuan, dan periode kapasitas sekaligus, atau kosongkan ketiganya".
  - `profilSchema` menambah `kecamatan: opsional(100)`, `nama_pemilik: opsional(200)`, `bentuk_usaha: z.enum(BENTUK_USAHA).nullable().optional()`, `tahun_mulai: z.number().int().min(1900).nullable().optional()` dengan refine saat parse: tidak lebih dari `Number(todayWIB().slice(0, 4))` (`src/lib/time.ts`), `omzet_rentang`, `tenaga_kerja_rentang` (enum, nullable, optional), `produk: z.array(produkSchema).max(20).optional()`; `jenis: z.enum(JENIS_USAHA)`; `kabupaten_kota` harus anggota `KABUPATEN_KOTA`; `superRefine`: `kategoriSah(jenis, kategori)` dan paling banyak satu foto `utama: true`.
  - `export type FotoInput = z.input<typeof fotoSchema>` dan `export type ProdukInput = z.input<typeof produkSchema>` (dipakai Task 7 dan 8).
  - `types.ts`: `Revisi` menambah enam kolom baru; `Foto` menambah `utama: boolean; produk_urutan: number | null`; `type Produk = { urutan: number; nama: string; keterangan: string | null; kapasitas_jumlah: number | null; kapasitas_satuan: string | null; kapasitas_periode: PeriodeKapasitas | null }`; `type ProdukPublik = Produk & { foto: FotoPublik | null }`; `Detail` dan `DetailUsaha` (`types-g5.ts`) menambah `produk: Produk[]`; `ProfilPublik` menambah `kecamatan, bentuk_usaha, tahun_mulai, skala ('Mikro' | 'Kecil' | 'Menengah' | null), omzet_label (string | null), tenaga_kerja_rentang, produk: ProdukPublik[]`; `Kartu` menambah `kecamatan`.

- [ ] **Step 1: Tulis test gagal** `schemas.test.ts`:
  - `it('menerima profil lengkap dengan produk dan foto utama')`.
  - `it('menolak kategori yang bukan milik jenisnya')`: `{jenis:'Jasa', kategori:'Makanan Olahan'}` gagal dengan path `kategori`.
  - `it('menolak kabupaten di luar 15 nama')`: `'Lampung'` gagal.
  - `it('kapasitas semua atau tidak sama sekali')`: hanya `kapasitas_jumlah` gagal; ketiganya kosong lulus; ketiganya terisi lulus; `kapasitas_jumlah: 0` gagal.
  - `it('paling banyak satu foto utama')`: dua `utama: true` gagal.
  - `it('foto produk tidak boleh punya utama')`: `produk[0].foto.utama` ditolak (strict).
  - `it('maksimal 20 produk')`: 21 gagal.
- [ ] **Step 2:** Jalankan `npx vitest run --pool=vmForks src/lib/umkm-katalog/schemas.test.ts`, harus GAGAL.
- [ ] **Step 3:** Ubah `schemas.ts` dan `types.ts`, lalu perbarui fixture yang gagal.
- [ ] **Step 4:** Jalankan test sempit ini, `npx vitest run --pool=vmForks src/lib/umkm-katalog src/app/api/umkm-katalog src/app/api/umkm-pemilik src/components/umkm-pemilik src/components/admin/umkm-tugas` (test non-PGlite), dan `npm run typecheck`. Semua harus LULUS.
- [ ] **Step 5:** Commit `feat(umkm): skema zod profil, produk, dan foto utama`.

### Task 3: Migrasi skema, validasi, dan peringatan kontak

**Files:**
- Create: `supabase/migrations/202611100001_umkm_produk_skema.sql`, `supabase/migrations/202611100001_umkm_produk_skema.test.ts`, `docs/rollback-umkm-produk-202611100001-0003.sql` (bagian 0001: definisi lama `umkm_private.validasi` dari `202611090001_umkm_inti.sql:167-212` dan `umkm_private.peringatan` dari `:155-166`)
- Test DB: `src/lib/umkm-katalog/produk.database.test.ts` (baru, pola `pemilik.database.test.ts:1-25`)

**Interfaces:**
- Consumes: daftar nilai Task 1 (disalin sebagai literal SQL).
- Produces (SQL):
  - Kolom `public.umkm_revisi`: `kecamatan text` (<=100), `nama_pemilik text` (<=200), `bentuk_usaha text` (IN tujuh nilai), `tahun_mulai smallint` (1900 sampai 2100), `omzet_rentang text` (IN enam kode), `tenaga_kerja_rentang text` (IN empat kode). Semua nullable, CHECK bernama.
  - Tabel `public.umkm_produk(id uuid PK default gen_random_uuid(), revisi_id uuid NOT NULL REFERENCES public.umkm_revisi(id) ON DELETE CASCADE, urutan smallint NOT NULL CHECK 1..20, nama text NOT NULL CHECK length 1..100, keterangan text CHECK <=500, kapasitas_jumlah numeric(14,2) CHECK > 0, kapasitas_satuan text CHECK length 1..20, kapasitas_periode text CHECK IN ('hari','minggu','bulan','tahun'), CHECK ketiga kolom kapasitas sama-sama NULL atau sama-sama NOT NULL, UNIQUE (revisi_id, urutan))`. RLS aktif tanpa policy dan `REVOKE ALL` dari `anon, authenticated`, sama dengan tabel `umkm_*` lain di `202611090001`.
  - Kolom `public.umkm_foto`: `utama boolean NOT NULL DEFAULT false`, `produk_urutan smallint`; FK `(revisi_id, produk_urutan) REFERENCES public.umkm_produk(revisi_id, urutan) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED`; CHECK `NOT (utama AND produk_urutan IS NOT NULL)`; indeks unik parsial `(revisi_id) WHERE utama` dan `(revisi_id, produk_urutan) WHERE produk_urutan IS NOT NULL`.
  - `umkm_private.kategori_sah(p_jenis text, p_kategori text) RETURNS boolean` dan `umkm_private.kabupaten_sah(p text) RETURNS boolean` (IMMUTABLE, literal daftar Task 1).
  - `umkm_private.label_omzet(p text) RETURNS text`: `50_300jt`, `300jt_2m`, `2_15m`, `15_50m` menjadi empat label publik di Global Constraints; selain itu NULL.
  - `umkm_private.skala_dari_omzet(p text) RETURNS text`: `sd_10jt`, `10_50jt`, `50_300jt`, `300jt_2m` menjadi 'Mikro'; `2_15m` 'Kecil'; `15_50m` 'Menengah'; NULL tetap NULL.
  - `CREATE OR REPLACE umkm_private.validasi(p_data jsonb)`: salin badan lama, lalu tambah kunci `kecamatan, nama_pemilik, bentuk_usaha, tahun_mulai, omzet_rentang, tenaga_kerja_rentang, produk`; periksa tipe dan panjang kolom baru; `tahun_mulai` angka bulat 1900 sampai tahun WIB berjalan; `kategori_sah`, `kabupaten_sah`; foto profil boleh punya kunci `utama` (boolean), paling banyak satu true; `produk` array <=20, tiap butir objek dengan kunci `nama, keterangan, kapasitas_jumlah, kapasitas_satuan, kapasitas_periode, foto`, kapasitas semua atau tidak, `foto` objek tunggal atau null yang diperiksa dengan aturan foto yang sama (tanpa `utama`). Semua pelanggaran `INPUT_TIDAK_VALID` (22023). Batas 65.536 byte tetap.
  - `CREATE OR REPLACE umkm_private.peringatan(p_revisi_id uuid)`: tambah `('kecamatan', r.kecamatan)` dan kunci `'produk'` bila `ada_kontak` benar untuk nama, keterangan, atau satuan produk mana pun di revisi itu. `nama_pemilik` tidak diperiksa (tidak publik).

- [ ] **Step 1: Tulis test kontrak gagal** `202611100001_umkm_produk_skema.test.ts`: berkas memuat `CREATE TABLE public.umkm_produk`, `DEFERRABLE INITIALLY DEFERRED`, `WHERE utama`, `'Omzet lebih dari Rp50 juta per tahun'`, `SET search_path = pg_catalog, pg_temp`; setiap nama di `KATEGORI_PER_JENIS` dan `KABUPATEN_KOTA` muncul di SQL (impor dari Task 1); `mengandungKontrolTransaksi(sql) === false`; rollback memuat `CREATE OR REPLACE FUNCTION umkm_private.validasi` dan tidak memuat `DROP TABLE`.
- [ ] **Step 2: Tulis test DB gagal** `produk.database.test.ts`. Penulisan produk lewat RPC baru ada di Task 4, jadi test Task 3 memanggil `umkm_private.validasi`, `peringatan`, `label_omzet`, dan `skala_dari_omzet` langsung sebagai peran `postgres`:
  - `it('validasi menolak kategori lintas jenis, kabupaten asing, dan dua foto utama')`.
  - `it('validasi menolak kapasitas setengah terisi dan tahun di depan')`.
  - `it('peringatan menandai nomor di produk dan kecamatan')`: sisipkan revisi plus produk `nama: 'Keripik 0812 3456 7890'` lewat SQL langsung, `umkm_private.peringatan(id)` memuat `'produk'`; kecamatan `'wa.me/628123'` memuat `'kecamatan'`.
  - `it('label omzet hanya untuk 50 juta ke atas')`: `label_omzet('10_50jt') IS NULL`, `label_omzet('2_15m') = 'Omzet lebih dari Rp2 miliar per tahun'`; `skala_dari_omzet('300jt_2m') = 'Mikro'`.
- [ ] **Step 3:** Jalankan kedua test, harus GAGAL.
- [ ] **Step 4:** Tulis migrasi dan bagian rollback.
- [ ] **Step 5:** `npm i --no-save @electric-sql/pglite`, lalu jalankan kedua test, harus LULUS (bukan dilewati). Jalankan juga `npx vitest run --pool=vmForks src/lib/umkm-katalog/*.database.test.ts`; test lama yang memanggil RPC dengan kategori `'Pangan'` atau kabupaten `'Lampung'` diperbarui ke nilai sah. Fixture yang menyisipkan langsung lewat SQL tidak perlu diubah.
- [ ] **Step 6:** Commit `feat(umkm): migrasi kolom profil, tabel produk, dan validasi`.

### Task 4: Penulisan revisi bersama dan folder unggah akun

**Files:**
- Create: `supabase/migrations/202611100002_umkm_produk_mutasi.sql`, `supabase/migrations/202611100002_umkm_produk_mutasi.test.ts`
- Modify: `docs/rollback-umkm-produk-202611100001-0003.sql` (tambah definisi lama `umkm_private.mutasi` dari `202611090001_umkm_inti.sql:222-400` dan `umkm_private.mutasi_pemilik` dari `202611090010_umkm_pemilik.sql:119-214`)
- Test DB: `src/lib/umkm-katalog/produk.database.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `umkm_private.tulis_revisi(p_profil public.umkm_profil, p_data jsonb, p_dibuat_oleh uuid, p_aktor_uid uuid) RETURNS uuid`:
    - sisipkan revisi `versi = p_profil.versi` dengan semua kolom lama (aturan `btrim`/`nullif` sama dengan sekarang) dan enam kolom baru (`nullif(btrim(...),'')` untuk teks);
    - `p_data ? 'produk'`: sisipkan produk dengan `urutan` = posisi array (mulai 1), foto produk dengan `produk_urutan` itu; tanpa kunci: salin produk dan foto produk dari `p_profil.revisi_terakhir_id`;
    - `p_data ? 'foto'`: sisipkan foto profil dengan `utama` dari input; tanpa kunci: salin foto profil (`produk_urutan IS NULL`) dari `revisi_terakhir_id`;
    - foto dari input mewarisi `tersembunyi = bool_or` dari foto yang sama (`asal`, `url`, `r2_key`) di `revisi_terakhir_id` atau `revisi_disetujui_id`, untuk foto profil maupun foto produk. Untuk jalur petugas ini memperluas aturan lama (dulu hanya `revisi_terakhir_id`) agar foto yang disembunyikan di revisi terbit tidak muncul lagi.
  - `umkm_private.salin_revisi(p_revisi_lama uuid, p_versi integer, p_dibuat_oleh uuid, p_foto_tampil uuid DEFAULT NULL) RETURNS uuid`: salin satu revisi beserta semua kolom baru, semua produk, dan semua foto (`utama`, `produk_urutan`, `tersembunyi`; foto `p_foto_tampil` menjadi `tersembunyi = false`). `aktor_uid` dan `keputusan` NULL.
  - `CREATE OR REPLACE umkm_private.mutasi(...)`: salin utuh dari `202611090001_umkm_inti.sql:222-400`; ganti blok `:274-292` dengan `rid := umkm_private.tulis_revisi(p, d, a.id, NULL);`, blok `:350-356` dan `:366-371` dengan `rid := umkm_private.salin_revisi(r.id, p.versi+1, a.id, <foto_id atau NULL>);`. Selebihnya tidak berubah.
  - `CREATE OR REPLACE umkm_private.mutasi_pemilik(...)`: salin utuh dari `202611090010_umkm_pemilik.sql:119-214`; ganti `:166-180` dengan `rid := umkm_private.tulis_revisi(p, d, NULL, u);`; pemeriksaan `r2_key` (`:154-158`) berlaku untuk foto profil dan foto produk, dan menerima awalan `'umkm-draf/'||p.id::text||'/'` atau `'umkm-draf/'||u::text||'/'` (folder akun) atau kunci yang sudah ada di revisi profil ini.

- [ ] **Step 1: Tulis test kontrak gagal**: SQL memuat `umkm_private.tulis_revisi(p, d, a.id, NULL)`, `umkm_private.tulis_revisi(p, d, NULL, u)`, dua `umkm_private.salin_revisi(`, `'umkm-draf/'||u::text||'/'`; `INSERT INTO public.umkm_revisi` muncul tepat dua kali (di kedua helper); tanpa kontrol transaksi; rollback memuat `FUNCTION umkm_private.mutasi(` dan `FUNCTION umkm_private.mutasi_pemilik(`.
- [ ] **Step 2: Tulis test DB gagal** di `produk.database.test.ts`:
  - `it('petugas menyimpan profil dengan produk, kapasitas, foto produk, dan foto utama')`: `umkm_detail_tugas` memuat `revisi.kecamatan`, `revisi.nama_pemilik`, foto dengan `utama` dan `produk_urutan`.
  - `it('simpan tanpa kunci produk mempertahankan produk lama')`.
  - `it('foto yang disembunyikan tetap tersembunyi saat formulir dikirim ulang')`: sembunyikan foto produk lewat `umkm_ubah_visibilitas`, kirim ulang data yang sama sebagai petugas dan sebagai pemilik, foto tetap `tersembunyi`.
  - `it('sembunyikan dan pulihkan profil menyalin produk dan foto produk')`.
  - `it('pemilik mendaftar dengan foto di folder akunnya')`: `umkm_daftar_usaha` dengan `r2_key = 'umkm-draf/<uid pemilik>/<uuid>.jpg'` di foto profil dan foto produk berhasil.
  - `it('pemilik tidak bisa memakai folder akun lain')`: `r2_key` folder akun lain gagal `DILARANG`.
  - `it('kunci di folder akun yang dipakai revisi terlindung dari pembersihan')`: `umkm_draf_dilindungi` memuat kunci itu.
- [ ] **Step 3:** Jalankan, harus GAGAL.
- [ ] **Step 4:** Tulis migrasi dan perbarui rollback.
- [ ] **Step 5:** Jalankan `produk.database.test.ts` dan semua `src/lib/umkm-katalog/*.database.test.ts`, harus LULUS. Jalankan juga `node scripts/lokal-rantai/skenario-akses-data.mjs`, harus selesai tanpa galat.
- [ ] **Step 6:** Commit `feat(umkm): penulisan revisi bersama untuk produk dan foto`.

### Task 5: Fungsi baca publik dan detail

**Files:**
- Create: `supabase/migrations/202611100003_umkm_produk_baca.sql`, `supabase/migrations/202611100003_umkm_produk_baca.test.ts`
- Modify: `docs/rollback-umkm-produk-202611100001-0003.sql` (definisi lama `foto_publik` `202611090002:96-102`, `kartu` dan `umkm_profil_publik` dan `umkm_cari_katalog` `202611090006:9-102`, `umkm_detail_tugas` `202611090011:296-326`, `umkm_detail_usaha` `202611090010:89-110`)
- Test DB: `src/lib/umkm-katalog/produk.database.test.ts`

**Interfaces:**
- Consumes: Task 3 dan 4.
- Produces:
  - `umkm_private.foto_publik(p_revisi_id uuid)`: hanya foto profil (`produk_urutan IS NULL`), `ORDER BY f.utama DESC, f.id`; syarat tampil lain tidak berubah. `kartu` tetap memakai `->0`, jadi sampul = foto utama atau foto profil tampil pertama.
  - `umkm_private.produk_json(p_revisi_id uuid, p_publik boolean) RETURNS jsonb`: array urut `urutan` berisi `urutan, nama, keterangan, kapasitas_jumlah, kapasitas_satuan, kapasitas_periode`; bila `p_publik`, tambah `foto` = `{id, url}` dengan syarat tampil dan aturan URL yang sama dengan `foto_publik`, atau null.
  - `umkm_private.kartu`: tambah `'kecamatan'`.
  - `public.umkm_profil_publik`: tambah `kecamatan`, `bentuk_usaha` (`nullif(r.bentuk_usaha,'Lainnya')`), `tahun_mulai`, `skala` (`skala_dari_omzet`), `omzet_label` (`label_omzet`), `tenaga_kerja_rentang`, `produk` (`produk_json(r.id, true)`).
  - `public.umkm_cari_katalog`: salin dari `202611090006:32-102`; kata kunci juga cocok bila ada produk di revisi terbit yang `nama ILIKE q`; tingkat: spesifik 0, kategori atau nama produk 1, lainnya 2.
  - `public.umkm_detail_tugas`: salin dari `202611090011:296-326`, tambah `'produk', umkm_private.produk_json(p.revisi_terakhir_id, false)`.
  - `public.umkm_detail_usaha`: salin dari `202611090010:89-110`, tambah `'produk'` (revisi terakhir bila `draf`, selain itu `[]`).

- [ ] **Step 1: Tulis test kontrak gagal**: SQL memuat `produk_urutan IS NULL`, `ORDER BY f.utama DESC`, `nullif(r.bentuk_usaha,'Lainnya')`, `umkm_private.label_omzet(`, `umkm_private.produk_json(`; blok `umkm_profil_publik` dan `kartu` tidak memuat `nama_pemilik`, `alamat`, atau `omzet_rentang`; tanpa kontrol transaksi.
- [ ] **Step 2: Tulis test DB gagal**:
  - `it('profil publik memuat produk, kapasitas, dan label omzet')`: profil terbit dengan `omzet_rentang = '50_300jt'` menghasilkan `omzet_label = 'Omzet lebih dari Rp50 juta per tahun'`, `skala = 'Mikro'`, `produk[0].kapasitas_jumlah`.
  - `it('profil publik tidak memuat data tertutup')`: `JSON.stringify` hasil tidak memuat `nama_pemilik`, nilai nama pemilik, alamat, atau `omzet_rentang`; `omzet_rentang = '10_50jt'` menghasilkan `omzet_label = null`; `bentuk_usaha = 'Lainnya'` menghasilkan null.
  - `it('sampul kartu memakai foto utama dan jatuh ke foto berikutnya')`: foto utama disembunyikan, `kartu.foto.id` = foto profil tampil berikutnya; foto produk tidak pernah muncul di `foto` profil maupun sampul.
  - `it('produk dari revisi diajukan tidak tampil publik')`: ubah produk lewat draf pemilik tanpa disetujui, profil publik tetap memuat produk lama.
  - `it('pencarian menemukan nama produk')`: kata kunci yang hanya ada di nama produk mengembalikan profil itu.
- [ ] **Step 3:** Jalankan, harus GAGAL.
- [ ] **Step 4:** Tulis migrasi dan perbarui rollback.
- [ ] **Step 5:** Jalankan `produk.database.test.ts` dan semua `src/lib/umkm-katalog/*.database.test.ts`, harus LULUS.
- [ ] **Step 6:** Commit `feat(umkm): katalog publik menampilkan produk dan foto utama`.

### Task 6: Unggah foto saat pendaftaran pertama

**Files:**
- Modify: `src/lib/umkm-katalog/akses-server.ts:5-25`, `src/app/api/storage/presign/route.ts:47-58`
- Test: `src/lib/umkm-katalog/akses-server.test.ts` (baru atau tambah), `src/app/api/storage/presign/route.test.ts`, `src/app/api/storage/konfirmasi/route.test.ts`

**Interfaces:**
- Produces:
  - `export const AWALAN_AKUN = 'akun/'` dan `jalurAkun(path: string | undefined, userId: string): boolean` di `akses-server.ts`: benar bila `path` berawalan `akun/` atau folder pertamanya sama dengan `userId`.
  - `bolehUnggahDraf`: untuk non-staf yang bukan anonim, `jalurAkun(path, user.id)` cukup untuk diizinkan; jalur folder profil dan jalur staf tidak berubah.
  - Presign: non-staf dengan `path` berawalan `akun/` mendapat kunci `umkm-draf/<user.id>/<uuid>.<ext>`; selebihnya sama dengan sekarang. Klien tidak pernah mengirim ID akunnya sendiri.

- [ ] **Step 1: Tulis test gagal**:
  - `it('akun biasa boleh presign ke akun/ dan mendapat folder ID akunnya')`: kunci hasil berpola `^umkm-draf/<user.id>/[0-9a-f-]{36}\.jpg$`.
  - `it('akun anonim ditolak')`: 403.
  - `it('konfirmasi menerima folder akun sendiri dan menolak folder akun lain')`: `path = '<user.id>/<uuid>.jpg'` lulus, `'<uid lain>/<uuid>.jpg'` 403 bila uid lain bukan profil yang diizinkan.
- [ ] **Step 2:** Jalankan ketiga test, harus GAGAL.
- [ ] **Step 3:** Ubah `akses-server.ts` dan presign.
- [ ] **Step 4:** Jalankan ketiga test dan `src/lib/storage/unggah.test.ts`, `src/lib/umkm-katalog/foto-server.test.ts`, `src/lib/umkm-katalog/pemilik-server.test.ts`, harus LULUS. Pastikan pola `foto-server.ts:40` tetap menerima kunci folder akun (UUID 36 karakter).
- [ ] **Step 5:** Commit `feat(umkm): foto bisa diunggah saat pendaftaran pertama`.

### Task 7: Bagian formulir bersama

**Files:**
- Create di `src/components/umkm-form/`: `BagianUsaha.tsx`, `BagianLokasi.tsx`, `BagianKontak.tsx`, `PemilihFoto.tsx`, `EditorProduk.tsx`, `baca-isian.ts`, `umkm-form.module.css`
- Test: `src/components/umkm-form/umkm-form.test.tsx`

**Interfaces:**
- Consumes: Task 1 dan 2 (`FotoInput`, `ProdukInput` = `z.input` dari skema Task 2).
- Produces:
  - `BagianUsaha({ awal?: Partial<Revisi>; galat?: Record<string,string> })`: isian tak terkendali dengan `name` = nama kolom: `nama`, `deskripsi`, `jenis` (select `JENIS_USAHA`), `kategori` (select bergantung `jenis`; ganti jenis mengosongkan kategori), `spesifik`, `bentuk_usaha`, `tahun_mulai` (number), `omzet_rentang` (select `LABEL_OMZET`, bantuan "Hanya rentang Rp50 juta ke atas yang tampil di katalog."), `tenaga_kerja_rentang`, `memiliki_nib`, `instagram`, `tiktok`.
  - `BagianLokasi({ awal?; galat? })`: `kabupaten_kota` (select `KABUPATEN_KOTA`), `kecamatan` (input + datalist `kecamatanDari(kab)`), `alamat`.
  - `BagianKontak({ awal?; galat?; labelNomor: string; bantuanNomor?: string })`: `nama_pemilik` dan `nomor`, dengan keterangan "Tidak tampil di katalog."
  - `PemilihFoto({ nilai: FotoInput[]; onUbah(n: FotoInput[]): void; unggah(berkas: File): Promise<FotoInput>; maks: number; pilihUtama: boolean; label: string })`: dua tab "Unggah" dan "Tautan"; tombol "Jadikan foto utama" bila `pilihUtama`; tombol hapus per foto; menolak tambahan setelah `maks`.
  - `EditorProduk({ nilai: ProdukInput[]; onUbah(n: ProdukInput[]): void; unggah: PemilihFoto['unggah']; galat?: Record<string,string> })`: tambah, hapus, naik/turun; per produk `nama`, `keterangan`, kapasitas (jumlah, satuan dengan datalist `SARAN_SATUAN`, periode), satu foto lewat `PemilihFoto` (`maks: 1`, `pilihUtama: false`); maks 20.
  - `bacaIsian(fd: FormData): IsianUsaha` (keduanya diekspor dari `baca-isian.ts`; `IsianUsaha` = semua kolom ketiga bagian beserta `nomor`) mengubah isian ketiga bagian menjadi objek siap zod (string kosong menjadi `null`, `tahun_mulai` menjadi number atau null, `memiliki_nib` boolean atau null).

- [ ] **Step 1: Tulis test gagal** `umkm-form.test.tsx` (Testing Library):
  - `it('kategori mengikuti jenis')`: pilih "Jasa", opsi kategori hanya 10 kategori jasa.
  - `it('kecamatan menyarankan isi kabupaten terpilih')`: datalist berisi kecamatan Kota Metro setelah memilih "Kota Metro".
  - `it('foto bisa ditambah lewat tautan atau unggah dan satu dijadikan utama')`: setelah "Jadikan foto utama" pada foto kedua, `onUbah` dipanggil dengan tepat satu `utama: true`.
  - `it('editor produk menambah, mengurutkan, dan menghapus produk')`.
  - `it('bacaIsian mengubah kosong menjadi null')`.
  - Uji aksesibilitas ringan: setiap isian punya label (`getByLabelText`).
- [ ] **Step 2:** Jalankan, harus GAGAL.
- [ ] **Step 3:** Tulis komponen. Pakai `Field`, `Tombol` dari `src/components/ui/` dan `validasiUrlFoto` untuk tab Tautan.
- [ ] **Step 4:** Jalankan, harus LULUS.
- [ ] **Step 5:** Commit `feat(umkm): bagian formulir profil bersama`.

### Task 8: Formulir UMKM dan formulir petugas memakai bagian bersama

**Files:**
- Modify: `src/components/umkm-pemilik/FormUsaha.tsx`, `src/components/admin/umkm-tugas/ProfilForm.tsx`
- Test: `src/components/umkm-pemilik/UsahaSaya.test.tsx`, `src/components/umkm-pemilik/DetailUsahaSaya.test.tsx`, `src/components/admin/umkm-tugas/ProfilForm.test.tsx`

**Interfaces:**
- Consumes: Task 6 (`AWALAN_AKUN`), Task 7.
- Produces: kedua formulir mengirim `foto` (foto profil dengan `utama`) dan `produk` (dengan foto produk). Foto awal dipisah dari `detail.foto`: `produk_urutan == null` ke `PemilihFoto`, sisanya ke produk yang `urutan`-nya sama. Unggah:
  - `FormUsaha` mode `daftar`: `unggahKeR2('umkm-draf', \`akun/${crypto.randomUUID()}.jpg\`, blob)`;
  - mode `draf`: tetap `${detail.id}/...`;
  - `ProfilForm`: tetap seperti sekarang.
  - Pemilik tetap tidak mengirim `sumber`/`sumber_ref`.

- [ ] **Step 1: Tulis test gagal**:
  - `it('pendaftaran pertama bisa mengunggah foto dan menambah produk')` di `UsahaSaya.test.tsx`: presign dipanggil dengan path berawalan `akun/`; body kiriman memuat `produk[0].nama` dan foto `utama: true`.
  - `it('draf memisahkan foto produk dari foto profil')` di `DetailUsahaSaya.test.tsx`.
  - `it('petugas melihat dan mengubah kapasitas produk')` di `ProfilForm.test.tsx`.
  - `it('kapasitas setengah terisi menampilkan pesan')`: teks "Isi jumlah, satuan, dan periode kapasitas sekaligus, atau kosongkan ketiganya".
- [ ] **Step 2:** Jalankan ketiga berkas, harus GAGAL.
- [ ] **Step 3:** Ubah kedua formulir.
- [ ] **Step 4:** Jalankan ketiga berkas dan `npx vitest run --pool=vmForks src/components/umkm-pemilik src/components/admin/umkm-tugas`, harus LULUS.
- [ ] **Step 5:** Commit `feat(umkm): formulir usaha memakai produk, foto utama, dan pilihan rapi`.

### Task 9: Tampilan katalog dan detail petugas

**Files:**
- Modify: `src/components/umkm-katalog/ProfilKatalog.tsx`, `src/components/umkm-katalog/KartuKatalog.tsx`, CSS module yang sudah diimpor masing-masing (`publik.module.css` atau `katalog.module.css`), `src/components/admin/umkm-tugas/DetailTugas.tsx`
- Test: `src/components/umkm-katalog/Katalog.test.tsx`, `src/components/umkm-katalog/ProfilKatalog.test.tsx` (baru bila belum ada), `src/components/admin/umkm-tugas/G1.test.tsx` atau test detail yang sudah ada

**Interfaces:**
- Consumes: tipe Task 2, JSON Task 5, `formatKapasitas` dan `LABEL_TENAGA_KERJA` Task 1.
- Produces:
  - Profil publik: wilayah "Kecamatan, Kabupaten"; daftar keterangan (hanya yang terisi): Bentuk usaha, Mulai usaha (tahun), Skala usaha, `omzet_label`, Tenaga kerja; bagian "Produk" berisi nama, keterangan, `formatKapasitas` bila ada, dan foto produk.
  - Kartu: kecamatan di baris wilayah.
  - Detail petugas: nama pemilik (bertanda "Tertutup"), enam kolom baru dengan label rentang lengkap, daftar produk dengan kapasitas dan foto, dan peringatan kontak `produk` atau `kecamatan` memakai pola peringatan yang ada. Foto produk tetap bisa disembunyikan dengan tombol foto yang sudah ada dan diberi label "Foto produk: <nama produk>"; galeri foto profil di detail hanya memuat `produk_urutan == null`.

- [ ] **Step 1: Tulis test gagal**:
  - `it('profil menampilkan produk dengan kapasitas menurut UMKM')`: teks "Kapasitas 1.500 kg per bulan (menurut UMKM)".
  - `it('profil tidak menampilkan baris yang kosong')`: tanpa `omzet_label` tidak ada teks "Omzet".
  - `it('kartu menampilkan kecamatan')`.
  - `it('detail petugas menampilkan nama pemilik dan produk')`.
- [ ] **Step 2:** Jalankan, harus GAGAL.
- [ ] **Step 3:** Ubah komponen.
- [ ] **Step 4:** Jalankan `npx vitest run --pool=vmForks src/components/umkm-katalog src/components/admin/umkm-tugas`, harus LULUS.
- [ ] **Step 5:** Commit `feat(umkm): katalog dan detail petugas menampilkan produk`.

### Task 10: Menu /me dan judul Cari pemasok

**Files:**
- Modify: `src/lib/pengunjung-nav.ts:3,15-21`, `src/lib/pengunjung-nav.test.ts`, `src/app/me/_cangkang/CangkangPengunjung.tsx:27` (peta `IKON`), `src/app/me/umkm/page.tsx:5`, `src/components/umkm-perusahaan/PanelUmkmSaya.tsx:45`, `src/components/umkm-perusahaan/PanelUmkmSaya.test.tsx:41`

**Interfaces:**
- Produces: `PengunjungIconKey` menambah `'usaha' | 'pemasok' | 'lacak'`; `PENGUNJUNG_NAV` berurutan:
  1. Beranda saya `/me`;
  2. Reservasi `/me/reservasi`;
  3. Usaha saya `/me/usaha`;
  4. Cari pemasok `/me/umkm`;
  5. Notifikasi `/me/notifications` (badge);
  6. Chat `/chat`;
  7. Lacak pengaduan `/pengaduan/lacak`;
  8. Situs utama `/` (bawah).

  Ikon lucide: `Store`, `PackageSearch`, `FileSearch`. Judul metadata dan `<h1>` `/me/umkm` menjadi "Cari pemasok".

- [ ] **Step 1: Tulis test gagal**: urutan label di `pengunjung-nav.test.ts` persis daftar di atas; `cariEntriPengunjungAktif('/me/usaha/abc')` = Usaha saya; `cariEntriPengunjungAktif('/me/umkm')` = Cari pemasok; `PanelUmkmSaya.test.tsx` mencari heading "Cari pemasok".
- [ ] **Step 2:** Jalankan kedua test, harus GAGAL.
- [ ] **Step 3:** Ubah berkas.
- [ ] **Step 4:** Jalankan kedua test, harus LULUS.
- [ ] **Step 5:** Commit `feat(me): menu Usaha saya, Cari pemasok, dan Lacak pengaduan`.

### Task 11: Gerbang akhir dan dokumen

**Files:**
- Modify: `CLAUDE.md` (Peta database: satu baris `umkm_produk`, kolom revisi baru, migrasi `202611100001`-`0003` belum diterapkan), `.scratch/umkm-fitur/PROGRES.md`

- [ ] **Step 1:** `npm i --no-save @electric-sql/pglite` lalu `npx vitest run --pool=vmForks src/lib/umkm-katalog supabase/migrations`, semua LULUS dan test basis data tidak dilewati.
- [ ] **Step 2:** `npm run verify:baseline`, harus lulus lint, typecheck, test, dan build.
- [ ] **Step 3:** Pratinjau visual lokal (memori pratinjau-visual-lokal: stub, satu Chrome headless, tanpa produksi) untuk `/me/usaha` (daftar dengan produk), `/umkm/katalog`, dan profil katalog, di lebar ponsel dan desktop.
- [ ] **Step 4:** Perbarui dokumen, lalu commit `docs(umkm): catat produk dan formulir baru`.
- [ ] **Step 5:** Laporkan ke pemilik. Penerapan migrasi ke produksi menunggu persetujuan pemilik dan mengikuti aturan host dan daftar migrasi (AGENTS.md).
