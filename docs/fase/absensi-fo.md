# Absensi oleh Front Office

Catatan pencatatan hadir petugas oleh Front Office (pilih layanan, foto, ketik nama), dipindah utuh dari `CLAUDE.md` pada 2026-11-13. Rujukan: [docs/MIGRATIONS.md](../MIGRATIONS.md) (bagian "Pesan Perilaku lanjutan, absensi FO"), lapisan foto di [storage-r2.md](storage-r2.md).

**Absensi FO (migrasi `202611030002`):** `components/admin/AbsensiWizardModal` = layanan -> foto (dikompres `lib/foto/kompres.ts`, 1280 px JPEG 0,82, ke R2 `absensi-foto/`) -> nama petugas DIKETIK -> RPC `fo_catat_hadir_layanan`; daftar + foto di `/admin/absensi` (`api/absensi/foto/[id]`).

## Catatan refaktor 2026-11-13

- Migrasi `202611030002_absensi_hadir_fo` DITERAPKAN ke produksi 2026-10-28 (menurut `docs/MIGRATIONS.md`).
- G3 hanya mengubah tampilan `AbsensiWizardModal` dan `/admin/absensi` (`Tombol`, token).
- Rekap absensi di halaman Antrian kini `src/app/admin/antrian/_bagian/RekapAbsensi.tsx` + `_hook/useRekapAbsensi.ts` (G5).
