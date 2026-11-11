# Rencana implementasi: refaktor arsitektur dan UI LMH

Tanggal: 2026-11-11. Rancangan: `docs/superpowers/specs/2026-11-11-refaktor-arsitektur-ui-design.md` (disebut SPEC). Bukti: `docs/superpowers/audits/bukti/{01-struktur-dan-query,02-ui-dan-css}.md` (B1, B2).

## Aturan untuk setiap tugas (wajib masuk spec worker)

- Baca `AGENTS.md`; untuk kode Next.js baca dulu bagian relevan `node_modules/next/dist/docs/01-app/` (disebut per tugas). Peta kode: `CLAUDE.md` (catatan: peta UMKM di sana usang, lihat B1 baris 5).
- Hanya menyentuh berkas yang tertulis di tugas. Bila perlu berkas lain: berhenti dan lapor PM.
- Urutan kerja: tulis test karakterisasi/merah lebih dulu -> implementasi -> test sempit `npx vitest run --pool=vmForks <berkas>` -> `npm run lint` dan `npm run typecheck`.
- Dilarang: `git push`, commit (kecuali diminta), `node scripts/apply-migration.mjs`, `npm run test:rls`, `scripts/selftest-wp*`, `scripts/verify-wp*`, membaca `.env*`, `npm run build`/`verify:baseline` (hanya PM).
- Migrasi = berkas baru bertimestamp lebih besar dari `202611100003` + test kontrak statis di sebelahnya + berkas rollback `docs/rollback-<nama>-<timestamp>.sql`. Tidak mengedit migrasi lama. Kode aplikasi HARUS tetap berjalan bila migrasi belum diterapkan (deteksi lewat `src/lib/akses-data/galat.ts`).
- WIB lewat `src/lib/time.ts`; PII lewat `lib/pii.ts`/`lib/csv.ts`; origin baru = perbarui CSP `next.config.ts`.
- Perilaku yang terlihat pengguna tidak berubah kecuali tugas menyebutnya.

Tanda: `[DB]` membuat migrasi; `[PEMILIK]` PM wajib minta persetujuan pemilik; `[VISUAL]` PM cek tangkapan layar; `[BERSYARAT]` dikerjakan hanya bila ambang SPEC terlewati. "Paralel" berarti boleh bersamaan dengan tugas lain di gelombang yang sama; tanpa tanda itu = berurutan sesuai nomor.

Penutup tiap gelombang (PM): review diff oleh Opus (daftar periksa di tiap gelombang) -> `npm run verify:baseline` -> catat di `.superpowers/sdd/progress.md` -> commit lokal. Push hanya setelah `[PEMILIK]`.

## Ringkasan gelombang

| G | Isi | Tugas | Sentuh DB | Risiko |
|---|---|---|---|---|
| G0 | Ukur baseline + pagar anggaran | 4 | baca saja (PM) | rendah |
| G1 | Kemenangan murah tanpa migrasi | 10 | tidak | rendah-sedang |
| G2 | Rekap, lencana, UMKM sisi DB | 5 (2 bersyarat) | ya | sedang |
| G3 | Token + komponen dasar | 8 | tidak | sedang (visual) |
| G4 | Lapisan data + server component publik | 7 | tidak | sedang |
| G5 | Pecah `admin/antrian` | 5 | tidak | tinggi |
| G6 | Pecah `chat` | 5 | tidak | tinggi |
| G7 | Pecah `admin/chat` | 4 | tidak | sedang |
| G8 | Pecah `admin/chat/faq` | 3 | tidak | sedang |
| G9 | Pecah `me/reservasi` | 3 | tidak | sedang |
| G10 | Dokumen + pembersihan akhir + ukur sesudah | 5 | baca saja (PM) | rendah |

Total 11 gelombang, 59 tugas. G5-G9 saling bebas berkas; boleh paling banyak dua gelombang bersamaan (kapasitas review).

---

## G0. Baseline dan pagar

**0.1 Skrip ukur SQL (sonnet, paralel)**
- Berkas: buat `docs/superpowers/audits/ukur/baseline.sql`, `docs/superpowers/audits/ukur/README.md`.
- Langkah: tulis kueri SPEC §10 butir 1-4. Tiap blok: `BEGIN; SET LOCAL role authenticated; SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}'; EXPLAIN (ANALYZE, BUFFERS) ...; ROLLBACK;`. Salin dua cabang SELECT `rekap_pelayanan_inti` dari `supabase/migrations/202611040001_perbaikan_tinjauan_akhir.sql:621-654` dengan literal tanggal dan tanpa predikat lingkup. Tanda tangan RPC: `rekap_data_pelayanan(p_dari,p_sampai,p_unit,p_layanan_id,p_batas,p_lewati,p_setelah,p_hitung,p_tanpa_form)` (`202611010005`), `umkm_cari_katalog(p_q,p_jenis,p_kategori,p_spesifik,p_kabupaten_kota,p_sort,p_cursor)` (`202611100003`). README: cara menjalankan, placeholder yang harus diisi PM, format tabel hasil.
- Diterima: tidak ada pernyataan yang menulis data; tidak ada kredensial; tiap blok diakhiri `ROLLBACK`.

**0.2 Pengukur durasi server (sonnet, paralel)**
- Berkas: buat `src/lib/observability/durasi.ts`, `durasi.test.ts`; ubah `src/app/api/admin/rekap/terpadu/route.ts`, `src/app/api/umkm-katalog/route.ts`.
- Antarmuka: `buatPengukur(): { ukur<T>(nama: string, kerja: () => Promise<T>): Promise<T>; header(): string }`; `header()` menghasilkan nilai `Server-Timing` (`auth;dur=12, lingkup;dur=30`). Nama hanya `[a-z0-9_-]`.
- Langkah: bungkus tiap langkah DB di dua route; tambahkan header `Server-Timing` pada respons sukses. Tidak mengubah urutan atau isi respons.
- Test: `npx vitest run --pool=vmForks src/lib/observability/durasi.test.ts src/app/api/admin/rekap/terpadu src/app/api/umkm-katalog`.
- Diterima: test route lama tetap hijau tanpa diubah; header ada.

**0.3 Test anggaran kode (sonnet, paralel)**
- Berkas: buat `src/test/anggaran-kode.test.ts`, `src/test/anggaran-kode.json`.
- Langkah: test membaca berkas di `src/` (bukan `*.test.*`) dan menghitung: `hex`, `rgb` (literal di `*.module.css`, di luar deklarasi `--x:`), `zIndexLiteral` (`z-index:` angka >= 100), `breakpointLuarSkala` (`@media` lebar selain 640/1024/1280; abaikan `layar-token.module.css`), `kelasBtn` (kemunculan `btn` dalam `className` di `.tsx`), `windowConfirm`, `selectBintang` (`.select('*')` tanpa `head`), `kueriDiPage` (`.from(`/`.rpc(` dalam `src/app/**/page.tsx`), `barisPageRaksasa` (jumlah baris lima `page.tsx` pada SPEC §7). Bandingkan dengan JSON: gagal bila naik; bila turun, pesan menyuruh memperbarui JSON.
- Diterima: test hijau dengan angka saat ini; menaikkan satu angka secara sengaja membuatnya merah (buktikan lalu kembalikan).

**0.4 [PEMILIK] PM menjalankan baseline**
- PM menampilkan host tujuan, minta persetujuan, menjalankan `baseline.sql` (baca saja), menyimpan `docs/superpowers/audits/ukur/hasil-sebelum.md`; menambah pengukuran aplikasi (request/menit tab admin diam 5 menit, layar TV 5 menit, `Server-Timing` rekap 7/30/366 hari).
- Keluaran: putusan atas tiga tugas `[BERSYARAT]` (2.3, 2.4, 2.5) memakai ambang SPEC §6.

Review Opus G0: skrip benar-benar baca saja; anggaran tidak menghasilkan positif palsu yang menghalangi kerja wajar.

---

## G1. Kemenangan murah (tanpa migrasi)

**1.1 Font tunggal (sonnet, paralel)** Dok: `01-getting-started/13-fonts.md`.
- Berkas: `src/styles/globals.css`, `src/app/layout.tsx`, `next.config.ts`, `src/test/next-config-security.test.ts`.
- Langkah: hapus `@import url('https://fonts.googleapis.com/...')` (`globals.css:5`); ubah `--font-sans` menjadi `var(--font-inter), 'Plus Jakarta Sans', system-ui, ...` dan `--font-display` menjadi `var(--font-jakarta), var(--font-inter), sans-serif`; pastikan `<html>` memuat `inter.variable` dan `plusJakartaSans.variable`; hapus `https://fonts.googleapis.com` dari `style-src` dan `https://fonts.gstatic.com` dari `font-src`.
- Test dulu: ubah test CSP agar menuntut kedua origin TIDAK ada. `npx vitest run --pool=vmForks src/test/next-config-security.test.ts`.
- Diterima: `grep -r "fonts.googleapis" src next.config.ts` kosong.

**1.2 Keluarkan exceljs dari bundel klien (sonnet, paralel)**
- Berkas: buat `src/lib/rekap/definisi.ts`; ubah `src/lib/rekap/excelTerpadu.ts`, `src/app/admin/rekap/page.tsx` (hanya baris impor).
- Langkah: pindahkan `DEFINISI_DILAYANI` ke `definisi.ts`; `excelTerpadu.ts` mengimpornya dari sana (tetap mengekspor ulang agar pemakai server tidak berubah); `page.tsx` mengimpor dari `definisi.ts`.
- Test: `npx vitest run --pool=vmForks src/lib/rekap/excelTerpadu.test.ts src/app/admin/rekap/rekap.test.tsx`.
- Diterima: tidak ada berkas `'use client'` yang (langsung) mengimpor `excelTerpadu`.

**1.3 Recharts dimuat malas (sonnet, paralel)** Dok: `02-guides/lazy-loading.md` (`ssr: false` hanya di client component).
- Berkas: buat `src/components/ui/grafik/dinamis.tsx` (+ `dinamis.test.tsx`); ubah baris impor di berkas non-test di luar `src/components/ui/grafik/` yang mengimpor `GrafikBatang|GrafikDonat|GrafikGaris`, `IkmPanel`, `PanelIkmGlobal`, `PanelSpakGlobal`, `TrenGrafik` (temukan dengan Grep; laporkan daftarnya; KECUALI lima halaman raksasa SPEC §7).
- Antarmuka: `dinamis.tsx` (`'use client'`) mengekspor `GrafikBatangMalas`, `GrafikDonatMalas`, `GrafikGarisMalas`, `IkmPanelMalas`, `PanelIkmGlobalMalas`, `PanelSpakGlobalMalas`, `TrenGrafikMalas` = `dynamic(() => import(...), { ssr: false, loading: () => <Skeleton bentuk=... label="Memuat grafik" /> })` dengan props sama.
- Test: test halaman yang terdampak memakai `findBy*`/`waitFor`; test komponen grafik asli tidak diubah.
- Diterima: tidak ada impor statis `recharts` yang terjangkau dari `page.tsx` selain lewat `dinamis.tsx`.

**1.4 Polling adaptif (sonnet; setelah itu review Opus khusus)**
- Berkas: `src/lib/hooks/useRealtimeRefetch.ts`, `useRealtimeRefetch.test.tsx`.
- Antarmuka: opsi tambahan `pollSaatTersambungMs?: number` (default `120_000`); `pollMs` tetap (default `30_000`) = jeda saat channel belum `SUBSCRIBED`.
- Langkah: pakai callback `subscribe((status) => ...)`; simpan `tersambung = semua channel SUBSCRIBED`; ganti `setInterval` dengan `setTimeout` berantai yang memilih jeda; saat `document.hidden` tidak menjadwalkan; pada `visibilitychange` ke terlihat: satu refetch lalu jadwalkan lagi; tanpa channel (lingkungan test) berperilaku seperti sekarang.
- Test dulu (fake timers): (a) belum tersambung -> refetch tiap 30 dtk; (b) tersambung -> tidak ada refetch sampai 120 dtk; (c) tersembunyi -> nol; (d) kembali terlihat -> tepat satu; (e) bersih saat unmount.
- Test: `npx vitest run --pool=vmForks src/lib/hooks/useRealtimeRefetch.test.tsx`.

**1.5 Layar TV hemat (sonnet, paralel)**
- Berkas: `useAntreanFeed.ts`, `usePanggilanLayar.ts` (cari dengan Glob `src/**/use{AntreanFeed,PanggilanLayar}.ts`) + test di sebelahnya; `src/app/layar/[token]/page.tsx` (hanya `select`).
- Langkah: ganti `select('*')` `v_layar_antrian` dengan kolom yang benar-benar dibaca; polling panggilan `POLL_PANGGILAN_MS` (5 dtk) hanya saat channel tidak `SUBSCRIBED`, 20 dtk saat tersambung; umpan antrean 15 dtk saat putus, 30 dtk saat tersambung. Peristiwa Realtime tetap memicu muat seketika.
- Test dulu: jeda per status channel; panggilan baru lewat peristiwa tetap tampil tanpa menunggu polling.
- Diterima `[VISUAL]`: PM menghitung request 5 menit di satu layar (target <= 5/menit).

**1.6 Rekap: paralel, hitung sekali, batas waktu (sonnet; setelah 0.2 dan 1.2)** Dok: `03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`.
- Berkas: `src/app/api/admin/rekap/terpadu/route.ts`, `src/app/api/admin/rekap/terpadu/export/route.ts`, `src/lib/rekap/terpaduServer.ts`, `src/lib/rekap/schemas.ts` (+ `schemas.test.ts`), `src/app/admin/rekap/page.tsx`, `src/app/api/admin/rekap/terpadu/{terpadu,ringkasan.route}.test.ts`.
- Langkah: (1) skema: `hemat` opsional (`'1'` -> true). (2) route data: setelah lingkup lolos, `Promise.all([ringkasan, data])`; bila `hemat`, lewati ringkasan dan kirim `p_hitung: false`, respons `total: null`, `ringkasan: null`. Pemeriksaan otorisasi (`muatLingkup`) tetap lebih dulu dan tidak diparalelkan dengan data. (3) klien: simpan `total` dan ringkasan per kunci filter (semua parameter kecuali `page`); kirim `hemat=1` bila kunci sama dan nilai sudah ada; filter berubah = muat penuh. (4) ekspor: `export const maxDuration = 60`; `exceljs` lewat `await import()` di dalam builder (bukan top-level) bila tidak mematahkan tipe.
- Test dulu: route dengan `hemat=1` tidak memanggil RPC ringkasan dan mengirim `p_hitung false`; tanpa `hemat` bentuk respons sama persis dengan sekarang; halaman tetap menampilkan total saat pindah halaman.
- Test: `npx vitest run --pool=vmForks src/app/api/admin/rekap src/lib/rekap src/app/admin/rekap`.

**1.7 `maxDuration` route berat lain (sonnet, paralel)**
- Berkas: `src/app/api/admin/survei/export/route.ts`, `src/app/api/admin/umkm-laporan/export/route.ts`, `src/app/api/admin/rekap/performa/route.ts`, `src/app/api/admin/dokumen/embed/route.ts`, `src/app/api/investment-docs/upload/route.ts`, `src/app/api/investment-docs/page-image/route.ts`.
- Langkah: tambah `export const maxDuration = 60` (page-image: 30). Tidak ada perubahan lain.
- Diterima: test route masing-masing tetap hijau.

**1.8 Filter UMKM bertingkat (sonnet, paralel)** `[VISUAL]`
- Berkas: buat `src/lib/umkm-katalog/filter-bertingkat.ts` (+ test); ubah `src/components/umkm-katalog/Katalog.tsx`, `Katalog.test.tsx`, `katalog.module.css`.
- Antarmuka: `URUTAN_JENIS: readonly JenisUsaha[] = ['Bahan Baku','Produk','Jasa']`; `kategoriUntuk(jenis: string, tersedia: readonly string[]): string[]` (urutan `KATEGORI_PER_JENIS`, hanya yang ada di `tersedia`; jenis kosong/tidak sah -> `[]`); `gantiJenis(filters, jenis)` -> `{ ...filters, jenis, kategori: '', spesifik: '' }`.
- Langkah: baris chip pertama = "Semua jenis" + jenis dari `URUTAN_JENIS` yang ada di `options.jenis`; baris chip kategori hanya dirender bila `filters.jenis` terisi (chip pertama "Semua kategori"); bila irisan kosong tampilkan catatan "Belum ada kategori untuk jenis ini."; hapus `<select>` Jenis dan Kategori dari panel (sisa: Kabupaten/kota, Spesifik); `resetAll` tidak berubah; parameter ke API tidak berubah.
- Test dulu: awal tanpa chip kategori; pilih jenis -> hanya kategori jenis itu; ganti jenis -> `kategori` dan `spesifik` kosong dan satu permintaan baru tanpa `kategori`; "Semua jenis" menyembunyikan kategori.
- Test: `npx vitest run --pool=vmForks src/lib/umkm-katalog/filter-bertingkat.test.ts src/components/umkm-katalog/Katalog.test.tsx`.

**1.9 Katalog UMKM: statistik di luar respons + cache (sonnet; review Opus wajib)** Dok: `03-api-reference/04-functions/after.md`, `02-guides/cdn-caching.md`, `03-api-reference/04-functions/unstable_cache.md`.
- Berkas: `src/app/api/umkm-katalog/route.ts`, `route.test.ts`, `src/lib/umkm-katalog/publik-server.ts`.
- Langkah: (1) `catatTanpaHasil` dijalankan di dalam `after(...)`; galatnya ditelan. (2) syarat cache menjadi: tanpa `q`, tanpa `spesifik`, tanpa `cursor`. (3) `layaniPublik` menerima opsi `headerSukses?: HeadersInit`; untuk kasus ber-cache dan `items.length > 0` kirim `Cache-Control: public, s-maxage=60`; selain itu tetap `headersPrivat`. Respons galat selalu `headersPrivat`.
- Test dulu: respons dikembalikan sebelum `catatTanpaHasil` selesai (mock `after`); permintaan dengan `jenis` saja memakai jalur cache; dengan `q` tidak; header sesuai tabel di atas.
- Diterima: tidak ada cookie/sesi dibaca di jalur ber-cache (review Opus).

**1.10 `DialogKonfirmasi` + ganti `window.confirm` (sonnet)** `[VISUAL]`
- Berkas: buat `src/components/ui/DialogKonfirmasi.tsx`, `DialogKonfirmasi.test.tsx`; ubah `src/app/admin/dokumen/page.tsx`, `src/app/admin/gallery/page.tsx`, `src/app/admin/layar/page.tsx`, `src/app/admin/settings/jadwal/page.tsx`, `src/components/ui/README.md`.
- Antarmuka: `{ terbuka: boolean; judul: string; deskripsi?: ReactNode; labelSetuju?: string; labelBatal?: string; berbahaya?: boolean; memuat?: boolean; onSetuju(): void; onBatal(): void }`; dibangun di atas `KerangkaModal` dengan `role="alertdialog"`, fokus awal di tombol Batal, Escape = `onBatal`, terkunci saat `memuat`.
- Langkah: tiga `window.confirm` diganti state `{ id } | null` + dialog; alertdialog buatan tangan di `jadwal/page.tsx:590` diganti komponen ini (teks sama).
- Test dulu: fokus awal, Escape, jebak fokus, `memuat` mengunci; tiap halaman: batal tidak memanggil hapus, setuju memanggil sekali.
- Diterima: anggaran `windowConfirm` = 0 (perbarui JSON).

Review Opus G1: 1.4 (kebocoran timer, balapan status), 1.6 (otorisasi tetap sebelum data; `hemat` tidak bisa dipakai melewati lingkup), 1.9 (keamanan cache), 1.8 (aksesibilitas chip). Gerbang: `npm run verify:baseline`. `[PEMILIK]` push/deploy G1; PM mengulang pengukuran aplikasi.

---

## G2. Sisi database

Semua tugas `[DB]`: tambahkan skenario di `scripts/lokal-rantai/` (PGlite) bila fungsi bisa dijalankan di sana; worker TIDAK menerapkan migrasi.

**2.1 [DB] Rekap satu lintasan (sonnet menulis, Opus mereview SQL)**
- Berkas: buat `supabase/migrations/202611110001_rekap_satu_lintasan.sql`, `202611110001_rekap_satu_lintasan.test.ts`, `docs/rollback-rekap-satu-lintasan-202611110001.sql`, `scripts/lokal-rantai/skenario-rekap-lintasan.mjs`; ubah `src/lib/rekap/terpaduServer.ts` (ukuran halaman ekspor), `src/lib/rekap/exportAllPages.test.ts` bila terdampak.
- Langkah: `CREATE OR REPLACE FUNCTION public.rekap_data_pelayanan` dengan tanda tangan 9 argumen dan bentuk hasil `{total, rows, berikut}` yang SAMA dengan `202611010005`. Isi: `WITH semua AS MATERIALIZED (SELECT i.* FROM rekap_pelayanan_inti(...) i WHERE <filter p_tanpa_form>)`, `pilih` mengambil dari `semua` (keyset/OFFSET seperti sekarang), `total` = `(SELECT count(*) FROM semua)` hanya bila `p_hitung`. Batas `v_batas` maksimum 5000 bila `p_setelah` terisi atau `p_lewati = 0` dengan `p_hitung = false`, selain itu tetap 1000. Bagian `detail` disalin tanpa perubahan. Pertahankan `SECURITY DEFINER`, `search_path`, `REVOKE/GRANT` seperti migrasi asal (salin). Rollback = definisi `202611010005` apa adanya. Aplikasi: ekspor meminta 5000 per panggilan dan tetap benar bila DB lama memotong ke 1000 (loop berhenti berdasarkan `berikut`, bukan jumlah baris).
- Test kontrak dulu: nama fungsi, 9 argumen, `MATERIALIZED`, inti dipanggil tepat satu kali dalam badan fungsi, grant. Skenario PGlite: hasil `rows` dan `total` identik dengan fungsi lama untuk admin, FO biasa, Petugas Koordinator, pada OFFSET dan keyset.
- Test: `npx vitest run --pool=vmForks supabase/migrations/202611110001_rekap_satu_lintasan.test.ts src/lib/rekap`; `node scripts/lokal-rantai/skenario-rekap-lintasan.mjs`.

**2.2 [DB] Lencana navigasi satu RPC (sonnet menulis, Opus mereview paritas; paralel dengan 2.1)**
- Berkas: buat `supabase/migrations/202611110002_nav_lencana.sql` (+ `.test.ts`), `docs/rollback-nav-lencana-202611110002.sql`, `scripts/lokal-rantai/skenario-nav-lencana.mjs`; ubah `src/lib/hooks/useNavBadges.ts`, `useNavBadges.test.tsx`.
- Antarmuka: `public.nav_lencana_saya(p_tanggal date) RETURNS jsonb`, `LANGUAGE sql STABLE SECURITY INVOKER`, kunci hasil = nama lencana yang sekarang dihitung di `useNavBadges.ts:75-130` (salin predikat satu per satu; RLS pemanggil yang membatasi). `GRANT EXECUTE` hanya `authenticated`.
- Langkah klien: panggil RPC satu kali per tick; bila galat "fungsi tidak ada" (pakai pendeteksi di `lib/akses-data/galat.ts`), tandai sekali dan pakai jalur 8 query lama. Cabang per role tetap di klien bila predikat bergantung opsi klien; bila demikian, kirim sebagai argumen tambahan dan catat di laporan.
- Test dulu: paritas angka RPC vs query lama pada skenario PGlite untuk tiga role; klien jatuh ke jalur lama saat fungsi belum ada.

**2.3 [DB][BERSYARAT] Indeks pencarian UMKM (sonnet)** hanya bila ambang SPEC §6.2 terlewati.
- Berkas: buat `supabase/migrations/202611110003_umkm_cari_indeks.sql` (+ `.test.ts`), rollback.
- Langkah: `CREATE INDEX IF NOT EXISTS` GIN `gin_trgm_ops` pada `umkm_revisi(spesifik)` dan `umkm_produk(nama)`; `CREATE OR REPLACE umkm_cari_katalog` dengan predikat `q` ditulis ulang menjadi `r.id IN (SELECT id FROM umkm_revisi WHERE nama ILIKE q OR deskripsi ILIKE q OR spesifik ILIKE q OR kategori ILIKE q UNION SELECT revisi_id FROM umkm_produk WHERE nama ILIKE q)`; sisanya disalin persis dari `202611100003`. Opus wajib mereview kesetaraan hasil dan urutan.

**2.4 [DB][BERSYARAT] Performa di SQL (opus merancang, sonnet menulis)** hanya bila ambang SPEC §6.1 terlewati.
- Berkas: migrasi `202611110004_rekap_performa.sql` (+ test, rollback); `src/app/api/admin/rekap/performa/route.ts`, `src/lib/rekap/performa.ts` (+ test).
- Langkah: test paritas dulu dari `performa.test.ts` (masukan baris -> keluaran `hitungPerforma`); RPC mengembalikan bentuk yang sama; route memakai RPC dengan fallback JS.

**2.5 [DB][BERSYARAT] Indeks rekap (opus)** hanya dengan bukti `EXPLAIN` dari 0.4; satu indeks = satu alasan tertulis + rencana sebelum/sesudah.

**Gerbang G2 `[PEMILIK]`**: PM menampilkan host + daftar migrasi (`202611110001`, `0002`, yang bersyarat bila ada), status staging (tidak ada; PGlite diterima, lihat Keputusan pemilik 1), minta persetujuan, menerapkan satu per satu, lalu mengulang `baseline.sql` ke `hasil-sesudah-g2.md`. Review Opus G2: tidak ada perubahan lingkup/RLS; fungsi lama dan baru setara; rollback teruji di PGlite.

---

## G3. Token dan komponen dasar

**3.1 Satu berkas token, nilai identik (sonnet; review Opus)** `[VISUAL]`
- Berkas: buat `src/styles/token.css`, `src/test/token-peta.test.ts`, `src/test/token-peta.json`; ubah `src/styles/globals.css`, `src/styles/tema-dasbor.css`, `src/app/layout.tsx`, `src/test/tema-dasbor.test.ts`, `src/components/umkm-katalog/katalog.module.css`, `src/components/umkm-katalog/kerangka.module.css`.
- Langkah: (1) SEBELUM mengubah apa pun, tulis `token-peta.test.ts` yang mengurai semua deklarasi `--x: nilai` di blok `:root` dan `[data-tema="dasbor"]` dari berkas CSS global dan menyimpan peta per lingkup ke `token-peta.json` (karakterisasi). (2) pindahkan semua deklarasi ke `token.css` (dua blok); tambahkan di `:root` token semantik yang sebelumnya hanya ada di dasbor dengan nilai publik setara (`--bg-surface: var(--surface-primary)`, `--border-subtle: var(--border-default)`, `--fs-body: var(--text-sm)`, `--pad-page: var(--space-6)`, `--gap-grid: var(--space-5)`, `--focus-ring`, `--status-*`, `--target*`, `--chart-*` = nilai dasbor); (3) hapus definisi ulang lokal di dua modul katalog bila nilainya sama dengan `:root` baru (bila beda, pertahankan nilai lokal itu sebagai nilai `:root` agar katalog tidak berubah, dan catat); (4) `layout.tsx` mengimpor `token.css` sebelum `globals.css`; (5) tulis kontrak breakpoint dan z-index sebagai komentar kepala.
- Diterima: peta token per lingkup untuk nama yang sudah ada tidak berubah (test); anggaran "token tak terdefinisi" = 0; PM membandingkan tangkapan layar `/`, `/umkm/katalog`, `/chat`, `/me`, `/admin`, `/admin/antrian`.
- Test: `npx vitest run --pool=vmForks src/test/token-peta.test.ts src/test/tema-dasbor.test.ts src/test/kebersihan-dasbor.test.ts`.

**3.2 Z-index bertoken + kontras tersier (sonnet; setelah 3.1)** `[VISUAL]`
- Berkas: `src/app/gallery/gallery.module.css`, `src/components/admin/FoDialog.module.css`, `src/components/admin/PelayananWizardModal.module.css`, `src/components/homepage/Homepage.module.css`, `src/components/ui/KerangkaModal.module.css`, `src/components/profile-gate.module.css`, modul lain dengan `z-index` >= 100 (dari keluaran anggaran), `src/styles/token.css`, `src/test/tema-dasbor.test.ts`.
- Langkah: literal >= 100 -> `var(--z-dropdown|sticky|modal|overlay|toast)` menurut peran (modal 1000 -> `--z-modal`; gate 99999 -> `--z-overlay`). `--text-tertiary` dasbor diganti nilai yang lulus; test rumus WCAG menuntut >= 4,5 terhadap `--bg-canvas`, `--bg-surface`, `--bg-surface-muted` (calon `#5c6b82`).
- Diterima: anggaran `zIndexLiteral` = 0; toast tetap di atas modal (cek PM).

**3.3 Modal satu cangkang (sonnet; review Opus a11y; setelah 3.2)** `[VISUAL]`
- Berkas: `src/components/admin/FormDialog.tsx`, `src/components/admin/FoDialog.tsx`, `src/components/admin/FoDialog.module.css`, hapus `src/lib/hooks/useDialogA11y.ts`, `src/app/gallery/page.tsx`, `src/app/gallery/gallery.module.css`, test terkait di sebelahnya.
- Langkah: `FormDialog` dan `FoDialog` mempertahankan props publik, isi diganti `KerangkaModal` (tanpa inline style overlay); dua dialog galeri (`page.tsx:356,461`) memakai `Dialog` (hapus handler Escape/fokus manual).
- Test dulu: untuk tiap pembungkus: Escape menutup (kecuali `dikunci`), Tab terjebak, fokus kembali ke pemicu, `aria-modal`, judul terhubung. Test pemakai lama tetap hijau tanpa diubah.
- Test: `npx vitest run --pool=vmForks src/components/admin src/components/ui/Dialog.test.tsx src/app/gallery`.

**3.4 `IsiHalaman` + padding admin (sonnet; paralel dengan 3.3)** `[VISUAL]`
- Berkas: buat `src/components/layout/IsiHalaman.tsx`, `IsiHalaman.module.css`, `IsiHalaman.test.tsx`; ubah `page.tsx` + modul CSS milik: `admin/kunjungan`, `admin/absensi`, `admin/petugas`, `admin/pengaduan`, `admin/rekap`, `admin/layanan`, `admin/investasi-leads`, `admin/profil`; `src/app/admin/admin.module.css`.
- Antarmuka: `<IsiHalaman lebar?: 'penuh' | 'baca'>{children}</IsiHalaman>`: `padding: 0 var(--pad-page) var(--pad-page)`, `max-width: var(--content-max)`, `display: grid; gap: var(--gap-grid); min-width: 0`.
- Langkah: ganti pembungkus lokal; hapus aturan pembungkus lama dari modul; `.adminBody` tidak lagi menambah padding horizontal. `rekap` dan `absensi`: muat awal memakai `Skeleton`, kosong memakai `StatusKosong`.
- Diterima: PM cek 8 halaman pada 1440 px dan 390 px.

**3.5 `.btn` ke `Tombol`, tiga kelompok (sonnet x3, paralel antar kelompok; setelah 3.4)**
- Berkas: (a) `src/app/admin/**`; (b) `src/app/**` di luar `admin`; (c) `src/components/**`. Hanya berkas `.tsx` yang cocok `className=.*\bbtn\b` (Grep), KECUALI lima halaman raksasa SPEC §7 dan berkas yang disentuh 3.3/3.4 di kelompok lain (PM membagi daftar final sebelum dispatch).
- Langkah: pemetaan `btn--primary` -> `varian="utama"`, `btn--sm` -> `ukuran="kecil"`, dst. menurut props `Tombol` (baca `components/ui/Tombol.tsx`); tautan ber-`.btn` -> `<Tombol href>`; test yang mencari berdasarkan role/nama tidak boleh berubah.
- Diterima: anggaran `kelasBtn` turun menjadi sisa di lima halaman raksasa saja.

**3.6 `<table>` mentah ke `Tabel` (sonnet x5, paralel; setelah 3.4)**
- Berkas (satu tugas per berkas + test + modulnya): `src/app/admin/layanan/page.tsx`, `src/app/admin/topik/page.tsx`, `src/app/admin/layar/page.tsx`, `src/app/admin/fo/penanganan/page.tsx`, `src/app/admin/rekap/TabelDataPelayanan.tsx`.
- Langkah: definisi `kolom` + `caption`; `kartuDiHp` untuk tabel lebar; `TabelDataPelayanan`: hapus `<tr onClick>`, tambah kolom `peran: 'aksi'` berisi `<Tombol varian="teks">Lihat detail</Tombol>`.
- Test dulu: jumlah baris/kolom dan teks sel sama; detail bisa dibuka dengan keyboard.

**3.7 Breakpoint: tutup celah 1px (sonnet, paralel)**
- Berkas: semua `*.module.css` yang memuat `639px`, `767px`, `1023px` (Grep), `src/test/anggaran-kode.json`.
- Langkah: `max-width: 639px` -> `640px`, `767px` -> `768px`, `1023px` -> `1024px`. Tidak mengubah angka lain. Daftar izin breakpoint di anggaran diperbarui.

**3.8 README komponen (sonnet; terakhir)**
- Berkas: `src/components/ui/README.md`.
- Langkah: tambah `DialogKonfirmasi`, `IsiHalaman`, aturan token/z-index/breakpoint, aturan "satu tombol, satu modal, satu tabel", daftar yang sengaja tidak dibuat.

Review Opus G3: tidak ada perubahan visual tak disengaja (peta token), a11y modal, tidak ada token baru di luar `token.css`. Gerbang `verify:baseline`. Tahap 2 token dibatalkan atas keputusan pemilik (tema publik tetap berbeda).

---

## G4. Lapisan data dan server component publik

**4.1 Referensi bersama (sonnet)**
- Berkas: buat `src/lib/data/referensi.ts` (+ test), `src/lib/data/klien/useReferensi.ts` (+ test); ubah `src/app/admin/topik/page.tsx`, `src/app/admin/dokumen/page.tsx`, `src/components/admin/TopikCatatanFields.tsx`.
- Antarmuka: `muatLayananRingkas(sb): Promise<Hasil<LayananRingkas[]>>` (`id, nama, slug, form_pendataan, diarsipkan_at`), `muatPetugasRingkas(sb)` (`id, nama, role, layanan_id, aktif`), `muatTopik(sb, layananId)`, `muatHariLibur(sb, dari, sampai)`; `type Hasil<T> = { data: T; error: null } | { data: null; error: string }`. `useReferensi(kunci, pemuat, { ttlMs = 300_000 })` -> `{ data, memuat, galat, segarkan }`; cache tingkat modul, permintaan bersamaan digabung, `segarkan()` membuang cache kunci itu.
- Test dulu: dua komponen dengan kunci sama = satu panggilan; TTL; galat tidak di-cache.

**4.2 Data publik ber-cache (sonnet; review Opus wajib)** Dok: `02-guides/caching-without-cache-components.md`, `03-api-reference/04-functions/{unstable_cache,revalidateTag}.md`.
- Berkas: buat `src/lib/data/publik-server.ts` (+ test).
- Antarmuka: `muatBerandaPublik()` (blok + layanan publik + pengaturan situs publik), `muatLayananPublik()`, `muatFaqPublik()`; `TAG_PUBLIK = { beranda: 'publik-beranda', layanan: 'publik-layanan', faq: 'publik-faq' }`; `revalidate: 60`. `import 'server-only'`; klien anon `persistSession: false`; tidak mengimpor `lib/supabase/server`.
- Langkah: pakai ulang fungsi murni `lib/homepage/{blok,data}.ts` dengan menyuntikkan klien anon (bila fungsi itu membuat klien sendiri, tambahkan parameter klien opsional tanpa mengubah pemanggil lama).
- Test dulu: tidak ada akses `cookies()`/`headers()`; fallback berlapis `muatLayanan` tetap bekerja.

**4.3 Beranda menjadi server component (sonnet; review Opus; setelah 4.2)** `[VISUAL]` Dok: `01-getting-started/05-server-and-client-components.md`.
- Berkas: `src/app/page.tsx`, buat `src/components/homepage/PulauPengguna.tsx`, `src/components/homepage/PulauStatus.tsx`, test di sebelahnya, test beranda yang ada.
- Langkah: `page.tsx` tanpa `'use client'`, `export const revalidate = 60`, data dari `muatBerandaPublik()`; bagian `getUser` + role (`page.tsx:90-92`) pindah ke `PulauPengguna`; status buka hari ini (`layanan_status_hari_ini`) tetap dimuat klien di `PulauStatus`; popup `?layanan=` tetap di dalam `<Suspense>`.
- Diterima: HTML awal sudah memuat daftar layanan (test render server); tidak ada data pengguna di keluaran server.

**4.4 Halaman publik lain ke server (sonnet x4, paralel; setelah 4.2)**
- Berkas (satu tugas per halaman): `src/app/transparansi/page.tsx`; `src/app/kebijakan-privasi/page.tsx` (+ buat modul CSS, pindahkan inline style); `src/app/pengaduan/page.tsx` (daftar layanan dari server sebagai props ke form client yang diekstrak ke `FormPengaduan.tsx`); `src/app/chat/page.tsx` TIDAK disentuh di sini (G6).
- Diterima: `'use client'` hilang dari `page.tsx` terkait; perilaku form sama.

**4.5 Route revalidasi (sonnet; review Opus)**
- Berkas: buat `src/app/api/admin/revalidasi/route.ts` (+ test); ubah `src/app/admin/settings/landing/page.tsx`, `src/app/admin/layanan/page.tsx` (panggil setelah simpan berhasil; galat diabaikan).
- Antarmuka: `POST { tag: 'publik-beranda' | 'publik-layanan' | 'publik-faq' }`; hanya role admin (cek seperti route admin lain); zod; `revalidateTag(tag, { expire: 0 })`; respons `{ ok: true }`.

**4.6 Pusat Realtime (opus merancang dan menulis)**
- Berkas: buat `src/lib/realtime/pusat.ts` (+ test); ubah `src/lib/hooks/useRealtimeRefetch.ts` (+ test), `src/lib/hooks/useNavBadges.ts` (+ test).
- Antarmuka: `langganTabel(tabel: string, pendengar: () => void): () => void` (refcount; channel `staf-tabel-<tabel>` dibuat saat pendengar pertama, dihapus saat terakhir pergi); `statusTabel(tabel): 'tersambung' | 'putus'`; `langganStatus(tabel, cb)`.
- Diterima: sidebar + `admin/antrian` terbuka bersamaan = satu channel untuk `tiket_antrean` (test dengan klien tiruan); perilaku 1.4 tetap.

**4.7 Kolom eksplisit (sonnet, paralel)**
- Berkas: `src/app/admin/gallery/page.tsx`, `src/components/EstimasiAntrean.tsx`.
- Langkah: ganti `select('*')` dengan kolom yang dibaca kode. Anggaran `selectBintang` = 2 (pengecualian `api/admin/pelayanan/[tiketId]`, beri komentar alasan di sana tidak termasuk tugas ini).

Review Opus G4: aturan anti-bocor SPEC §5; tidak ada jalur ber-cache yang menyentuh sesi; refcount Realtime tanpa kebocoran. Gerbang `verify:baseline`. `[PEMILIK]` push/deploy.

---

## G5-G9. Pemecahan halaman raksasa (pola sama)

Struktur target per halaman (SPEC §7): `lib/data/<domain>.ts`, `<halaman>/_logika/*.ts`, `<halaman>/_hook/use*.ts`, `<halaman>/_bagian/*.tsx`, `page.tsx` <= 200 baris. Tugas dalam satu gelombang BERURUTAN (berkas `page.tsx` sama). Tiap tugas: test lama halaman itu harus hijau TANPA diubah (kecuali jalur impor); bila sebuah test perlu diubah isinya, berhenti dan lapor. Di tugas terakhir tiap gelombang: sisa `.btn` -> `Tombol`, pembungkus -> `IsiHalaman`, perbarui anggaran.

### G5. `admin/antrian` (opus untuk 5.1 dan 5.3; sonnet sisanya)
Test: `npx vitest run --pool=vmForks src/app/admin/antrian`.
- **5.1 Karakterisasi**: baca `page.tsx` dan tiga test yang ada (`antrian.test.tsx`, `antrian.paginasi.test.tsx`, `antrian.panel.test.tsx`); tambah `antrian.aksi.test.tsx` untuk yang belum tercakup: panggil, mulai, selesaikan, tiap dari 7 modal terbuka dari aksi yang benar, urutan query saat refresh. Tanpa mengubah `page.tsx`.
- **5.2 Data + turunan**: buat `src/lib/data/antrean.ts` (query `tiket_antrean`/`penanganan`/`absensi_petugas` dari `page.tsx:308-562,731`, kolom eksplisit; `muatAntrean(sb, param)` menjalankan utama, panel, stats, total harian dengan `Promise.all`), `_logika/turunan.ts` (`page.tsx:682-730,813-845`) + test murni.
- **5.3 Hook**: `_hook/useAntrean.ts` (profil sekali, muat, Realtime lewat `useRealtimeRefetch`, penjaga permintaan basi), `_hook/useAksiAntrean.ts` (panggil/mulai/selesai -> `Hasil`), `_hook/useModalAntrian.ts` dengan `type ModalAntrian = null | { jenis: 'ambilAlih' | 'alihkan' | 'kembalikanKeFo' | 'selesaiEskalasi' | 'koreksi' | 'wizard' | 'surveiQr'; tiket: TiketBaris }`.
- **5.4 Bagian**: `_bagian/SelNama.tsx`, `SelStatus.tsx`, `SelAksi.tsx` (dari `renderNama/Status/Aksi`, `page.tsx:846-1110`), `ModalAntrian.tsx` (7 modal dari satu union), `RekapAbsensi.tsx`, `FilterAntrian.tsx`.
- **5.5 Cangkang**: `page.tsx` merakit; cangkang `PelayananWizardModal` (`components/admin/PelayananWizardModal.tsx:724`) pindah ke `KerangkaModal` (isi wizard tidak diubah).
- Diterima: `page.tsx` <= 200 baris; refresh = satu tahap paralel (bukan 4 await berurutan); semua test antrian hijau. Review Opus + `[VISUAL]`.

### G6. `chat` (opus untuk 6.1 dan 6.3)
Test: `npx vitest run --pool=vmForks src/app/chat`.
- **6.1 Karakterisasi + mesin keadaan**: delapan berkas test `page.*.test.tsx` sudah ada; tambah `_logika/mesinChat.ts` (reducer murni: `status`, `mode`, `sesiId`, `mengetik`, `galat`) + test transisi yang diturunkan dari perilaku sekarang (bot -> eskalasi -> petugas -> selesai, luar jam, coba lagi).
- **6.2 Data**: `src/lib/data/chat-pengunjung.ts` (`chat_sesi`, RPC `chat_percakapan_saya`, `consent_log`, riwayat; pembungkus `fetch` ke `/api/chat/{ai,messages,sesi,status,petugas}` dengan batas waktu 65 dtk).
- **6.3 Hook**: `useSesiChat` (buat/mulai sesi + consent), `usePesan` (sinkron + Realtime `chat-sesi-<id>` + riwayat lama), `useKirim` (pesan, bot, foto, coba lagi, minta petugas), `useStatusLayanan` (polling 60 dtk, berhenti saat tab tersembunyi).
- **6.4 Bagian**: `LayarAwal.tsx` (FAQ + pilih layanan), `JendelaPercakapan.tsx`, `FormPesan.tsx`, `BilahAtas.tsx`.
- **6.5 Cangkang server**: `page.tsx` menjadi server component yang memuat FAQ + layanan lewat `muatFaqPublik()`/`muatLayananPublik()` (G4) dan merender `ChatKlien.tsx` (client) dengan props awal; `ChatKlien` <= 200 baris.
- Diterima: delapan test lama hijau; tidak ada query FAQ/layanan dari browser saat muat awal.

### G7. `admin/chat` (sonnet; opus mereview Realtime)
Test: `npx vitest run --pool=vmForks src/app/admin/chat/page.aksi.test.tsx src/app/admin/chat/page.riwayat.test.tsx src/app/admin/chat/page.takeover.test.tsx src/app/admin/chat/chat-session-a11y.test.ts`.
- **7.1** `src/lib/data/chat-staf.ts` (`chat_sesi`, `penanganan`, pesan, riwayat; daftar `layanan`/`petugas`/`topik` lewat `useReferensi`) + `_logika/izinChat.ts` (`page.tsx:484-508`) + test murni.
- **7.2** `_hook/useDaftarSesi.ts` (muat + channel `chat-admin`), `_hook/usePesanSesi.ts`, `_hook/useAksiChat.ts`.
- **7.3** `_bagian/PanelDaftar.tsx`, `PanelPercakapan.tsx`, `DialogChat.tsx` (union `'ambilAlih' | 'teruskan' | 'selesai'`).
- **7.4** Cangkang `page.tsx` <= 200 baris.

### G8. `admin/chat/faq` (sonnet)
Test: `npx vitest run --pool=vmForks src/app/admin/chat/faq/faq.test.tsx`.
- **8.1** `src/lib/data/faq.ts` (daftar bertahap, simpan, hapus, alih bot/aktif, pemanggil `/api/admin/faq/embed`) + `_logika/aksesFaq.ts` (`page.tsx:87-131`) + test.
- **8.2** `_hook/useFaq.ts`; `_bagian/TabelFaq.tsx` (memakai `Tabel` + `Pagination`), `FilterFaq.tsx`.
- **8.3** Cangkang `page.tsx` <= 200 baris; setelah simpan/hapus panggil `POST /api/admin/revalidasi` tag `publik-faq`.

### G9. `me/reservasi` (sonnet)
Test: `npx vitest run --pool=vmForks src/app/me/reservasi`.
- **9.1** `src/lib/data/reservasi.ts` (`kunjungan` milik sendiri, `v_layanan_publik`, `v_antrian_loket` kolom eksplisit, `hari_libur`, RPC `is_layanan_buka_jadwal`, `consent_log`) + `_logika/validasiReservasi.ts` (aturan `handleSubmit`, `page.tsx:183-309`; tanggal lewat `lib/time.ts`) + test.
- **9.2** `_hook/useReservasi.ts`, `_hook/useKetersediaan.ts`; `_bagian/FormReservasi.tsx`, `DaftarReservasi.tsx` (paginasi memakai `Pagination`).
- **9.3** Cangkang `page.tsx` <= 200 baris.

Gerbang tiap gelombang G5-G9: review Opus (batas modul dipatuhi: tanpa query di komponen, tanpa JSX di hook, tanpa I/O di `_logika`), `verify:baseline`, `[VISUAL]` alur utama oleh PM, `[PEMILIK]` push.

---

## G10. Dokumen dan pembersihan akhir

- **10.1 Hapus `.btn` global (sonnet)**: `src/styles/globals.css` (`:318-355`), `src/styles/tema-dasbor.css` (`:329-342`, `:618-631` bagian `.btn`). Syarat: anggaran `kelasBtn` = 0. `[VISUAL]`.
- **10.2 Pangkas `CLAUDE.md` (opus)**: berkas `CLAUDE.md`, buat `docs/fase/{fase-1-layanan-dinamis,fase-2-homepage,fase-3-koordinator-rekap,fase-4-pendataan,fase-5-live-chat,fase-6-cari-pengunjung,identitas,storage-r2,absensi-fo,pesan-perilaku}.md`. `CLAUDE.md` <= 150 baris: apa ini, perintah, arsitektur stabil (alur auth, lapisan data, aturan lintas-bagian, token/komponen), peta direktori (bukan daftar berkas), aturan DB/migrasi, tautan ke `docs/fase/*`. Perbaiki peta UMKM (rute lama sudah dihapus). Catatan per fase dipindah utuh, tidak ditulis ulang. Bagian Orkestrasi dan batas keras dipertahankan apa adanya.
- **10.3 README (sonnet; paralel dengan 10.2)**: `README.md`: hapus klaim usang (mis. Gemini 1.5), selaraskan perintah dan struktur dengan `CLAUDE.md`, tautkan `docs/STATUS.md`.
- **10.4 Kencangkan anggaran (sonnet)**: `src/test/anggaran-kode.json` ke angka akhir; target SPEC §10; yang belum tercapai ditulis sebagai sisa di `docs/superpowers/audits/ukur/hasil-sesudah.md`.
- **10.5 [PEMILIK] Ukur sesudah (PM)**: ulang `baseline.sql` dan pengukuran aplikasi; tulis tabel sebelum/sesudah per target SPEC §6 di `hasil-sesudah.md`; perbarui `docs/STATUS.md` dan `docs/DECISION_LOG.md`.

Review Opus G10: `CLAUDE.md` tidak kehilangan aturan wajib; tautan `docs/fase/*` benar. Gerbang akhir `verify:baseline`. `[PEMILIK]` push.

---

## Urutan menurut dampak/biaya

1. G0 (setengah hari) -> 2. G1.1, 1.2, 1.7, 1.8 (murah, langsung terasa) -> 3. G1.4, 1.5, 1.6, 1.9 (hemat kuota dan waktu rekap/UMKM) -> 4. G1.3, 1.10 -> 5. G2.1, 2.2 -> 6. G3 -> 7. G4 -> 8. G5 (paling sering dipakai staf) -> 9. G6 -> 10. G7-G9 -> 11. G10.
Bila waktu habis, G0-G2 sudah menjawab keluhan "rekap dan UMKM lambat" dan filter UMKM; G3 menjawab "UI asal-asalan"; G4-G9 menjawab "kode mudah dibaca".

## Titik persetujuan pemilik (ringkas)

| Kapan | Apa |
|---|---|
| G0.4, G10.5 | menjalankan kueri baca-saja di DB produksi (host ditampilkan) |
| Akhir G1, G3, G4, tiap G5-G9, G10 | `git push` / deploy |
| Gerbang G2 | menerapkan migrasi `202611110001`, `0002` (+ bersyarat) ke produksi |
| Sesudah G3 | (dibatalkan: tema publik tetap berbeda dari dasbor) |

## Keputusan pemilik (2026-11-11)

1. Staging: tidak ada staging; harness PGlite (`scripts/lokal-rantai/`) + test kontrak diterima sebagai pengganti untuk gerbang G2. Migrasi tetap hanya diterapkan setelah PM menampilkan host + daftar migrasi dan pemilik setuju.
2. Tema publik: HARUS berbeda dari tema dasbor. Tahap 2 token (publik mengikuti dasbor) DIBATALKAN. Dua tema tetap ada, bersumber dari satu berkas `token.css`; blok penimpaan publik tidak dihapus.
3. Filter UMKM: chip jenis berlabel "Produksi" (nilai di DB tetap "Produk"); urutan Bahan Baku, Produksi, Jasa.
4. Cache publik: boleh tertinggal sampai 60 detik (tugas 1.9 dan 4.3 jalan).
5. Layar TV: jeda polling cadangan panggilan boleh naik 5 -> 20 detik saat Realtime tersambung (tugas 1.5 jalan).
