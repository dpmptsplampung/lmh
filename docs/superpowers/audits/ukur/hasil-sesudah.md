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
| `kueriDiPage` (`.from(`/`.rpc(` langsung di `page.tsx`) | 147 | 96 | turun | turun 35%; sisa ada di halaman yang belum dipecah |
| `rgb` literal | 72 | 58 | (tanpa angka) | turun, masih ada |
| `breakpointLuarSkala` | 44 | 41 | hanya daftar izin | BELUM tercapai |
| `hex` literal | 150 | 145 | <= 40 | BELUM tercapai |

## 2. Sisa yang belum tercapai (jujur)

- **Hex literal 145 (target <= 40)** dan **rgb 58**: warna tertanam terkonsentrasi di 13 berkas CSS (terbanyak: `AppBar`, `gallery`, `transparansi`, `Sidebar`, `PerintahCepat`, `KartuIdentitas`; hitungan kasar di luar deklarasi custom property, sebagian berupa nilai cadangan `var(--x, #...)`). Penggantian ke token butuh pengecekan visual per halaman, jadi tidak dilakukan massal tanpa mata di layar. Angka pagar dikunci di nilai sekarang agar tidak naik.
- **Breakpoint di luar skala 41 (target: hanya daftar izin)**: sebagian besar bukan 640/1024/1280. Diganti bertahap saat berkasnya disentuh dan dicek visual.
- **`kueriDiPage` 96**: halaman admin lain (mis. rekap, UMKM, petugas, dokumen) masih memuat data langsung di `page.tsx`. Lima halaman raksasa di rencana sudah selesai; halaman lain tidak termasuk lingkup G5-G9.
- **Pengecualian tertulis kueri tanpa batas baris** di `src/lib/data/antrean.ts` (statistik selesai dan rekap absensi): total selesai tetap tepat lewat `count`, hanya rata-rata durasi yang berbasis sampel bila satu lingkup melebihi 1000 tiket selesai per hari.

## 3. Pengukuran yang BELUM dilakukan (menunggu persetujuan pemilik)

Bagian ini menyentuh DB produksi atau membutuhkan deploy, jadi tidak dijalankan tanpa persetujuan eksplisit pemilik:

1. Ulang `docs/superpowers/audits/ukur/baseline.sql` di DB produksi (baca-saja, `BEGIN ... ROLLBACK`); host tujuan ditampilkan lebih dulu. Pembanding: `hasil-sebelum.md` dan `hasil-sesudah-g2.md`.
2. Header `Server-Timing` pada `api/admin/rekap/terpadu` dan `api/umkm-katalog` dari browser di produksi, hanya bermakna SETELAH branch ini di-deploy.
3. Jumlah request per menit tab admin diam dan layar TV (panel Network, 5 menit), serta daftar chunk per rute (`next build`).

Status penerapan: dua migrasi G2 (`202611110002_nav_lencana`, `202611110003_umkm_cari_indeks`) sudah diterapkan ke produksi atas persetujuan pemilik. Kode branch ini belum di-merge ke `main`, sehingga produksi masih menjalankan kode lama.

## 4. Penyimpangan dari spec yang ditemukan audit independen (2026-11-13)

Audit baca-saja atas implementasi terhadap spec menemukan lima penyimpangan yang tidak tercantum di bagian 1-3:

1. **Rekap belum dua tahap** (spec 6.1): `api/admin/rekap/terpadu` memuat `field_khusus`, `jawaban_khusus`, `form_layanan` berurutan setelah RPC. Diperbaiki pada gelombang perbaikan audit (lihat catatan commit).
2. **Ekspor 1000 baris per panggilan, bukan 5000** (spec 6.1): RPC `rekap_data_pelayanan` membatasi `LEAST(..., 1000)` di DB (`202611010005`); menaikkannya butuh migrasi. Data setahun baru sekitar 869 baris, jadi dicatat sebagai pengecualian tertulis, bukan dikerjakan.
3. **Dua halaman publik belum di server** (spec bagian 5): `/standar-pelayanan` dan `/gallery`. `/standar-pelayanan` diperbaiki pada gelombang perbaikan audit; `/gallery` (512 baris, klien) belum.
4. **Definisi token lokal di katalog UMKM** (`katalog.module.css`, `kerangka.module.css`) masih ada (spec: dihapus). Disengaja dan berkomentar; belum disatukan.
5. **`IsiHalaman` dipakai 10 dari 40 halaman admin**; sekitar 18 modul CSS admin masih punya pembungkus `.halaman/.wadah/.isi/.container`.

Tambahan dari audit: tab tersembunyi masih menjalankan refetch pada tiap peristiwa Realtime (target spec: 0 request); channel ganda pada `chat_sesi` di `/admin/chat`; `chat-admin` dan `chat-sesi-<id>` tidak dibuka ulang setelah CLOSED. Ketiganya diperbaiki pada gelombang perbaikan audit.
