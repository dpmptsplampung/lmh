# UMKM: Katalog UMKM dan marketplace lama

Catatan UMKM (Katalog UMKM yang aktif dan sisa marketplace lama yang sudah dihapus dari aplikasi), dikumpulkan utuh dari beberapa bagian `CLAUDE.md` lama pada 2026-11-13. Rujukan: rencana dan keputusan pemilik di [docs/umkm/](../umkm/) (mis. [RENCANA.md](../umkm/RENCANA.md), [KEPUTUSAN-PEMILIK.md](../umkm/KEPUTUSAN-PEMILIK.md)), [rencana produk + formulir](../superpowers/plans/2026-11-10-umkm-produk-formulir.md), status migrasi di [docs/MIGRATIONS.md](../MIGRATIONS.md).

Dari daftar "Domain" lama (kalimat terakhir butir Rekap; butir utuhnya ada di [peta-kode-rinci.md](peta-kode-rinci.md)):

Pengaduan (`pengaduan`, `api/pengaduan`), `standar-pelayanan`, Katalog UMKM (`umkm/katalog`, `api/umkm-katalog`, `api/umkm-pemilik`, admin `umkm-tugas`/`umkm-pengawasan`/`umkm-laporan`; rencana `docs/umkm/`; marketplace lama `/umkm` DIHAPUS 2026-11-10, alamat lama diarahkan di `next.config.ts`, tabel lama tetap di DB), investasi/gallery/`peta-potensi` (PDF di-render jadi PNG ber-watermark: `api/investment-docs/*`, `canvas`/`pdfjs-dist`/`sharp`), konten landing via CMS registry (`lib/site-settings.ts`).

Baris peta halaman (dari tabel "Halaman publik/pengunjung" lama):

| Path | Fungsi | API/DB utama |
|---|---|---|
| `/umkm/katalog`, `/umkm/katalog/[id]` | katalog UMKM publik (kepala/kaki sendiri di `KerangkaKatalog`); `/umkm`, `/umkm/inbox`, `/umkm/edit/*` lama dialihkan ke sini | `api/umkm-katalog/*`, `components/umkm-katalog/*` |

Kelompok tabel (dari "Peta database" lama):

- UMKM/investasi: `listing_umkm`, `umkm_inquiry`, `umkm_listing_owner`, `umkm_verifikasi_jejak` (milik marketplace lama yang dihapus dari aplikasi; data tetap), tabel katalog baru `umkm_*` (migrasi `2026110900*`; produk per revisi `umkm_produk`, kolom profil kecamatan/nama_pemilik/bentuk_usaha/tahun_mulai/omzet_rentang/tenaga_kerja_rentang, `umkm_foto.utama`/`produk_urutan` di migrasi `202611100001`-`0003`, belum diterapkan; rencana `docs/superpowers/plans/2026-11-10-umkm-produk-formulir.md`), `investment_documents`, `investasi_lead`, `jejak_minat_investasi`

## Catatan pemeriksaan dan refaktor 2026-11-13

- Status migrasi yang sudah pasti (menurut `docs/MIGRATIONS.md`): `202611090001`-`0012` DITERAPKAN ke produksi 2026-11-09; `202611100001`-`0003` DITERAPKAN 2026-11-10. Frasa "belum diterapkan" pada kelompok tabel di atas sudah salah. G2 menambah `202611110003_umkm_cari_indeks` (indeks trigram pencarian), juga sudah diterapkan ke produksi atas persetujuan pemilik.
- Rute yang aktif (diperiksa di kode): publik `/umkm/katalog`, `/umkm/katalog/[id]` (`src/components/umkm-katalog/`, `src/lib/umkm-katalog/`, `src/app/api/umkm-katalog/*`); pemilik usaha `/me/usaha`, `/me/usaha/[id]` (`src/components/umkm-pemilik/`, `src/app/api/umkm-pemilik/*`); perusahaan pencari pemasok `/me/umkm` (`src/components/umkm-perusahaan/`); staf `/admin/umkm-tugas`, `/admin/umkm-pengawasan`, `/admin/umkm-laporan` (`src/app/api/admin/umkm-{tugas,pengawasan,laporan}`). Formulir bersama: `src/components/umkm-form/`.
- Pengalihan di `next.config.ts`: `/umkm`, `/umkm/inbox`, `/umkm/edit/:id` -> `/umkm/katalog`; `/admin/umkm` -> `/admin/umkm-tugas`. Folder `src/app/api/umkm`, `src/app/umkm/inbox`, `src/app/umkm/edit`, dan `src/app/admin/umkm` sudah tidak ada.
- G1: filter katalog bertingkat (`src/lib/umkm-katalog/filter-bertingkat.ts`; chip jenis berlabel "Produksi" sementara nilai di DB/API tetap "Produk"), cache katalog, dan header `Server-Timing` di `src/app/api/umkm-katalog/route.ts`. G3 hanya mengubah tampilan.
