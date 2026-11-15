# Storage Cloudflare R2

Catatan lapisan penyimpanan Cloudflare R2 (presign + konfirmasi, aturan per area), dipindah utuh dari `CLAUDE.md` pada 2026-11-13. Rujukan: [rencana](../superpowers/plans/2026-11-02-storage-r2.md), status migrasi R2 di [docs/MIGRATIONS.md](../MIGRATIONS.md) (bagian "Storage R2 lanjutan").

**Storage Cloudflare R2 (rencana `docs/superpowers/plans/2026-11-02-storage-r2.md`):** lapisan inti SUDAH ada (`lib/storage/{r2,area,unggah}.ts`, `api/storage/{presign,konfirmasi}`, CSP R2, env `R2_*` opsional); baru dipakai absensi FO. Dokumen investasi, foto UMKM, dan lampiran chat masih Supabase Storage (Task 3-9 rencana belum dikerjakan).

## Catatan pemeriksaan 2026-11-13

- Refaktor G0-G9 tidak mengubah `src/lib/storage/*` maupun `src/app/api/storage/*`.
- Kalimat "baru dipakai absensi FO" kemungkinan sudah tertinggal: `ATURAN_AREA` di `src/lib/storage/area.ts` kini mendaftar area `investment-docs`, `umkm-draf`, `umkm-photos`, `absensi-foto`, `pengaduan-bukti`, `umkm-legalitas`, dan `chat-lampiran`; `docs/MIGRATIONS.md` (bagian UMKM `202611090001`) menyebut foto unggahan UMKM disimpan di R2 privat `umkm-draf`. Jalur mana yang benar-benar aktif di produksi belum diperiksa ulang di sini.
