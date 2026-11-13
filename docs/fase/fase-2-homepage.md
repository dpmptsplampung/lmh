# Fase 2: Homepage etalase

Catatan Fase 2 (beranda `/` tersusun dari blok tetap, kartu layanan otomatis, popup layanan), dipindah utuh dari `CLAUDE.md` pada 2026-11-13. Rujukan: [rencana + keputusan](../superpowers/plans/2026-10-28-fase-2-homepage-etalase.md), status migrasi di [docs/MIGRATIONS.md](../MIGRATIONS.md).

Baris peta halaman (dari tabel "Halaman publik/pengunjung" lama):

| Path | Fungsi | API/DB utama |
|---|---|---|
| `/` | etalase: blok tetap (`homepage_blok`, diatur `/admin/settings/landing`) + kartu layanan otomatis + popup `/?layanan=<slug>` | `lib/homepage/{blok,data,status}`, `components/homepage/*`, `v_layanan_publik`, RPC `layanan_status_hari_ini` |

**Homepage etalase (Fase 2, migrasi `202610280001`, belum diterapkan):** `src/app/page.tsx` merakit blok dari `lib/homepage/blok.ts` (7 jenis tetap, blok mati tidak dirender, footer selalu terakhir); data dimuat `lib/homepage/data.ts` dengan fallback berlapis agar tidak 500 sebelum migrasi diterapkan; saklar `layanan.tampil_di_homepage`; popup = `components/homepage/{LayananPopup,PopupDariUrl}` (alamat lewat `useSearchParams` di dalam `<Suspense>`); pemadat jadwal bersama bot & etalase = `lib/jadwal-teks.ts`. Rencana + keputusan: `docs/superpowers/plans/2026-10-28-fase-2-homepage-etalase.md`.

## Catatan refaktor 2026-11-13

- Frasa "belum diterapkan" di atas adalah keadaan saat teks ditulis; status `202610280001`: lihat `docs/MIGRATIONS.md` dan `CLAUDE.md` bagian "Database & migrasi" (sebagian judul di MIGRATIONS.md tertinggal).
- G4: `src/app/page.tsx` kini Server Component dengan `export const revalidate = 60`. Datanya dari `muatBerandaPublik()` di `src/lib/data/publik-server.ts` (cache, tag `publik-beranda` + `publik-layanan`). `lib/homepage/data.ts` dan `lib/homepage/blok.ts` tetap ada; `publik-server.ts` memakai `lib/homepage/data.ts`.
- `/admin/settings/landing` dan `/admin/settings` memanggil `segarkanPublik` (tag beranda) setelah menyimpan, sehingga beranda tidak menunggu 60 detik. Selebihnya pengunjung boleh melihat data yang tertinggal sampai 60 detik (keputusan pemilik 2026-11-11).
