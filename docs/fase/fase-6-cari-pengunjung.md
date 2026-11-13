# Fase 6: Saran pengunjung lama di walk-in Front Office

Catatan Fase 6 (combobox saran pada isian Nama dan Nomor HP formulir walk-in FO), dipindah utuh dari `CLAUDE.md` pada 2026-11-13. Rujukan: [rencana + keputusan](../superpowers/plans/2026-11-01-fase-6-cari-pengunjung.md), [matriks RBAC](../analysis/04-RBAC-MATRIX.md) §10, status migrasi di [docs/MIGRATIONS.md](../MIGRATIONS.md).

**Saran pengunjung lama Fase 6 (migrasi `202611010001`, belum diterapkan):** combobox ARIA pada isian **Nama** dan **Nomor HP** yang sudah ada di `components/fo/WalkinPanel` (BUKAN kolom baru): `components/fo/InputSaranPengunjung` (debounce 300 ms, `AbortSignal`, hasil basi dibuang, diam-diam bila galat) + pustaka murni `lib/fo/cari-pengunjung.ts` (`jenisQuery`, `cariPengunjung`, `ambilPengunjung`, `periksaKetersediaan`). Server: RPC `fo_cari_pengunjung(p_q)` (FO/admin aktif; min 3; maks 5; HP tersamar; tanpa `[anonim]`/> 730 hari) dan `fo_ambil_pengunjung(p_id)` (identitas penuh; `audit_log` + 60/10 menit); indeks trigram `kunjungan(nama)` dan `hp_normal(kontak_hp)`. Tanpa RPC (migrasi belum diterapkan) isian tetap input biasa. `lib/fo/pengunjung-lama.ts` kini hanya `muatAsalSering` (datalist). Rencana + keputusan: `docs/superpowers/plans/2026-11-01-fase-6-cari-pengunjung.md`; matriks `docs/analysis/04-RBAC-MATRIX.md` §10.

## Catatan refaktor 2026-11-13

- Frasa "(migrasi `202611010001`, belum diterapkan)" adalah keadaan saat teks ditulis; lihat `docs/MIGRATIONS.md` dan `CLAUDE.md` bagian "Database & migrasi". Kalimat "Tanpa RPC ... isian tetap input biasa" tetap benar sebagai perilaku cadangan kode.
- `src/components/fo/*` dan `src/lib/fo/*` hanya berubah tampilan (G3: `Tombol` dan token; penggantian token tak terdefinisi). Nama berkas dan alurnya tetap.
