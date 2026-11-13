# Handover: refaktor arsitektur dan UI LMH (per 2026-11-13)

Dokumen ini untuk melanjutkan pekerjaan di mesin lain dengan Claude Code (boleh memakai Fable 5.2). Baca bagian 1-3 dulu, lalu kerjakan bagian 4 berurutan.

## 1. Tujuan dan batasan pemilik

Pemilik (pengembang tunggal, berbahasa Indonesia) ingin LMH (Lampung Maju Hub, portal DPMPTSP Provinsi Lampung) lebih optimal: UI konsisten, data rekap/UMKM lebih cepat, kode lebih mudah dibaca, arsitektur cocok untuk free tier (Vercel free + Supabase free + Cloudflare R2).

Aturan kerja yang sudah disepakati:
- **Fable dipakai hemat**: hanya untuk keputusan, spesifikasi, dan rencana. Pelaksanaan oleh Sonnet; review oleh Opus; PM (sesi utama) mengintegrasikan dan menjalankan gerbang. Spec dan rencana SUDAH ditulis (lihat bagian 2), jadi Fable tidak perlu menulis ulang; pakai hanya bila ada keputusan desain baru (mis. perluasan `KerangkaModal`, G10.2).
- **Rust: tidak dipakai.** Bottleneck ada di SQL dan jaringan, bukan CPU aplikasi (spec bagian 8).
- **Tema publik HARUS berbeda dari tema dasbor** (keputusan pemilik). Satu berkas token, dua blok.
- **Filter UMKM**: jenis (Bahan Baku, Produksi, Jasa) dipilih dulu; kategori kosong sampai jenis dipilih. Label "Produksi" untuk nilai DB "Produk".
- **Tanpa staging.** Harness PGlite (`scripts/lokal-rantai/`, `npm i --no-save @electric-sql/pglite`) plus test kontrak menggantikannya. Migrasi ke produksi HANYA setelah PM menampilkan host + daftar migrasi dan pemilik setuju.
- Cache publik boleh tertinggal 60 detik; polling cadangan layar TV 20 detik saat Realtime tersambung.
- Tanpa konfirmasi pemilik: `git push`, PR, merge ke `main` (deploy produksi), migrasi ke produksi, dan kueri ke DB produksi (read-only pun harus menampilkan host dulu).

## 2. Dokumen kunci (semua di repo)

| Dokumen | Isi |
|---|---|
| `docs/superpowers/specs/2026-11-11-refaktor-arsitektur-ui-design.md` | Rancangan (Fable): masalah, token, komponen, lapisan data, cache, kinerja, pemecahan halaman, keputusan Rust, definisi selesai |
| `docs/superpowers/plans/2026-11-11-refaktor-arsitektur-ui.md` | Rencana 59 tugas, gelombang G0-G10, aturan per tugas, titik persetujuan, "Keputusan pemilik" |
| `docs/superpowers/audits/bukti/01-struktur-dan-query.md`, `02-ui-dan-css.md` | Bukti audit awal |
| `docs/superpowers/audits/ukur/` | Skrip ukur baca-saja (`baseline.sql`), hasil sebelum dan sesudah G2 |
| `src/components/ui/README.md` | Aturan komponen: satu tombol, satu modal, satu tabel; token, z-index, titik putus; yang sengaja tidak dibuat |
| `src/test/anggaran-kode.test.ts` + `.json` | Pagar anggaran kode: angka hanya boleh TURUN. Turun = perbarui JSON ke angka baru; naik = perbaiki kodenya |
| `CLAUDE.md`, `AGENTS.md` | Aturan repo wajib (Next.js 16 punya breaking changes: baca `node_modules/next/dist/docs/` sebelum menulis kode Next) |

## 3. Status

**Branch**: `refaktor/g0-g1-arsitektur-ui` (nama lama; isinya sudah sampai G5). Belum ada PR dan belum di-merge ke `main`. `main` = 2618fc4 (PR #24). Karena `main` terhubung ke deploy Vercel, produksi masih menjalankan kode LAMA.

**Selesai** (semua lolos `npm run verify:baseline`):

| Gelombang | Commit | Isi ringkas |
|---|---|---|
| G0 + G1 | 5f9c591 | Baseline ukur, pagar anggaran, `Server-Timing`, font tunggal, exceljs keluar dari bundel klien, Recharts malas, polling adaptif, layar TV hemat, rekap paralel, `maxDuration`, filter UMKM bertingkat, cache katalog UMKM, `DialogKonfirmasi` |
| G2 | 90cff8f | Migrasi `202611110002_nav_lencana` (RPC lencana satu panggilan) dan `202611110003_umkm_cari_indeks` (indeks trigram). **SUDAH DITERAPKAN KE PRODUKSI** atas persetujuan pemilik. Tanpa migrasi rekap `...0001`: SQL rekap sudah cepat (4-17 ms hangat) |
| perbaikan test | 12f977b, 3e148ad | Test tahan Windows (backslash, CRLF) |
| G3 | f5179b7 | `token.css` tunggal (dua blok), `--z-*`, titik putus 640/1024/1280, `IsiHalaman`, `KerangkaModal` (satu cangkang modal), `Tabel` + prop `akhir`, `.btn` -> `Tombol` (sisa 7 di `admin/chat/faq`), README komponen |
| G4 | 336fb2a | `lib/data/referensi.ts` + `useReferensi`, `publik-server.ts` (data publik ber-cache, klien anon), beranda/`/pengaduan`/`/transparansi`/`/kebijakan-privasi` jadi server component (ISR 60 dtk), `POST /api/admin/revalidasi`, pusat Realtime `lib/realtime/pusat.ts` (satu channel per tabel, buka ulang dengan backoff), kolom eksplisit |
| G5 | c752032 | `admin/antrian` 1375 -> 194 baris: `lib/data/antrean.ts`, `_logika/`, 5 hook, 9 komponen `_bagian/`, tujuh modal jadi satu union |

Angka pagar anggaran terakhir (`src/test/anggaran-kode.json`): hex 145, rgb 58, zIndexLiteral 0, breakpointLuarSkala 41, tokenTakTerdefinisi 6, kelasBtn 7, windowConfirm 0, selectBintang 2, kueriDiPage 128, barisPageRaksasa 3923.

**Keadaan produksi**: dua migrasi G2 sudah ada di DB produksi (aditif; kode `main` yang lama tidak memakainya, kode branch ini memakainya dengan fallback bila belum ada). Penyebab asli lambatnya rekap BELUM terjelaskan: SQL cepat, Vercel sudah di Singapura. Pengukur yang menentukan adalah header `Server-Timing` dari browser di produksi SETELAH branch ini di-deploy (lihat 4.6).

## 4. Yang harus dikerjakan (urut)

### 4.1 Awal di mesin baru
1. `git fetch` lalu `git checkout refaktor/g0-g1-arsitektur-ui` (semua lewat `gh`/remote resmi `https://github.com/dpmptsplampung/lmh.git`, akun `dpmptsplampung`; jangan menaruh token di URL).
2. `npm ci`; salin `.env.local` dari mesin lama SECARA MANUAL (tidak ada di repo; jangan di-commit).
3. `npm run verify:baseline` harus hijau sebelum mulai (lint, typecheck, ~7300 test, build). Hook pre-push menjalankannya juga.

### 4.2 Keputusan pemilik yang masih terbuka
- **PR dan merge ke `main`** (= deploy produksi). Belum diputuskan. Rekomendasi: buka PR dari branch ini, deploy preview Vercel dicek dulu (beranda, `/pengaduan`, `/transparansi`, katalog UMKM, `/admin/antrian`), baru merge.
- **Dua temuan bawaan lama di `admin/antrian`** (ada sebelum refaktor; menunggu persetujuan karena sebagian mengubah perilaku):
  1. Muat ulang setelah aksi (Mulai/Selesai) memakai tab/tanggal saat tombol diklik; bila pengguna pindah tab sebelum RPC selesai, tabel menampilkan data tab lama sampai polling berikutnya. Perbaikan: simpan parameter di ref (`useAksiAntrean.ts`, `useAntrean.ts`).
  2. Rekap absen tidak dimuat ulang saat tanggal diganti sementara lipatan terbuka; nama berkas CSV memakai tanggal baru padahal isinya tanggal lama. Test `antrian.aksi.test.tsx` ("tiap kali dibuka") justru mengunci perilaku ini; mengubahnya = perubahan perilaku.
- **`/transparansi` menampilkan layanan yang diarsipkan** (tidak ada filter `aktif`; perilaku lama dipertahankan). Perlu keputusan.
- **Rentang kuartal transparansi** kini WIB (dulu UTC peramban): jumlah responden di hari batas bisa sedikit berbeda.

### 4.3 Tugas kecil tersisa dari review (tanpa keputusan)
- `KerangkaModal` perlu diperluas lalu `PelayananWizardModal` (`src/components/admin/PelayananWizardModal.tsx`, ~1064 baris) pindah ke sana. Wizard membedakan Esc (konfirmasi, tutup tanpa simpan) dari tombol X (simpan draf lalu tutup) dan punya bilah langkah 1-3 di antara kepala dan badan; `KerangkaModal` belum punya `onEscape` terpisah, slot bawah-kepala/atas-kaki, `dikunci` terpisah untuk Esc. Ini bagian 5.5(c) yang sengaja ditunda. Cocok untuk Fable memutuskan desain perluasannya, Sonnet mengerjakan.
- `Tombol` belum punya `ukuran="besar"`, `varian="aksen"`, dan ikon di belakang teks; kelas lokal `.tombolBesar`, `.tombolAksen`, `.ikonAkhir` masih dipakai di beranda/survei/offline/login/peta-potensi/ScanPanel. Prop `ikon` TIDAK boleh dioper dari Server Component (komponen ikon tidak bisa melewati batas server-client; `next build` gagal): di halaman server taruh elemen ikon di dalam isi tombol (contoh `src/app/offline/page.tsx`).
- `WalkinWizard.tsx` masih menyimpan cabang `triggerClassName` (DEPRECATED) dan testnya memakai `btn btn--sm`.
- Kueri statistik dan absensi di `lib/data/antrean.ts` tanpa `.range()`/`.limit()` (melanggar SPEC bagian 5 butir 3; rata-rata durasi bisa terpotong 1000 baris). Catat sebagai pengecualian tertulis atau pindahkan agregat ke RPC.
- `admin/dokumen`: kolom `teks_utama` sudah tidak ditarik di daftar (selesai), tetapi regex pagar anggaran tidak menghitung `select('*, relasi(...)')`.
- Enam token CSS tak terdefinisi (`tokenTakTerdefinisi` = 6) belum diputuskan: definisikan atau hapus pemakaiannya.
- Rapikan: `_bagian/FilterRekap.test.tsx` (nama tidak cocok isinya) dan `_bagian/tiketUji.ts` (data uji di folder komponen) di `admin/antrian`.
- Tombol "Coba lagi" di `PulauStatus` sudah memakai `muatLayananKetat`; `muatLayanan` lama masih dipakai jalur lain (jalur klien).

### 4.4 Gelombang berikutnya (lihat rencana untuk rinci tiap tugas)
Dikerjakan BERURUTAN dalam satu gelombang (berkas `page.tsx` sama); paling banyak dua gelombang bersamaan.
- **G6 `chat`** (1353 baris, risiko tinggi; Opus untuk 6.1 dan 6.3): mesin keadaan, `lib/data/chat-pengunjung.ts`, hook `useSesiChat/usePesan/useKirim/useStatusLayanan`, `_bagian`, cangkang server memakai `muatFaqPublik()`/`muatLayananPublik()` (sudah ada dari G4; `muatLayananPublik` perlu kolom `chatbot_aktif` dan `tipe` yang belum ada di `LayananEtalase`). Delapan test `page.*.test.tsx` harus hijau tanpa diubah.
- **G7 `admin/chat`** (861), **G8 `admin/chat/faq`** (792; di akhir: panggil revalidasi tag `publik-faq`, hapus 7 `.btn` terakhir), **G9 `me/reservasi`** (723).
- **G10**: hapus `.btn` global (`globals.css`, `tema-dasbor.css`; syarat `kelasBtn` = 0), pangkas `CLAUDE.md` <= 150 baris dengan catatan per fase dipindah utuh ke `docs/fase/*.md` (Opus/Fable cocok; peta UMKM di `CLAUDE.md` usang), perbarui `README.md` (klaim usang Gemini 1.5), kencangkan anggaran, UKUR SESUDAH (ulang `baseline.sql` dan pengukuran aplikasi; tulis `hasil-sesudah.md`, perbarui `docs/STATUS.md` dan `docs/DECISION_LOG.md`).
- Tiap gelombang: review Opus (tanpa query di komponen, tanpa JSX di hook, tanpa I/O di `_logika`) -> `npm run verify:baseline` -> cek visual -> commit lokal; push hanya atas persetujuan pemilik.

### 4.5 Belum diverifikasi manual (butuh mata atau login)
- Halaman admin tidak bisa dibuka oleh agen tanpa login; tampilan HP `/pengaduan`, `/transparansi`, `/kebijakan-privasi`, dan filter UMKM dengan data termuat (chip jenis) belum dilihat. Cek visual: `/admin/antrian` (tombol "+ Walk-in" kini `Tombol` normal 36 px, jarak di bawah Panel Sekarang, `IsiHalaman` grid), tombol utama publik kini ungu datar (dulu gradien dengan glow), tinggi tombol desktop 44 -> 36 px (44 px di layar sentuh).
- Realtime: putuskan koneksi atau biarkan channel tertutup di DevTools; pastikan topik `staf-tabel-tiket_antrean` kembali dan hanya satu.
- Kegagalan sesaat saat regenerasi halaman statis (ISR) dapat tersimpan sampai ~60 detik (dokumentasi Next: stale-while-revalidate). Diterima; komentarnya jujur di `publik-server.ts`.

### 4.6 Setelah deploy ke produksi
Baca header `Server-Timing` dari browser pada halaman rekap dan katalog UMKM untuk menemukan sumber lambat yang sebenarnya (langkah rantai `auth.getUser` + panggilan berurutan sudah dipangkas di G1.6). Lalu G10.5.

## 5. Cara bekerja dengan model (disarankan)

- **Sonnet** (agen pelaksana): satu tugas rencana per agen; beri prompt berisi: aturan keras (tanpa commit/push/build/dev server/`.env`; jangan edit `src/test/anggaran-kode.json`), berkas yang boleh disentuh, test dulu (merah), laporan akhir ringkas dengan penyimpangan.
- **Opus**: tugas desain sulit (Realtime, hook, modal) dan review ekuivalensi perilaku (bandingkan dengan `git show HEAD:<berkas>`).
- **Fable**: hanya keputusan/spec baru. Jangan minta menulis ulang rencana.
- Jangan menjalankan lebih dari ~3 agen paralel: batas pemakaian 5 jam sempat tercapai tiga kali dan agen yang terputus bisa dilanjutkan lewat SendMessage (pekerjaan tersimpan di working tree).
- Pola yang terbukti: karakterisasi test dulu -> pindahkan data -> turunan murni -> hook -> komponen -> cangkang; test lama tidak boleh diubah asersinya (bila harus, berhenti dan lapor, putuskan sebagai PM).
- Setelah tiap agen: baca diff, `npx tsc --noEmit`, `npx eslint --max-warnings=0`, test sempit; setelah gelombang: `npm run verify:baseline`; angka anggaran yang turun diperbarui PM.

## 6. Jebakan yang sudah ditemui

- **Windows**: pemisah path backslash dan CRLF merusak test yang membaca berkas (normalisasi di test, bukan di kode). `page.tsx` antrian CRLF di working copy; biarkan.
- **`kunci-log.test.ts`** salah mengira `${nama}` di dalam argumen `logServerEvent(...)` sebagai kunci log: hitung string di luar panggilan.
- **Test sensitif tanggal**: `saran.test.tsx` mencari "2 Nov 2026" dan ikut cocok dengan "12 Nov 2026" (sudah diperketat dengan `(?<!\d)`); waspada pola serupa di test lain.
- **Server Component -> `Tombol`**: jangan oper `ikon` (lihat 4.3). `import 'server-only'` tidak terpasang di lingkungan jsdom: test halaman server me-mock `@/lib/data/publik-server`.
- **Next 16**: `revalidateTag(tag, { expire: 0 })` (dua argumen), `cacheComponents` TIDAK diaktifkan, `unstable_cache` + `revalidate = 60` dipakai.
- **Migrasi**: baseline immutable; migrasi baru = file baru bertimestamp lebih besar + test kontrak + berkas rollback di `docs/` + entri `MANIFEST.json` + inventaris `migration-test-utils.ts`; terapkan dengan `node scripts/apply-migration.mjs <file> --atomic --dry-run` lalu `--atomic --yes` (menyentuh produksi: hanya setelah persetujuan pemilik).
- Lingkungan sesi sebelumnya memakai hook yang kadang meminta pemanggilan alat Agent diulang dengan masukan yang sama; itu khusus mesin lama dan bisa tidak berlaku.

## 7. Prompt awal yang disarankan untuk Claude Code di mesin baru

> Baca `docs/superpowers/HANDOVER-2026-11-13-refaktor.md`, lalu `AGENTS.md`, `CLAUDE.md`, dan rencana `docs/superpowers/plans/2026-11-11-refaktor-arsitektur-ui.md`. Kamu PM: jalankan `npm ci` dan `npm run verify:baseline` untuk memastikan baseline hijau, lalu tanyakan padaku keputusan terbuka di bagian 4.2 sebelum mulai G6. Kerjakan tugas dengan agen Sonnet/Opus sesuai bagian 5; pakai Fable hanya untuk keputusan desain. Jangan push, buat PR, merge, atau menyentuh DB produksi tanpa persetujuanku.
