# Hasil sesudah refaktor arsitektur dan UI (per 2026-11-13)

Pembanding: potret awal di `src/test/anggaran-kode.json` pada commit `5f9c591` (G0) dan `hasil-sebelum.md`.
Rancangan: `docs/superpowers/specs/2026-11-11-refaktor-arsitektur-ui-design.md` bagian 10.

## 1. Metrik kode (pagar `src/test/anggaran-kode.test.ts`, diukur dari sumber)

| Metrik | Awal (G0) | Sekarang | Target spec bagian 10 | Status |
|---|---|---|---|---|
| `kelasBtn` (kelas `btn` di TSX) | 81 | 0 | 0 | tercapai; aturan `.btn` global juga dihapus (G10.1) |
| `zIndexLiteral` (z-index literal >= 100) | 12 | 0 | 0 | tercapai |
| `windowConfirm` | 0 | 0 | 0 | tercapai |
| `tokenTakTerdefinisi` | (belum diukur) | 0 | 0 | tercapai (6 token diganti token semantik yang ada) |
| `selectBintang` (`select('*')` tanpa `head`) | 4 | 2 | 2 (pengecualian) | tercapai |
| `barisPageRaksasa` (5 `page.tsx` terbesar) | 5104 | 584 | tiap halaman <= 200 | tercapai: antrian 194, chat 21, admin/chat 138, admin/chat/faq 151, me/reservasi 80 |
| `kueriDiPage` (`.from(`/`.rpc(` langsung di `page.tsx`) | 147 | 94 | turun | turun 36%; sisa ada di halaman yang belum dipecah |
| `rgb` literal | 72 | 58 | (tanpa angka) | turun, masih ada |
| `breakpointLuarSkala` | 44 | 41 | hanya daftar izin | BELUM tercapai |
| `hex` literal | 150 | 46 | <= 40 | HAMPIR: 98 cadangan `var(--x, #hex)` yang mati dihapus (145 -> 46); sisa 46 butuh keputusan visual |
| titik buta pagar (metrik baru: `hexLuarModul` 5, `rgbLuarModul` 14, `breakpointLuarModul` 4, `hexInline` 9, `zIndexInline` 1) | tidak terukur | terukur | tidak naik | pagar kini memindai `globals.css`, `tema-dasbor.css`, dan gaya inline TSX |

## 2. Sisa yang belum tercapai (jujur)

- **Hex literal 46 (target <= 40)** dan **rgb 58**: sebagian besar sisa hex ada di `gallery.module.css` dan beberapa berkas lain. Penggantian ke token butuh pengecekan visual per halaman, jadi tidak dilakukan tanpa mata di layar. Satu cadangan (`--color-danger-200`) sengaja dibiarkan karena tokennya tidak terdefinisi dan token semantik penggantinya berbeda di tema publik. Angka pagar dikunci di nilai sekarang agar tidak naik.
- **Breakpoint di luar skala 41 (target: hanya daftar izin)**: sebagian besar bukan 640/1024/1280. Diganti bertahap saat berkasnya disentuh dan dicek visual.
- **`kueriDiPage` 94**: halaman admin lain (mis. rekap, UMKM, petugas, dokumen) masih memuat data langsung di `page.tsx`. Lima halaman raksasa di rencana sudah selesai; halaman lain tidak termasuk lingkup G5-G9.
- **Pengecualian tertulis kueri tanpa batas baris** di `src/lib/data/antrean.ts` (statistik selesai dan rekap absensi): total selesai tetap tepat lewat `count`, hanya rata-rata durasi yang berbasis sampel bila satu lingkup melebihi 1000 tiket selesai per hari.

## 3. Pengukuran yang BELUM dilakukan (menunggu persetujuan pemilik)

Bagian ini menyentuh DB produksi atau membutuhkan deploy, jadi tidak dijalankan tanpa persetujuan eksplisit pemilik:

1. Ulang `docs/superpowers/audits/ukur/baseline.sql` di DB produksi (baca-saja, `BEGIN ... ROLLBACK`); host tujuan ditampilkan lebih dulu. Pembanding: `hasil-sebelum.md` dan `hasil-sesudah-g2.md`.
2. Header `Server-Timing` pada `api/admin/rekap/terpadu` dan `api/umkm-katalog` dari browser di produksi, hanya bermakna SETELAH branch ini di-deploy.
3. Jumlah request per menit tab admin diam dan layar TV (panel Network, 5 menit), serta daftar chunk per rute (`next build`).

Status penerapan: dua migrasi G2 (`202611110002_nav_lencana`, `202611110003_umkm_cari_indeks`) sudah diterapkan ke produksi atas persetujuan pemilik. Kode branch ini belum di-merge ke `main`, sehingga produksi masih menjalankan kode lama.

## 4. Penyimpangan dari spec yang ditemukan audit independen (2026-11-13)

Audit baca-saja atas implementasi terhadap spec menemukan lima penyimpangan yang tidak tercantum di bagian 1-3:

1. **Rekap belum dua tahap** (spec 6.1): `api/admin/rekap/terpadu` memuat `field_khusus`, `jawaban_khusus`, `form_layanan` berurutan setelah RPC. DIPERBAIKI (commit `47df6e1`): definisi dan formulir kini dimuat bersama RPC; jawaban tetap menunggu baris hasil.
2. **Ekspor 1000 baris per panggilan, bukan 5000** (spec 6.1): RPC `rekap_data_pelayanan` membatasi `LEAST(..., 1000)` di DB (`202611010005`); menaikkannya butuh migrasi. Data setahun baru sekitar 869 baris, jadi dicatat sebagai pengecualian tertulis, bukan dikerjakan.
3. **Dua halaman publik belum di server** (spec bagian 5): `/standar-pelayanan` dan `/gallery`. `/standar-pelayanan` DIPERBAIKI (commit `43e53d3`, ISR 60 dtk, tag `publik-standar`); `/gallery` (512 baris, klien) belum.
4. **Definisi token lokal di katalog UMKM** (`katalog.module.css`, `kerangka.module.css`) masih ada (spec: dihapus). Disengaja dan berkomentar; belum disatukan.
5. **`IsiHalaman` dipakai 10 dari 40 halaman admin**; sekitar 18 modul CSS admin masih punya pembungkus `.halaman/.wadah/.isi/.container`.

Tambahan dari audit: tab tersembunyi masih menjalankan refetch pada tiap peristiwa Realtime (target spec: 0 request); channel ganda pada `chat_sesi` di `/admin/chat`; `chat-admin` dan `chat-sesi-<id>` tidak dibuka ulang setelah CLOSED. DIPERBAIKI (commit `731939c`): peristiwa saat tab tersembunyi tidak memicu request, `chat_sesi` dibagi lewat pusat, dan `lib/realtime/kanal.ts` membuka ulang channel tertutup dengan backoff. Cek manual di browser (DevTools WS, putuskan jaringan) belum dilakukan.

Perbaikan lain dari audit: saklar bot kini membuang cache publik; revalidasi FAQ hanya dipanggil Admin; polling cadangan chat pengunjung 30 -> 120 dtk saat Realtime tersambung; `exceljs` survei dimuat malas; dua temuan review Codex (kunci cache berversi, FAQ publik terpotong) di commit `18cfcb8`.
