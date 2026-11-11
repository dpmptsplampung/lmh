# Refaktor arsitektur dan UI LMH: rancangan

Tanggal: 2026-11-11. Status: menunggu persetujuan pemilik. Rencana pelaksanaan: `docs/superpowers/plans/2026-11-11-refaktor-arsitektur-ui.md`.
Dasar bukti: `docs/superpowers/audits/bukti/01-struktur-dan-query.md` (disebut B1) dan `02-ui-dan-css.md` (B2). Rujukan `B1 §4A` berarti bagian 4A di berkas itu.
Batas tetap: Vercel Hobby + Supabase free + Cloudflare R2; satu pengembang (TypeScript); migrasi baseline immutable; WIB lewat `src/lib/time.ts`; PII lewat `lib/pii.ts`/`lib/csv.ts`; CSP di `next.config.ts`.

## 1. Masalah (berbasis bukti)

| # | Masalah | Bukti |
|---|---|---|
| M1 | Dua lapis token bernama sama bernilai beda (`globals.css` vs `tema-dasbor.css`); 6 token semantik yang dipakai 44-98x tidak terdefinisi di luar `[data-tema="dasbor"]`, sampai katalog UMKM mendefinisikan ulang secara lokal | B2 §1 |
| M2 | 150 hex + 72 rgb literal, 28 z-index literal (modal 1000 padahal token 1200; gate 99999), 10 angka berbeda untuk "lebar HP", celah 1px 639/640 dan 767/768 | B2 §2 |
| M3 | 6 cangkang modal + 4 buatan tangan, 3 mekanisme fokus; 3 `window.confirm`; dua sistem tombol (`Tombol` 94 berkas vs `.btn` 33 berkas); 14 `<table>` mentah di samping `Tabel`; 5 nama pembungkus halaman admin dengan padding berbeda | B2 §3, §6 |
| M4 | Filter katalog UMKM: kategori tampil di dua tempat sejak awal, jenis tidak membatasi kategori, ganti jenis tidak mereset kategori; pemetaan jenis ke kategori sudah ada tetapi tidak dipakai | B2 §4 |
| M5 | Rekap: satu muat tab Data = 4-7 round-trip DB berurutan + 1 Auth; `rekap_pelayanan_inti` (plpgsql, dimaterialisasi) dihitung ~3x; ekspor sampai 50 RPC berurutan tanpa `maxDuration`; Performa menarik sampai 50.000 baris ke Node | B1 §4A |
| M6 | UMKM: CTE `cocok` menghitung semua profil terbit tiap panggilan; `ILIKE '%q%'` lintas 5 kolom, 3 tanpa indeks trigram; `catatTanpaHasil` di jalur respons; hanya permintaan tanpa filter yang ter-cache; header `private, no-store` | B1 §4B |
| M7 | Polling berlapis: sidebar (`useNavBadges`, ~8 count per 30 dtk) + halaman (30 dtk) + channel Realtime ganda pada tabel sama; layar TV ~16 request/menit; polling tetap jalan saat Realtime tersambung dan saat tab tersembunyi | B1 §5 |
| M8 | Bundel klien: konstanta `DEFINISI_DILAYANI` menarik `exceljs` ke halaman rekap; recharts statis di 9 berkas; tidak ada `next/dynamic` sama sekali; font dimuat ganda (`next/font` + `@import` Google Fonts yang memblok render) | B2 §7 |
| M9 | 46 dari 64 `page.tsx` client; 5 halaman 720-1375 baris dengan 19-35 `useState`; daftar referensi (`layanan`, `petugas`, `topik_penanganan`) dimuat ulang di >= 6 halaman; `fetchData` antrean = 4 await berurutan tiap refresh | B1 §1-§3 |
| M10 | Halaman publik semi-statis (beranda, transparansi, FAQ chat) mengambil data dari browser; hanya katalog UMKM memakai cache server | B1 §3.5 |

## 2. Prinsip keputusan

1. Free tier dulu: query langsung browser ke Supabase (RLS) tidak memakan invocation Vercel; jangan dipindah ke server tanpa alasan. Yang dipindah ke server hanya data publik yang bisa di-cache bersama.
2. Kerja berat tetap di Postgres; perbaiki bentuk query sebelum menambah infrastruktur.
3. Tanpa dependensi baru kecuali terbukti perlu. Tanpa penulisan ulang besar: tiap langkah kecil, bisa dibalik, dijaga test.
4. Setiap aturan baru dijaga test "anggaran" (hanya boleh turun), bukan oleh ingatan.
5. Ukur sebelum dan sesudah; keputusan bersyarat memakai ambang angka yang tertulis di sini.

## 3. Token desain: satu sumber

**Keputusan**
- Berkas kanonik baru `src/styles/token.css`, diimpor paling awal di `app/layout.tsx`. Isinya SEMUA custom property: primitif (`--color-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--z-*`, `--transition-*`, `--text-*`) dan semantik (`--bg-canvas/surface/surface-muted/surface-hover`, `--border-subtle`, `--status-*-{fg,bg,border}`, `--fs-*`, `--pad-page`, `--pad-card`, `--gap-grid`, `--target`, `--target-sentuh`, `--focus-ring`, `--chart-1..6`, `--nav-*`, `--content-max`, `--appbar-height`).
- `globals.css` dan `tema-dasbor.css` tidak lagi mendefinisikan token; hanya aturan elemen/komponen. Blok `[data-tema="dasbor"]` pindah ke `token.css` sebagai satu-satunya tempat penimpaan.
- Tahap 1 (tanpa perubahan visual): nilai per lingkup dipertahankan persis; token semantik yang selama ini hanya ada di dasbor diberi nilai `:root` (nilai publik yang setara) supaya tidak pernah kosong; definisi lokal di `katalog.module.css` dan `kerangka.module.css` dihapus.
- Tahap 2 DIBATALKAN pemilik 2026-11-11 (tema publik harus tetap berbeda dari dasbor; dua tema dari satu berkas token). Teks asli: (perubahan visual, perlu persetujuan pemilik): halaman publik mengikuti nilai dasbor (biru #2563eb, tanpa blur kaca), lalu blok penimpaan dihapus sehingga benar-benar satu nilai. Arah kanonik = tema dasbor karena lebih baru, punya token status/grafik, dan kontrasnya sudah diperbaiki.
- Kontras: `--text-tertiary` di kanvas abu 4,13:1 (gagal AA). Ganti ke nilai yang lulus >= 4,5:1 di kanvas, surface, dan surface-muted (calon #5c6b82, perkiraan 4,69:1 di kanvas; wajib dibuktikan test rumus WCAG).
- Z-index: hanya `var(--z-*)` untuk nilai >= 100. Modal = `--z-modal`, gate profil = `--z-overlay`, toast = `--z-toast`. Nilai lokal < 100 (tumpukan dalam komponen) boleh literal.
- Breakpoint tunggal: `max-width: 640px` (HP), `max-width: 1024px` (tablet, sidebar ciut), `min-width: 1280px` (lebar), plus `pointer: coarse` untuk target sentuh. Ditulis sebagai komentar kontrak di `token.css` karena CSS tidak menerima var di `@media`. Langkah aman lebih dulu: 639->640, 767->768, 1023->1024 (menutup celah 1px). Angka lain (480, 520, 560, 720, 768, 900) masuk daftar izin yang menyusut; diganti saat berkasnya disentuh dan sudah dicek visual. Layar TV (`layar-token.module.css`) dikecualikan.
- Penjaga: `src/test/anggaran-kode.test.ts` menghitung hex/rgb literal, z-index literal >= 100, breakpoint di luar skala, dan token yang dipakai tetapi tidak didefinisikan di `token.css`; angka dasar di `src/test/anggaran-kode.json` hanya boleh turun.

**Alternatif ditolak**: (a) Tailwind/CSS-in-JS/design token JSON + generator: penulisan ulang 135 modul, tanpa manfaat free tier. (b) PostCSS custom-media: dependensi + konfigurasi build baru untuk 3 angka. (c) langsung menyamakan warna publik dan dasbor dalam satu langkah: mencampur refaktor dengan perubahan tampilan, sulit direview. (d) stylelint: dependensi baru; test anggaran cukup.

## 4. Komponen dasar

**Dipakai ulang apa adanya** (`components/ui/*`): `Tombol`, `Field`, `Kartu`, `KartuStatistik`, `Lencana`, `Tabel`, `Tab`, `Dialog`, `PanelSamping`, `KerangkaModal`, `StatusKosong`, `CatatanKeadaan`, `Galat`, `Skeleton`, `PemilihTanggal/Rentang`, `Toast`, `Pagination`.

**Disatukan**
| Pola | Keputusan |
|---|---|
| Modal | Satu cangkang: `KerangkaModal` + `useDialogFokus` (`components/admin/useDialogFokus.ts`). `FormDialog` dan `FoDialog` tetap sebagai pembungkus tipis dengan API lama (11 pemakai tidak berubah) tetapi isinya `KerangkaModal`; `lib/hooks/useDialogA11y.ts` dihapus. Dua dialog galeri dan `alertdialog` jadwal pindah ke `Dialog`/`DialogKonfirmasi`. Cangkang `PelayananWizardModal` diganti saat halaman antrean dipecah. |
| Konfirmasi | Komponen baru `components/ui/DialogKonfirmasi.tsx` (`role="alertdialog"`, fokus awal di Batal, Escape = batal, `memuat`). Menggantikan 3 `window.confirm` dan alertdialog jadwal. |
| Tombol | `Tombol` satu-satunya. Kelas `.btn*` dimigrasikan bertahap per direktori lalu CSS-nya dihapus dari `globals.css` dan `tema-dasbor.css`. `<button>` mentah boleh hanya untuk kontrol non-tombol-aksi (chip, tab, baris menu) yang punya gaya sendiri. |
| Tabel data | `Tabel` adalah DataTable; tidak dibuat komponen baru. Dimigrasikan: `admin/layanan`, `admin/topik`, `admin/layar`, `admin/fo/penanganan`, `admin/rekap/TabelDataPelayanan` (klik baris diganti tombol "Lihat detail" di kolom aksi agar bisa keyboard). Tetap `<table>` mentah: laporan cetak, `PendataanKhususEditor` (baris bisa disunting), panel survei ringkas. |
| Pembungkus halaman admin | Komponen baru `components/layout/IsiHalaman.tsx` (padding `--pad-page`, `max-width: --content-max`, gap `--gap-grid`) menggantikan `.halaman/.wadah/.isi/.area1/.container`; padding ganda `.adminBody` dihapus. |
| Keadaan muat/kosong/galat | Kontrak tetap: `Skeleton` saat muat awal, `StatusKosong`/`CatatanKeadaan` saat kosong, `Galat` saat galat. `rekap` dan `absensi` diselaraskan. |
| Filter | Admin: `Field` + `<select>`/`PemilihRentang`. Publik: chip `aria-pressed` untuk pilihan tunggal sedikit. Satu kontrol per filter (tidak ada chip dan select untuk hal yang sama). |

**Filter katalog UMKM (M4)**: awal kosong. Baris pertama = 3 chip jenis usaha (urutan Bahan Baku, Produk, Jasa). Chip kategori baru muncul setelah jenis dipilih, isinya `KATEGORI_PER_JENIS[jenis]` yang juga ada di `options.kategori` (irisan, agar tidak ada chip tanpa hasil). Ganti jenis mereset kategori dan spesifik. Panel "Saring hasil" hanya Kabupaten/kota dan Spesifik. Logika murni di `lib/umkm-katalog/filter-bertingkat.ts`. Nilai yang dikirim ke server tidak berubah (`Produk`, `Bahan Baku`, `Jasa`).

**Sengaja TIDAK dibuat**: Storybook; pustaka komponen pihak ketiga (Radix/shadcn); pustaka form; pustaka state/data klien (TanStack Query/SWR); komponen `FilterBar` generik; portal modal; mode gelap. `MenuTitikTiga` (0 pemakai) dibiarkan. `PerintahCepat`, `ProfileCompletenessGate`, `LayananPopup` hanya dirapikan z-index-nya (perilaku fokusnya khusus dan disengaja).

## 5. Lapisan data

**Struktur**
```
src/lib/data/
  referensi.ts        daftar kecil: layanan, petugas, topik, hari libur (fungsi murni menerima SupabaseClient)
  antrean.ts, kunjungan.ts, chat-pengunjung.ts, chat-staf.ts, faq.ts, reservasi.ts   (dibuat saat halamannya dipecah)
  publik-server.ts    server-only: data publik ber-cache (beranda, layanan publik, FAQ publik)
  klien/useReferensi.ts   cache memori modul + dedupe untuk daftar referensi (useSyncExternalStore, TTL 5 menit)
src/lib/realtime/pusat.ts   satu channel per tabel, banyak pendengar (refcount)
```
Aturan (dijaga `anggaran-kode.test.ts`):
1. Fungsi data menerima `SupabaseClient` sebagai argumen pertama, mengembalikan `{ data, error }` bertipe; tanpa React, tanpa toast. Dengan begitu sama-sama bisa dipakai klien browser (RLS pengguna) dan server.
2. `select` selalu daftar kolom eksplisit lewat konstanta `KOLOM_*`. `select('*')` dilarang; pengecualian tertulis: dua pembacaan satu baris formulir di `api/admin/pelayanan/[tiketId]`.
3. Setiap query daftar punya `.limit()`/`.range()`; pengecualian hanya tabel referensi di daftar izin (`layanan`, `petugas`, `topik_penanganan`, `hari_libur`, `jadwal_standby`, `instansi`).
4. Query yang tidak saling bergantung dijalankan `Promise.all`.
5. `page.tsx` tidak memanggil `.from()`/`.rpc()` langsung (angka dasar sekarang dicatat, hanya boleh turun).

**Server vs client**
- Server component + cache: halaman publik tanpa sesi: `/`, `/transparansi`, `/standar-pelayanan`, `/kebijakan-privasi`, daftar layanan `/pengaduan`, daftar `/gallery`, FAQ dan layanan awal `/chat`. Bagian yang bergantung pengguna (tautan admin di beranda, status buka saat ini, popup `?layanan=`) menjadi pulau client kecil.
- Tetap client: seluruh `/admin/*` dan `/me/*`. Alasan: bergantung sesi + Realtime, RLS sudah menegakkan lingkup, dan query langsung dari browser tidak memakan invocation Vercel. Yang diperbaiki strukturnya (bagian 7), bukan tempat render-nya.

**Cache (free tier)**
- `cacheComponents` TIDAK diaktifkan. Dok Next 16 (`01-getting-started/08-caching.md`) menyatakan `use cache` default tersimpan di memori per instance yang tidak bertahan antar-request serverless, dan pengaktifannya mewajibkan migrasi semua konfigurasi segmen (`dynamic = 'force-dynamic'` di hampir semua route). Model lama tetap didukung (`02-guides/caching-without-cache-components.md`).
- Dipakai: `unstable_cache` (sudah dipakai katalog UMKM; tersimpan di Data Cache lintas instance) untuk fungsi di `publik-server.ts`, dan `export const revalidate = 60` pada halaman publik server. Invalidasi: `revalidateTag(tag, { expire: 0 })` (bentuk dua argumen, wajib di Next 16) lewat route admin `POST /api/admin/revalidasi` dengan daftar izin tag.
- Aturan anti-bocor: fungsi ber-cache hanya memakai klien anon tanpa cookie (`persistSession: false`), tidak pernah `lib/supabase/server.ts`; semua masukan menjadi argumen (kunci cache); data per-pengguna, hasil RPC berlingkup, dan apa pun di bawah `/admin`, `/me` tidak boleh masuk `unstable_cache` atau diberi `s-maxage`. Respons JSON berlingkup tetap `private, no-store`.
- Katalog UMKM: cache diperluas ke semua permintaan halaman pertama tanpa `q` dan tanpa `spesifik` (kombinasi jenis x kategori x kabupaten terbatas). Untuk kasus yang sama, respons sukses yang tidak kosong diberi `Cache-Control: public, s-maxage=60` agar CDN menjawab tanpa invocation (verifikasi dulu `02-guides/cdn-caching.md`). Halaman ber-cursor dan pencarian teks tetap ke DB.

**Alternatif ditolak**: memindahkan halaman admin ke server component/Server Actions (menambah invocation, kehilangan jalur RLS langsung, menulis ulang 46 halaman); TanStack Query (dependensi + paradigma kedua; kebutuhan nyata hanya dedupe daftar referensi dan satu pusat Realtime); cache Redis/KV (layanan baru di free tier).

## 6. Kinerja

### 6.1 Rekap
| Keputusan | Rincian |
|---|---|
| Paralelkan route | Setelah `auth.getUser`, jalankan `lingkup_data_saya`, `rekap_ringkasan_dilayani`, `rekap_data_pelayanan` dalam `Promise.all` (tiap RPC menegakkan lingkupnya sendiri lewat `staf_lingkup()`, jadi aman). 5-7 lompatan berurutan menjadi 2 tahap. |
| Hitung sekali | Klien menyimpan `total` dan ringkasan untuk filter yang sama; ganti halaman mengirim `hemat=1`, server melewati hitung dan ringkasan. |
| Satu lintasan di DB | Migrasi baru `CREATE OR REPLACE rekap_data_pelayanan` (tanda tangan dan bentuk hasil sama): `rekap_pelayanan_inti` dipanggil sekali ke CTE `MATERIALIZED`, total dan halaman diambil dari CTE itu. Inti dan lingkup tidak diubah. |
| OFFSET dipertahankan di UI | Inti adalah fungsi plpgsql yang dimaterialisasi penuh, jadi keyset tidak mengurangi kerja inti; halaman bernomor + total berguna bagi pengguna. Keyset tetap untuk ekspor. |
| Ekspor | Batas per panggilan keyset naik 1000 -> 5000 (maks 10 RPC untuk 50.000 baris), `export const maxDuration = 60`, `exceljs` diimpor dinamis di dalam handler. |
| Performa (bersyarat) | Pindah agregasi ke RPC SQL hanya bila terukur: baris `penanganan` per 366 hari > 20.000 atau route > 2 dtk. |
| Indeks (bersyarat) | Tidak menambah indeks tanpa `EXPLAIN` yang menunjukkan seq scan dominan. Cabang B (tiket lama) adalah himpunan beku; tidak dioptimasi kecuali terbukti > 30% waktu. |
| Bundel | `DEFINISI_DILAYANI` pindah ke `lib/rekap/definisi.ts` (tanpa exceljs). |

Target: muat tab Data rentang 30 hari, hangat, p95 < 800 ms (route) dan evaluasi inti 3x -> 1x (ganti halaman) / 2x (muat pertama, termasuk ringkasan); ekspor 50.000 baris < 45 dtk dan <= 10 RPC.

### 6.2 UMKM
| Keputusan | Rincian |
|---|---|
| Statistik tanpa-hasil | `catatTanpaHasil` dipindah ke `after()` (`next/server`), keluar dari jalur respons. |
| Cache | Lihat bagian 5 (halaman pertama tanpa teks bebas; `s-maxage=60`). |
| Indeks trigram (bersyarat) | GIN trigram untuk `umkm_revisi.spesifik` dan `umkm_produk.nama` + tulis ulang predikat `q` menjadi `r.id IN (... UNION ...)` hanya bila `umkm_cari_katalog` dengan `q` > 150 ms atau profil terbit > 2.000. Di bawah itu seq scan lebih murah daripada indeks. |
| CTE `cocok` | Tidak diubah: urutan acak harian + slot "baru" memang butuh seluruh himpunan cocok; biaya linear terhadap profil terbit dan diredam cache halaman pertama. Ditinjau ulang di ambang yang sama. |

Target: halaman pertama tanpa teks bebas = 0 kueri DB dalam jendela 60 dtk; pencarian dengan `q` p95 < 400 ms; tidak ada RPC statistik sebelum respons terkirim.

### 6.3 Polling dan Realtime
- `useRealtimeRefetch`: polling cadangan 30 dtk hanya selama channel belum `SUBSCRIBED`; setelah tersambung 120 dtk; berhenti saat `document.hidden`, satu refetch saat tab terlihat lagi.
- `lib/realtime/pusat.ts`: satu channel per tabel untuk seluruh tab (sidebar dan halaman berbagi).
- `useNavBadges`: 8 count menjadi satu RPC `nav_lencana_saya` (`SECURITY INVOKER`, RLS tetap berlaku); kembali ke query lama bila fungsi belum ada.
- Layar TV: kolom eksplisit; polling panggilan 5 dtk hanya saat Realtime putus, 20 dtk saat tersambung; umpan antrean 30 dtk saat tersambung.
- Antrean: stats dan total harian diparalelkan dengan query utama.

Target: tab admin diam dan terlihat, Realtime tersambung: dari ~27 request/menit menjadi <= 4; tab tersembunyi: 0 selain ping sesi; layar TV 16 -> <= 5 request/menit; channel per tab staf <= 1 per tabel.

### 6.4 Bundel klien
Font: hapus `@import` Google Fonts; `--font-sans/display` menunjuk variabel `next/font`; `fonts.googleapis.com`/`fonts.gstatic.com` keluar dari CSP. Recharts lewat `next/dynamic` (`ssr: false`, hanya di dalam client component) dengan `Skeleton` sebagai `loading`. `exceljs` tidak boleh muncul di chunk klien mana pun. `qrcode`, `lucide-react`, chatscope dibiarkan (tidak terbukti masalah).
Target: 0 request ke `fonts.googleapis.com`; exceljs dan recharts tidak ada di chunk awal `/admin/rekap`, `/admin`, `/transparansi` (dicek dengan `next experimental-analyze` atau pencarian nama modul di `.next/static/chunks`).

## 7. Pemecahan halaman raksasa

Lima halaman: `admin/antrian` (1375), `chat` (1353), `admin/chat` (861), `admin/chat/faq` (792), `me/reservasi` (723). Batas modul yang sama untuk semuanya:

| Lapis | Isi | Aturan |
|---|---|---|
| Data (`lib/data/<domain>.ts`) | query/RPC bertipe | tanpa React; kolom eksplisit; paralel |
| Turunan murni (`<halaman>/_logika/*.ts`) | label, izin, penyaringan, mesin keadaan (reducer) | tanpa I/O; diuji sebagai fungsi murni |
| Hook (`<halaman>/_hook/use*.ts`) | state + efek + Realtime; satu hook = satu tanggung jawab | tanpa JSX; <= 250 baris |
| Komponen (`<halaman>/_bagian/*.tsx`) | JSX dari props | tanpa query; <= 300 baris |
| `page.tsx` | merakit hook dan bagian | <= 200 baris |

Pembagian tanggung jawab:
- `admin/antrian`: `useAntrean` (muat + Realtime), `aksiAntrean` (panggil/mulai/selesai), `turunan.ts` (panel sekarang/berikutnya, label), `SelNama/SelStatus/SelAksi`, `ModalAntrian` (7 modal digerakkan satu state union `{ jenis, tiket }`, menggantikan 7 boolean), `RekapAbsensi`.
- `chat`: `mesinChat.ts` (reducer status percakapan), `useSesiChat` (sesi + consent), `usePesan` (sinkron + Realtime + riwayat), `useKirim` (pesan, bot, foto, coba lagi), `LayarAwal`, `JendelaPercakapan`, `FormPesan`; FAQ dan layanan awal datang dari server sebagai props.
- `admin/chat`: `useDaftarSesi`, `usePesanSesi`, `izinChat.ts` (murni), `PanelDaftar`, `PanelPercakapan`, `DialogChat` (3 dialog, satu union).
- `admin/chat/faq`: `useFaq` (daftar + simpan/hapus/embed), `aksesFaq.ts`, `TabelFaq`, dialog yang sudah ada.
- `me/reservasi`: `useReservasi`, `useKetersediaan`, `validasiReservasi.ts`, `FormReservasi`, `DaftarReservasi`.

Urutan dalam tiap halaman: test karakterisasi hijau lebih dulu -> pindahkan data -> turunan murni -> hook -> komponen -> cangkang. Perilaku tidak berubah; tiap langkah lolos test yang sama. `PelayananWizardModal` (1063), `WalkinPanel`, `settings/jadwal`, `petugas`, `gallery` TIDAK dipecah di putaran ini (lihat bagian 9).

## 8. Keputusan Rust

Ambang YA (semua harus terpenuhi): fungsi murni terikat CPU; terukur >= 1 dtk dan >= 30% waktu p95 route setelah perbaikan algoritme/SQL; tidak ada pustaka native matang; manfaat melebihi biaya toolchain kedua (WASM di Vercel, build CI, pengembang solo TypeScript). Default TIDAK.

| Kandidat | Keputusan | Alasan | Bila ambang terlewati |
|---|---|---|---|
| Render PDF ke PNG (`investment-docs/upload`) | TIDAK | jarang; kerja berat sudah di kode native (`canvas`/pdfjs) | render di browser admin lalu unggah PNG ke R2 |
| Watermark `page-image` (sharp) | TIDAK | sharp = libvips native; masalahnya unduh + komposit berulang | simpan hasil ber-watermark, cache CDN |
| Ekspor Excel | TIDAK | hambatan = 50 RPC, bukan ExcelJS | penulis streaming ExcelJS atau CSV |
| Agregasi Performa di Node | TIDAK | pekerjaan SQL | RPC agregasi |
| Pencarian UMKM / rekap inti | TIDAK | di Postgres | indeks/tulis ulang query |
| Gabung pesan chat di klien | TIDAK | ukuran data kecil; batas WASM lebih mahal | - |
| RAG/embedding | TIDAK | terikat jaringan dan pgvector | - |

Hasil: nol kode Rust di putaran ini.

## 9. Risiko dan hal yang sengaja tidak dikerjakan

| Risiko | Mitigasi |
|---|---|
| Regresi visual saat token dipindah | tahap 1 nilai identik per lingkup, dijaga test peta token; cek tangkapan layar 6 halaman oleh PM |
| Cache membocorkan data | aturan anti-bocor bagian 5; review Opus wajib untuk tiap `unstable_cache`/`s-maxage` baru |
| Kursor katalog basi dari halaman pertama ber-cache (`SNAPSHOT_BERUBAH`) | TTL 60 dtk tanpa stale-while-revalidate; klien sudah mengulang sekali |
| Layar TV telat memanggil | polling cepat tetap aktif setiap kali Realtime tidak `SUBSCRIBED` |
| Paritas `nav_lencana_saya` dengan 8 query lama | `SECURITY INVOKER`; skenario PGlite membandingkan hasil per role; fallback di klien |
| Migrasi ke produksi tanpa staging (dilarang `AGENTS.md`) | pertanyaan terbuka; sampai dijawab, kode harus tetap berjalan tanpa migrasi baru |
| Pemecahan halaman mengubah perilaku | test karakterisasi lebih dulu; satu halaman per gelombang; review Opus per halaman |

Tidak dikerjakan: mengaktifkan `cacheComponents`; memindah admin ke server component; mengganti pustaka chat/grafik; memecah `PelayananWizardModal`, `WalkinPanel`, `jadwal`, `petugas`, `gallery`; migrasi storage ke R2 (rencana terpisah); mengubah `rekap_pelayanan_inti` atau aturan lingkup; mengubah `cocok` UMKM; membersihkan 242 inline style di halaman statis (kecuali yang ikut dipindah ke server component); mode gelap; E2E Playwright.

## 10. Definisi selesai dan cara mengukur

**Diukur PM, read-only, di DB produksi** (setelah menampilkan host dan disetujui pemilik; skrip di `docs/superpowers/audits/ukur/`; tiap pengukuran dalam `BEGIN ... ROLLBACK` dengan `SET LOCAL role authenticated` dan `SET LOCAL request.jwt.claims` milik satu akun admin, karena RPC rekap kosong tanpa identitas staf):
1. `EXPLAIN (ANALYZE, BUFFERS) SELECT public.rekap_data_pelayanan(...)` untuk rentang 7, 30, 366 hari, dengan dan tanpa `p_hitung`; sama untuk `rekap_ringkasan_dilayani`, `rekap_harian_terpadu`, `rekap_kinerja_petugas`.
2. Rencana dalam: `EXPLAIN (ANALYZE, BUFFERS)` atas salinan dua cabang SELECT `rekap_pelayanan_inti` dengan literal (fungsi plpgsql hanya tampil sebagai Function Scan).
3. `EXPLAIN (ANALYZE, BUFFERS) SELECT public.umkm_cari_katalog(...)` tanpa filter, dengan `p_jenis`, dan dengan `p_q` 4 huruf.
4. Jumlah baris: `kunjungan`, `penanganan`, `tiket_antrean`, `umkm_profil` terbit, `umkm_produk`; `pg_stat_statements` (rata-rata dan jumlah panggilan) untuk RPC di atas dan count lencana.
Catatan: `EXPLAIN ANALYZE` menjalankan query; semua fungsi di atas `STABLE` (baca saja).

**Diukur dari aplikasi**: header `Server-Timing` pada `api/admin/rekap/terpadu` dan `api/umkm-katalog`; jumlah request/menit tab admin diam dan layar TV (panel Network, 5 menit); daftar chunk per rute.

**Selesai bila**: semua target bagian 6 tercapai atau selisihnya dijelaskan dengan angka; `anggaran-kode.json`: z-index literal >= 100 = 0, `window.confirm` = 0, `.btn` di TSX = 0, `select('*')` = 2 (pengecualian), breakpoint di luar skala hanya daftar izin, hex literal <= 40, token tak terdefinisi = 0; lima halaman raksasa `page.tsx` <= 200 baris; `npm run verify:baseline` hijau di tiap gelombang; `CLAUDE.md` menjadi peta stabil (<= 150 baris) dan catatan fase pindah ke `docs/`; hasil sebelum/sesudah tercatat di `docs/superpowers/audits/ukur/`.
