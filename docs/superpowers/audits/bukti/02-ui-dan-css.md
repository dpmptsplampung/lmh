# Bukti 02: UI dan CSS (statis, read-only)

Tanggal 2026-11-11. Metode: Grep/Read + skrip hitung Node sementara (di luar repo). Semua path relatif ke `D:\Project\LMH\src` kecuali disebut lain. Angka hasil skrip bersifat heuristik (regex per baris, mengabaikan deklarasi `--var:` dan komentar).

## 1. Token desain (DUA lapis token, bukan satu)

Temuan penting: token tidak hanya di `styles/globals.css`. `styles/tema-dasbor.css` (diimpor `app/layout.tsx:4`) menimpa token yang sama untuk elemen dalam `[data-tema="dasbor"]` (admin `app/admin/layout.tsx:22`, `/chat` `app/chat/page.tsx:949`, `/me` `app/me/_cangkang/CangkangPengunjung.tsx:139`, `/layar`, `ProfileCompletenessGate`). Halaman publik (`/`, `/umkm/katalog`, `/gallery`, dll.) memakai nilai `globals.css`; admin memakai nilai `tema-dasbor.css`. Nama token sama, nilai beda.

| Kelompok | Token (globals.css) | Fungsi / catatan |
|---|---|---|
| Warna merek | `--color-primary-50..900` (`:10-19`, indigo #6366f1 inti) | Aksi utama, tautan. Di tema-dasbor `:26-35` diganti biru (#2563eb inti) |
| Aksen/status | `--color-accent-*` (`:22-29`), `success/warning/danger-*` (`:32-48`) | Warna semantik mentah |
| Netral | `--color-neutral-0..950` (`:51-62`) | Skala slate |
| Permukaan | `--surface-primary/secondary/elevated/overlay` (`:65-68`), `--glass-*` (`:71-76`) | Gaya kaca (blur 16px). Tema-dasbor mematikan blur (`--glass-blur: 0px`, tema-dasbor `:60`) |
| Teks/border | `--text-primary/secondary/tertiary/inverse/link` (`:79-83`), `--border-default/hover/focus` (`:86-88`) | |
| Font | `--font-sans/display/mono` (`:91-93`) | Inter + Plus Jakarta Sans |
| Ukuran teks | `--text-xs..5xl` (`:97-105`) | Tema-dasbor menambah `--fs-page-title/card-title/kpi/table-head/body/small` (`:134-139`) |
| Spasi | `--space-1..24` (`:108-119`, 4px grid) | Dipakai paling banyak (`--space-3` 316x, `--space-4` 309x, `--space-2` 290x di *.module.css) |
| Radius | `--radius-sm..2xl,full` (`:122-127`) | Tema-dasbor: sm 6/md 8/lg 12/xl=card 16/2xl=panel 20 (`:104-112`) |
| Bayangan | `--shadow-xs..2xl, glow` (`:130-137`) | Tema-dasbor memetakan ke `--shadow-card/-hover/-panel/-overlay` (`:115-126`) |
| Transisi | `--transition-fast/base/slow/spring` (`:140-143`) | |
| Z-index | `--z-dropdown 1000, sticky 1100, modal 1200, overlay 1300, toast 1400` (`:146-150`) | Hanya 11 pemakaian `var(--z-*)` di seluruh src (lihat 2) |
| Layout | `--sidebar-width 280px`, `--header-height 64px`, `--max-content-width 1280px` (`:153-155`) | Tema-dasbor: `--sidebar-width` kalkulasi, `--appbar-height 56px`, `--content-max 1440px`, `--pad-page 24px`, `--gap-grid 20px`, `--pad-card`, `--target 40px`, `--target-sentuh 44px` (`:142-152`) |
| Khusus dasbor | `--bg-canvas/surface/surface-muted/surface-hover`, `--border-subtle`, `--status-{success,warning,danger,info,neutral}-{fg,bg,border}`, `--nav-*`, `--chart-1..6`, `--focus-ring` (tema-dasbor `:38-165`) | Token semantik status/grafik hanya ada di tema-dasbor |
| Breakpoint | Tidak ada token (CSS tidak mendukung var di `@media`). `globals.css` memakai 1024/768/480 (`:921,935,977`); `tema-dasbor.css` 1024/640/768(pointer) (`:168,175,618`) | |

Token dipakai di luar tempat definisi: `--border-subtle`, `--bg-surface`, `--fs-body`, `--pad-page`, `--focus-ring`, `--gap-grid` sering dipakai di CSS Module (98x, 97x, 94x, 83x, 59x, 44x) tetapi TIDAK didefinisikan di `globals.css`; hanya di `tema-dasbor.css` dan, untuk katalog UMKM publik, didefinisikan ulang lokal (`components/umkm-katalog/katalog.module.css:4-8`, `kerangka.module.css:8-13`). Konsekuensi: komponen yang memakainya di luar `data-tema` jatuh ke nilai cadangan atau kosong.

## 2. Penyimpangan dari token

Total (135 file `*.module.css`, di luar deklarasi `--x:`): hex literal 150, `rgb(a)()` literal 72, `px` pada padding/margin/gap (selain 0/1px) 524, `px` pada border-radius 58, `font-size` literal (bukan var) 47, `z-index` literal (bukan var) 28. Inline `style={{` 242 kemunculan di 39 file `.tsx`. Hex di string TSX: 17 (gallery 5, IkonGoogle 4, login 4, QRCode 2).

15 file terburuk (jumlah pelanggaran = hex + rgb + px spasi + px radius + font-size + z-index literal):

| # | File | Total | hex | rgb | px spasi | px radius | font-size | z |
|---|---|---|---|---|---|---|---|---|
| 1 | app/gallery/gallery.module.css | 74 | 30 | 34 | 2 | 0 | 5 | 3 |
| 2 | components/layout/Sidebar.module.css | 57 | 19 | 4 | 20 | 7 | 4 | 3 |
| 3 | components/layout/AppBar.module.css | 50 | 26 | 0 | 14 | 5 | 4 | 1 |
| 4 | components/layout/PerintahCepat.module.css | 44 | 17 | 3 | 15 | 3 | 5 | 1 |
| 5 | components/layout/WidgetSidebar.module.css | 40 | 12 | 3 | 13 | 5 | 7 | 0 |
| 6 | app/layar/[token]/layar-token.module.css | 35 | 0 | 0 | 27 | 2 | 6 | 0 |
| 7 | app/me/reservasi/reservasi.module.css | 33 | 0 | 0 | 31 | 2 | 0 | 0 |
| 8 | app/admin/petugas/petugas.module.css | 31 | 0 | 0 | 31 | 0 | 0 | 0 |
| 9 | components/layout/KartuIdentitas.module.css | 31 | 14 | 1 | 8 | 4 | 3 | 1 |
| 10 | app/transparansi/transparansi.module.css | 29 | 21 | 1 | 0 | 7 | 0 | 0 |
| 11 | app/me/me.module.css | 25 | 0 | 0 | 24 | 1 | 0 | 0 |
| 12 | app/chat/chat.module.css | 24 | 0 | 0 | 20 | 3 | 0 | 1 |
| 13 | components/profile-gate.module.css | 23 | 0 | 0 | 18 | 2 | 1 | 2 |
| 14 | components/ui/KerangkaModal.module.css | 16 | 0 | 0 | 15 | 0 | 0 | 1 |
| 15 | components/umkm-katalog/publik.module.css | 16 | 0 | 0 | 13 | 0 | 3 | 0 |

Catatan: `KerangkaModal.module.css` (komponen "token-only" menurut `components/ui/README.md`) tetap punya 15 px spasi literal. File layout (`components/layout/*`) hex-nya besar karena warna navigasi gelap. `app/layar/[token]` (layar TV) px literal wajar untuk skala TV tetapi tidak berskala.

Inline style terbanyak: `app/pengaduan/lacak/page.tsx` 36, `app/gallery/page.tsx` 34, `app/kebijakan-privasi/page.tsx` 33, `app/pengaduan/page.tsx` 24, `app/peta-potensi/page.tsx` 21, `app/saran/page.tsx` 19, `app/standar-pelayanan/page.tsx` 15; di komponen: `components/admin/FormDialog.tsx` 8 (overlay dialog inline, `:48-54`, `zIndex: 1000`), `components/Pagination.tsx` 3.

Z-index literal: nilai 1000 di 6 modul CSS (`gallery.module.css:309`, `FoDialog.module.css:4`, `PelayananWizardModal.module.css:5`, `Homepage.module.css:143`, `KerangkaModal.module.css:4`, inline `FormDialog.tsx:53`) padahal token `--z-modal` = 1200; `profile-gate.module.css:6` z-index 99999. Literal lain: 1,2,3,10,20,30,50,90,99,100,140,150,300,1100.

Breakpoint `@media` (hitungan di 135 file module; semua `max-width` kecuali tertulis):

| Query | Frekuensi |
|---|---|
| max-width: 640px | 42 |
| pointer: coarse | 29 (+1 gabungan dengan max-width 640) |
| prefers-reduced-motion | 23 |
| max-width: 480px | 12 |
| max-width: 1024px | 10 |
| max-width: 768px | 6 |
| min-width: 1200px | 4 |
| max-width: 720px | 4 (+1 `screen and`) |
| print | 3 |
| max-width: 767px | 3 |
| min-width: 400px | 3 |
| max-width 900 / min-width 1024 / max-width 560 | 2 / 2 / 2 |
| 1 kali: 1100(max), 1100(min), 1280(min), 1023, 639, 359, 520(min), 640(min), forced-colors, `min 1025 + max-height 759` | 1 tiap |

Rentang "lebar HP" tercatat dengan 8 angka berbeda (359, 400, 480, 520, 560, 639, 640, 720, 767, 768). Pasangan 767/768 dan 639/640 menyebabkan celah 1px antar file. Tema-dasbor memakai 768 untuk target sentuh tetapi 640 untuk grid (`tema-dasbor.css:175,618`).

## 3. Pola UI diduplikasi

Komponen bersama ada di `components/ui/` (README `components/ui/README.md`). Pemakaian (jumlah file non-test yang mengimpor): Tombol 94, Field 48, Kartu 41, Skeleton 40, Galat 40, Lencana 37, CatatanKeadaan 30, StatusKosong 28, Tabel 18, KartuStatistik 13, Dialog 11, PemilihRentang 7, PemilihTanggal 5, Tab 4, PanelSamping 1, MenuTitikTiga 0 (tak terpakai). Lainnya: Toast 34 (via `useToast`), Pagination 11, ErrorRetry 6.

| Pola | Jumlah implementasi | Lokasi (file:baris) | Perbedaan nyata |
|---|---|---|---|
| Modal/dialog | 6 implementasi cangkang + 4 hand-rolled | (a) `components/ui/KerangkaModal.tsx:78` (+`Dialog.tsx`, `PanelSamping.tsx`) pakai `useDialogFokus`; dipakai 11 file via Dialog. (b) `components/admin/FormDialog.tsx:49` pakai `useDialogFokus` tapi overlay dengan inline style + `zIndex:1000` (`:53`); 7 pemakai. (c) `components/admin/FoDialog.tsx:37` pakai hook BERBEDA `useDialogA11y` (`lib/hooks/useDialogA11y.ts:34`) + `FoDialog.module.css`; 4 pemakai. (d) `components/admin/PelayananWizardModal.tsx:724` cangkang sendiri + `alertdialog` `:988`. (e) `components/homepage/LayananPopup.tsx:56`. (f) `components/layout/PerintahCepat.tsx:185`. Hand-rolled tanpa hook bersama: `app/gallery/page.tsx:356,461` (Escape manual `:121,132`, fokus kembali manual, TANPA jebak fokus), `components/ProfileCompletenessGate.tsx:411` (tanpa Escape dan jebak fokus; sebagian disengaja karena blocking), `app/admin/settings/jadwal/page.tsx:590` (`role="alertdialog"` tanpa `aria-modal`, tanpa Escape, tanpa jebak fokus; hanya `.focus()` ke tombol batal `:399`) | Tiga hook/mekanisme fokus berbeda; z-index 1000 (4 file) vs token; satu memakai inline style. Konfirmasi hapus: 3 halaman masih `window.confirm` (`app/admin/dokumen/page.tsx:128`, `app/admin/gallery/page.tsx:130`, `app/admin/layar/page.tsx:254`) padahal ada pengganti `HapusFaqDialog`/`FoTolakReservasiDialog` |
| Tabel data | 1 komponen + 14 `<table>` mentah | Komponen: `components/ui/Tabel.tsx` (18 halaman). Mentah: `app/admin/fo/penanganan/page.tsx`, `app/admin/layanan/page.tsx`, `app/admin/layar/page.tsx`, `app/admin/pesan-perilaku/cetak/page.tsx`, `app/admin/rekap/TabelDataPelayanan.tsx`, `app/admin/topik/page.tsx`, `components/admin/layanan/PendataanKhususEditor.tsx`, `components/admin/survei/PanelIkmGlobal.tsx`, `PanelSpakGlobal.tsx`, `components/admin/umkm-laporan/LaporanUmkm.tsx`, `components/IkmPanel.tsx` dll. | `Tabel` wajib `caption` + mode kartu HP; yang mentah mengatur sendiri. `TabelDataPelayanan.tsx:81` memakai `<tr onClick>` (klik baris, bukan tombol/keyboard) |
| Field form | 1 komponen + banyak `<label>` | `components/ui/Field.tsx` (48 file) vs 49 file memakai `<label`; 294 kontrol `<input/select/textarea>`. Kelas global `.form-input/.form-select` (globals) masih dipakai bersamaan | Galat form punya kelas berbeda: `.galat` (21), `.galatServer` (4), `.error` (4), `.galatBaris`, `.galatPesan`, `.galatForm`, `.galatField`, `.errorBox` di *.module.css; komponen `Galat` (40 file) vs `ErrorRetry` (6) |
| Tombol | 1 komponen + kelas global | `components/ui/Tombol.tsx` (94 file, `<Tombol>`) vs kelas global `.btn/.btn--primary/.btn--sm` (`globals.css:318-355`, dipakai 33 file `.tsx`, ~79 kemunculan) vs 63 file dengan `<button` mentah | Dua sistem tombol; tema-dasbor menimpa `.btn` agar mirip Tombol (`tema-dasbor.css:329-342`). Tinggi `Tombol` 36px, kecil 32px, 44/40px di `pointer: coarse` (`Tombol.module.css:7,39,111-116`); `.btn--sm` 32px (`tema-dasbor.css:334`) |
| Badge/status | 1 komponen + CSS lokal | `components/ui/Lencana.tsx` (37 file) vs `.badge/.chip/.pill` lokal di `EstimasiAntrean.module.css`, `Homepage.module.css`, `Sidebar.module.css`, `publik.module.css`; `components/admin/SurveiStatusBadge.tsx` komponen terpisah | Token `--status-*-fg/bg/border` hanya ada di tema-dasbor; publik tidak punya |
| Empty state | 1 komponen + hand-rolled | `StatusKosong` (28 file). Kelas `.empty/.kosong` lokal di 9 file CSS; contoh `app/admin/antrian/PanelSekarang.tsx`, `app/admin/chat/faq/page.tsx`, `app/admin/pesan-perilaku/cetak/page.tsx`, `app/admin/rekap/TabelDataPelayanan.tsx`, `components/EstimasiAntrean.tsx`, `components/homepage/DaftarLayanan.tsx`, `components/layout/PerintahCepat.tsx` | Teks dan ikon berbeda per halaman |
| Skeleton/loading | 1 komponen + hand-rolled | `Skeleton` (40 file; `Skeleton.module.css`). Hand-rolled: keyframes `shimmer/pulse/skeleton` di `styles/globals.css` dan `app/layar/[token]/layar-token.module.css`; kelas skeleton di `app/chat/page.tsx`, `app/gallery/page.tsx`, `app/loading.tsx`, `app/login/page.tsx`, `app/transparansi/page.tsx`, `components/layout/AdminGuard.tsx`, dll. | `app/admin/rekap/page.tsx:270` dan `absensi/page.tsx` loading berupa teks "Memuat…"/state boolean, bukan Skeleton |
| Paginasi | 1 komponen + 3 hand-rolled | `components/Pagination.tsx` (11 halaman admin). Hand-rolled prev/next: `app/gallery/page.tsx` (viewer halaman dokumen), `app/me/reservasi/page.tsx`, `app/admin/fo/kotak-masuk/page.tsx` | |
| Toast/konfirmasi | 1 sistem | `components/Toast.tsx` (`useToast`, `DURASI_TOAST_MS` 4000 `:30`), 34 pemakai; konfirmasi = 3 `window.confirm` di atas | Seragam kecuali `confirm()` |
| Filter/tab | 1 komponen + 2 `role="tablist"` sendiri | `components/ui/Tab.tsx` hanya 4 halaman (`antrian`, `pengaduan`, `pesan-perilaku`, `rekap`). Tablist sendiri: `components/fo/RegistrasiPengunjung.tsx:95`, `components/umkm-form/PemilihFoto.tsx:106`. Filter chip/select dibuat sendiri tiap halaman (`investasi-leads` memakai `<select>` + `aria-label` `page.tsx:159-165`, `rekap` memakai `<select>` dalam Field, katalog UMKM memakai chip `aria-pressed` `Katalog.tsx:111-116`) | Tiga idiom filter berbeda |

## 4. Filter UMKM

Catatan: rute `/umkm` murni hanya `app/umkm/katalog/` (`page.tsx`, `layout.tsx`, `[id]/page.tsx`); `/admin/umkm` TIDAK ADA lagi (admin = `app/admin/umkm-tugas`, `umkm-pengawasan`, `umkm-laporan`, tiap `page.tsx` hanya 5 baris pembungkus komponen di `components/admin/umkm-*`). Admin tidak punya filter kategori; yang relevan: `components/admin/umkm-laporan/LaporanUmkm.tsx:157-162` (hanya menampilkan kategori tanpa hasil, bukan filter).

Cara kerja sekarang di `components/umkm-katalog/Katalog.tsx`:
- Daftar pilihan dimuat saat mount dari `GET /api/umkm-katalog/filter` (`:60-66`) -> RPC `umkm_filter_katalog()` (`supabase/migrations/202611090002_umkm_katalog.sql:154-166`) yang mengembalikan `DISTINCT jenis`, `DISTINCT kategori`, `DISTINCT kabupaten_kota` dari profil berstatus `terbit` (maks 200 tiap daftar, flag `terpotong`). Tiga daftar itu INDEPENDEN, tidak ada relasi jenis -> kategori.
- State `filters = {jenis, kategori, spesifik, kabupaten_kota}` semua awal `''` (`:15,21`). Setiap perubahan memicu muat ulang (`:77-79`, `load` bergantung `filters`).
- Tampilan: (1) baris chip kategori di bawah kotak cari, selalu langsung tampil semua kategori dari DB, chip pertama "Semua kategori" `aria-pressed` (`:111-117`). (2) Panel "Saring hasil": tiga `<select>` Jenis usaha / Kategori / Kabupaten-kota, opsi pertama "Semua", ditambah input teks "Spesifik" (`:129-142`). Jadi kategori tampil dari awal di DUA tempat (chip dan select), tanpa urutan; pengguna bisa memilih kategori tanpa memilih jenis, dan mengubah jenis TIDAK mereset kategori (`filter()` hanya set satu key, `:77-79`), sehingga kombinasi jenis+kategori tidak konsisten mungkin (hasil nol).
- Server: `app/api/umkm-katalog/route.ts:7-10` meneruskan `p_jenis`, `p_kategori` independen ke `umkm_cari_katalog`.

Data jenis -> kategori SUDAH ada: `lib/umkm-katalog/taksonomi.ts:3` `JENIS_USAHA = ['Produk','Bahan Baku','Jasa']`, `:6-23` `KATEGORI_PER_JENIS` (Produk 11, Bahan Baku 10, Jasa 10 kategori), `:25` `kategoriSah(jenis, kategori)`. Ini dipakai hanya di formulir pemilik: `components/umkm-form/BagianUsaha.tsx:20-37` (kategori `disabled` dan "Pilih jenis dulu" sampai jenis dipilih; `key={jenis}` mereset pilihan) dan validasi `lib/umkm-katalog/schemas.ts:69`. File taksonomi menyatakan daftar sama disalin ke SQL migrasi `202611100001` (komentar `:1-2`).

Kesenjangan terhadap perilaku yang diinginkan (kategori kosong sampai jenis dipilih):
1. `Katalog.tsx` tidak mengimpor `taksonomi.ts`; kategori berasal dari DB (kategori yang punya profil terbit), bukan dari pemetaan jenis.
2. Chip kategori (`:111`) dan select kategori (`:132-137`) tampil tanpa syarat jenis; tidak ada kondisi `filters.jenis`.
3. Tidak ada logika "ganti jenis -> reset kategori" (`filter()` `:77-79`).
4. Label: taksonomi memakai "Produk" (bukan "produksi"); urutan konstanta Produk, Bahan Baku, Jasa (permintaan pengguna: bahan baku / produksi / jasa).
5. Daftar opsi dari `umkm_filter_katalog` tidak tahu relasi, sehingga relevansi harus ditentukan dari `KATEGORI_PER_JENIS` (dan sebaiknya disaring dengan kategori yang memang ada di DB agar tidak muncul chip tanpa hasil).
6. Pengujian ada di `components/umkm-katalog/Katalog.test.tsx` (perlu dicek bila perilaku diubah).

## 5. Aksesibilitas cepat (statis)

Hanya temuan berbukti.

| Cek | Hasil |
|---|---|
| Elemen klik non-button | 2 kemunculan `onClick` pada non-interaktif: `app/admin/rekap/TabelDataPelayanan.tsx:81` (`<tr onClick>` tanpa role/tabIndex/keyboard dalam baris ini; perlu verifikasi apakah ada tombol pengganti di dalam baris), `app/me/_cangkang/CangkangPengunjung.tsx:150` (overlay `aria-hidden`, wajar). Tidak ada `role="button"` di mana pun. |
| Gambar tanpa alt | Tidak ada. 5 `<img>`: `gallery/page.tsx:418` (alt ada), `AbsensiWizardModal.tsx:339,384` (alt ada), `GambarLampiran.tsx:13` (alt ada), `FotoUmkm.tsx:44` (alt prop). `alt=""` dekoratif 6 kali. 12 file memakai `next/image`. |
| Input tanpa label | Heuristik multi-baris mendeteksi 22 kandidat, tetapi pemeriksaan manual 4 sampel (`investasi-leads/page.tsx:160,175` ada `aria-label`; `AkunForm.tsx:111`, `KoreksiPelayananModal.tsx:198`, `TanggapanPengaduan.tsx:128` dibungkus `Field`) semua terlabel. Tidak ada temuan terbukti; sisa kandidat (`SuntingInline.tsx:226,247`, `jadwal/page.tsx:290`, `TamuForm.tsx`, `WalkinPanel.tsx`) butuh baca manual. |
| Modal tanpa semantik/fokus | Terbukti: `app/admin/settings/jadwal/page.tsx:590` `alertdialog` tanpa `aria-modal`, Escape, jebak fokus; `app/gallery/page.tsx:356,461` dialog dengan Escape tapi tanpa jebak fokus (tidak ada Tab handler, `useDialog*`); `components/ProfileCompletenessGate.tsx:411` tanpa Escape/jebak fokus; `components/layout/PerintahCepat.tsx:185` memiliki handler Tab/Escape sendiri (`:172-176`). `FoDialog.tsx:36-38` lengkap lewat `useDialogA11y`. |
| `outline: none/0` | 77 kemunculan di CSS (perlu diperiksa apakah ada pengganti `:focus-visible`/`--focus-ring`; tidak diperiksa satu per satu). |
| Target sentuh < 44px | `Tombol` 36px (kecil 32px) di pointer halus, naik ke 44/40px di `pointer: coarse` (`Tombol.module.css:7,39,106-116`); `.btn--sm` 32px (`tema-dasbor.css:334`) dan di coarse/<=768 menjadi `--target-sentuh` 44px (`:618-631`). `Field` input 40px, 44px di coarse (`Field.module.css:20,75`). `--target` default 40px (`tema-dasbor.css:145`). Kecil 40px di coarse belum 44px. |

Kontras (rumus WCAG, nilai token dari `tema-dasbor.css`/`globals.css`):

| Pasangan | Rasio | Lulus AA teks normal (4,5) |
|---|---|---|
| `--text-primary` #0f172a di `--bg-canvas` #eceff4 | 15,49 | ya |
| `--text-secondary` #475569 di surface #fff / canvas #eceff4 | 7,58 / 6,57 | ya |
| `--text-tertiary` #64748b di surface #fff | 4,76 | ya |
| `--text-tertiary` #64748b di canvas #eceff4 | 4,13 | TIDAK |
| `--text-tertiary` #64748b di `--bg-surface-muted` #f5f7fa | 4,43 | TIDAK (tipis) |
| `--text-link` #1d4ed8 di canvas | 5,81 | ya |
| putih di primary-600 #2563eb (tombol) | 5,17 | ya |
| `--status-warning-fg` #b45309 di #fffbeb | 4,84 | ya |
| globals publik: tertiary #64748b di kaca putih 62% atas #eef1fb (~#f4f6fc) | ~4,40 | TIDAK (estimasi) |
| putih di accent-500 #f59e0b | 2,15 | TIDAK (jika dipakai sebagai latar tombol, tidak dicek pemakaiannya) |
| neutral-400 #94a3b8 di putih (jika dipakai placeholder/teks) | 2,56 | TIDAK (pemakaian tidak dicek) |

Catatan: tema-dasbor sudah mengangkat `--text-link` ke 700 karena 600 hanya 4,48:1 (komentar `tema-dasbor.css:53`). `--text-tertiary` di kanvas abu 4,13:1 tidak ditangani.

## 6. Konsistensi halaman admin

Semua memakai `PageHeader` (`components/layout/PageHeader.tsx`, satu `<h1>` per halaman; header padding `var(--pad-page)` `PageHeader.module.css:6`). Pembungkus isi dan state berbeda:

| Halaman | LOC | Pembungkus isi | Loading | Empty | Error | Catatan |
|---|---|---|---|---|---|---|
| kunjungan (`page.tsx` 597) | `.halaman` pad `0 pad-page pad-page`, `max-width: var(--content-max)` | `Suspense` fallback `KunjunganMemuat` (`:105-114`) judul + teks "Memuat daftar kunjungan…"; skeleton saat muat awal (`:134`) | StatusKosong | Galat/ErrorRetry | |
| antrian (1375) | `.halaman` sama (`antrian.module.css:2`) | Suspense + `Skeleton kartu` (`:184-189`) | StatusKosong | Galat | Halaman terbesar; header memakai 2 `<PageHeader>` (varian loading dan utama) |
| absensi (526) | `.halaman` sama | state boolean `loading`, tidak ada `Skeleton` | StatusKosong | Galat | |
| umkm (tugas/pengawasan/laporan) | tidak ada `/admin/umkm`; 3 halaman 5-baris | di komponen `components/admin/umkm-*` | `CatatanKeadaan` (`LaporanUmkm.tsx:88`) | | `CatatanKeadaan` menunggu-migrasi | Pola state beda dari 7 halaman lain |
| rekap (436) | `.wadah` (`rekap.module.css:2`), tanpa `padding` horizontal di aturan ini, `width:100%` | teks "Memuat…" via `pesanKosong` (`:270`), tanpa Skeleton | tidak memakai StatusKosong (pesan kosong string ke Tabel) | Galat | Satu-satunya yang memakai nama `.wadah`; tabel `Tabel` + `TabelDataPelayanan` `<table>` mentah |
| petugas (622) | `.isi` (`petugas.module.css:1`, `:310` pad `0 pad-page pad-page`) | `Skeleton kartu` dalam `role=status` (`:377-379`) | StatusKosong | satu Galat | Nama kelas `.isi` |
| layanan (398) | `page.dasbor.module.css` `.area1` + `KelolaLayanan.module.css` (dua modul, `page.tsx:13,26`); 2 `<table>` mentah | Skeleton | StatusKosong | satu | `layanan.test.tsx`; satu-satunya yang pakai dua modul CSS dan nama berkas `page.dasbor.module.css` |
| pengaduan (373) | `.halaman` (`pengaduan.module.css:1`) hanya `min-width:0` (tanpa padding/gap) | Suspense + Skeleton baris | StatusKosong | Galat | Padding halaman diatur di tempat lain, berbeda dari kunjungan/antrian/absensi |

Ketidakkonsistenan konkret: (1) nama pembungkus `.halaman` / `.wadah` / `.isi` / `.area1` / `.container` (investasi-leads, profil) dengan aturan padding/gap yang disalin per halaman (3 halaman identik; `pengaduan` hanya `min-width:0`); (2) `rekap` tanpa Skeleton dan tanpa StatusKosong; (3) `absensi` tanpa Skeleton; (4) `layanan`, `rekap` memakai `<table>` mentah berdampingan dengan `Tabel`; (5) `window.confirm` di `dokumen`, `gallery`, `layar` admin; (6) `admin.module.css:26` `.adminBody` padding `var(--space-8)` di atas padding halaman `--pad-page` (sehingga dua lapis padding bila halaman juga menambah `pad-page`; pada <=1024px `.adminBody` jadi `--space-4`, `:35`); (7) loading kunjungan menampilkan judul sementara via `PageHeader` kedua, pola yang tidak dipakai pengaduan (fallback hanya Skeleton).

## 7. Pola client-side boros

| Temuan | Bukti |
|---|---|
| exceljs terbawa ke bundel klien | `app/admin/rekap/page.tsx:1` `'use client'`, `:30` `import { DEFINISI_DILAYANI } from '@/lib/rekap/excelTerpadu'`; `lib/rekap/excelTerpadu.ts:3` `import ExcelJS from 'exceljs'` (statis, top-level). Konstanta kecil menarik exceljs (~ratusan KB) ke halaman rekap. Pola benar: pisahkan konstanta ke modul tanpa exceljs. |
| Font dimuat ganda | `app/layout.tsx:2,11,16` memakai `next/font/google` (Inter, Plus Jakarta Sans) DAN `styles/globals.css:5` `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300..800&family=Plus+Jakarta+Sans...')` (blocking, render-blocking CSS import dari origin eksternal; juga butuh CSP font-src/style-src). |
| Recharts statis di klien, tanpa `next/dynamic` | 9 file (`components/ui/grafik/{GrafikBatang,GrafikDonat,GrafikGaris,Sparkline}.tsx`, `IkmPanel.tsx`, `admin/survei/{PanelIkmGlobal,PanelSpakGlobal,TrenGrafik}.tsx`); dipakai `app/transparansi/page.tsx`, `app/admin/pesan-perilaku/page.tsx`, `app/admin/page.tsx` dkk. Tidak ada satu pun `next/dynamic`/`React.lazy` di seluruh src (grep nol hasil). |
| `qrcode` di klien | `components/QRCode.tsx:4` import statis. `html5-qrcode` sudah dynamic-import (`lib/hooks/useKameraPemindai.ts:126`, baik). |
| `lucide-react` di 127 file | Import bernama (tree-shake normal); tidak terbukti masalah. |
| Halaman `'use client'` besar | 46 dari 64 `page.tsx` bertanda `'use client'`; terbesar: `admin/antrian` 1375 baris, `chat` 1353, `admin/chat` 861, `admin/chat/faq` 792, `me/reservasi` 723, `admin/settings/jadwal` 633, `admin/petugas` 622, `gallery` 600, `admin/kunjungan` 597. Halaman statis tetap client: `app/kebijakan-privasi/page.tsx` (33 inline style), `app/standar-pelayanan/page.tsx` dkk. perlu diverifikasi apakah `'use client'` diperlukan (belum diperiksa satu per satu). Pola arsitektur memang "client page + query Supabase langsung" (CLAUDE.md). |
| `@chatscope/chat-ui-kit-react` | dipakai `app/chat/page.tsx` dan `app/admin/chat/page.tsx` (client, statis). |
| `<img>` biasa | `FotoUmkm.tsx:18` sengaja (komentar: tanpa optimizer, `referrerPolicy`, lazy, width/height diteruskan); `gallery/page.tsx:417` mengabaikan eslint `no-img-element` (gambar PNG ber-watermark dari API, tanpa width/height atribut; inline style); `GambarLampiran.tsx:13` tanpa width/height (risiko layout shift). |

## Yang butuh pengamatan visual/runtime

- Tampilan HP (<=640px) halaman admin: padding dua lapis (`adminBody` + `--pad-page`), tabel `kartuDiHp`, header `PageHeader` yang menggulir aksi horizontal.
- Apakah `rekap` (`.wadah` tanpa padding eksplisit) terlihat rata dengan halaman lain; apakah `layanan` (`page.dasbor.module.css`) sejajar.
- Rendering kontras nyata untuk `--text-tertiary` di kanvas abu (4,13:1) dan kaca halaman publik (estimasi 4,4:1).
- Perilaku jebak fokus/Escape pada modal gallery, jadwal (alertdialog), `ProfileCompletenessGate`, `PerintahCepat` (butuh uji keyboard).
- Urutan tumpukan z-index (modal 1000 vs toast 1400 vs sidebar/appbar fixed vs gate 99999).
- Apakah kategori UMKM chip + select terlihat ganda di layar kecil, dan apakah panel Filter tertutup/terbuka default pada HP (`Katalog.tsx:123-129`).
- Ukuran bundel sebenarnya (exceljs di rute rekap, recharts per rute) lewat `next build` analyzer; tidak dijalankan sesuai aturan.
- FOUT/FOIT akibat dobel font dan dampak `@import` pada LCP.
- Outline fokus: dari 77 `outline: none/0`, mana yang tanpa pengganti `:focus-visible`.
- Target sentuh nyata (ukuran terukur) untuk tombol ikon, chip kategori, dan kontrol Sidebar/AppBar.
