# Pesan Perilaku: survei SPAK/SKM, IKM, saran, dan pengaduan

Catatan Pesan Perilaku (pengganti SKM lama: wizard survei publik bertoken, hasil IKM/SPAK, saran, pengaduan, laporan cetak), dipindah utuh dari `CLAUDE.md` pada 2026-11-13. Rujukan: [docs/MIGRATIONS.md](../MIGRATIONS.md) (bagian "Survei terpadu Fase A" dan "Pesan Perilaku lanjutan"), [docs/STATUS.md](../STATUS.md), [docs/KEBIJAKAN_PDP.md](../KEBIJAKAN_PDP.md).

Baris peta halaman (dari tabel "Halaman publik/pengunjung" lama):

| Path | Fungsi | API/DB utama |
|---|---|---|
| `/skm` (redirect ke `/`), `/transparansi` | SKM lama DIHAPUS (keputusan pemilik 2026-10-28; ganti Pesan Perilaku); IKM publik | `lib/ikm`, `IkmPanel` |
| `/survei/<token>` | wizard publik **Pesan Perilaku** (SPAK 5 pernyataan + SKM 9-11 unsur; tanpa login, token undangan per kunjungan) | `api/survei/kirim`, `lib/survei/*`, RPC `get_survei_context`/`kirim_survei` (migrasi survei, belum diterapkan) |

Dari butir Rekap/IKM pada daftar "Domain" lama (kalimat IKM/SKM; butir utuhnya ada di [peta-kode-rinci.md](peta-kode-rinci.md)):

IKM/SKM: `skm` (tab IKM dan SPAK, RPC `ringkasan_ikm`/`ringkasan_spak`, unduhan `api/admin/survei/export`), `transparansi`, `lib/ikm.ts`.

**Menu Pesan Perilaku (admin/FO):** `admin/pesan-perilaku` (hasil IKM/SPAK), `admin/pesan-perilaku/cetak` (laporan angka + grafik batang + cetak/PDF: survei, response rate, saran, pengaduan; admin & FO), `admin/saran`, `admin/pengaduan`; `/admin/skm` redirect. Saran/pengaduan dari wizard: `api/survei/{saran,pengaduan}` -> RPC `kirim_saran`/`kirim_pengaduan_survei` (migrasi `202611030003`); lacak pengaduan wizard cukup nomor laporan (`lacak_pengaduan_nomor`). Angka laporan: `lib/survei/laporan.ts`.

## Catatan refaktor 2026-11-13

- Frasa "(migrasi survei, belum diterapkan)" pada baris `/survei/<token>` sudah tidak benar untuk `202611020001_survei_undangan`: migrasi `202611030001` dan `202611030003`, yang menurut `docs/MIGRATIONS.md` DITERAPKAN ke produksi 2026-10-28, menolak berjalan (penjaga `PRASYARAT`) bila `ensure_undangan`/`survei_undangan` dari `202611020001` belum ada. Status `202611020002`-`0004` dan migrasi `2026110300xx` lainnya: lihat `docs/MIGRATIONS.md` (`202611030007` tercatat DITERAPKAN).
- G4: `/transparansi` dan `/pengaduan` kini Server Component dengan `revalidate = 60`; datanya dari `src/lib/data/publik-server.ts` (`muatTransparansiPublik`, `muatOpsiLayananPengaduan`).
- Halaman publik `/saran` (`src/app/saran`) dan route `src/app/api/saran` ada di kode tetapi tidak tercantum pada teks di atas.
