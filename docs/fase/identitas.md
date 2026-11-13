# Identitas pengunjung satu kesatuan

Catatan identitas satu kesatuan (`kunjungan` sebagai data induk FO; email nyata wajib bagi pengunjung yang dieskalasi saat layanan selesai), dipindah utuh dari `CLAUDE.md` pada 2026-11-13. Rujukan: [rencana](../superpowers/plans/2026-11-01-identitas-satu-kesatuan.md), status migrasi di [docs/MIGRATIONS.md](../MIGRATIONS.md).

**Identitas satu kesatuan (migrasi `202611010003`/`0004`, belum diterapkan):** `kunjungan` = data induk FO (email opsional); pengunjung yang dieskalasi wajib punya email NYATA (`email_nyata()`, bukan "Tidak berlaku") saat layanan selesai: trigger `pelayanan_oss`/`pelayanan_perizinan` (tulis balik identitas ke kunjungan, nilai terbaru menang, `audit_log` `pendataan_identitas_disatukan`) dan trigger `tiket_antrean` (EMAIL_WAJIB, semua jalur); `layanan_selesai_khusus` kini 5 argumen (+`p_identitas`); FO pencatat membaca tahap/formulir/Khusus kunjungannya (read-only); UI: `SelesaiEskalasiModal` punya isian Email, form OSS/Non OSS tanpa isian cepat email, riwayat FO menampilkan Email. Zod: `POLA_EMAIL_NYATA` di `lib/types/pelayanan.ts`. Backfill data lama = `0004` terpisah. Bukti: `scripts/lokal-rantai/skenario-identitas.mjs`. Rencana: `docs/superpowers/plans/2026-11-01-identitas-satu-kesatuan.md`.

## Catatan refaktor 2026-11-13

- Frasa "belum diterapkan" di atas adalah keadaan saat teks ditulis; status `202611010003`/`0004`: lihat `docs/MIGRATIONS.md` dan `CLAUDE.md` bagian "Database & migrasi". Ingat `0004` mengubah data nyata (backfill).
- `SelesaiEskalasiModal` kini dibuka dari `src/app/admin/antrian/_bagian/ModalAntrian.tsx` (G5); formulir OSS/Non OSS di `PelayananWizardModal` memakai cangkang `KerangkaModal`. `src/lib/types/pelayanan.ts` (`POLA_EMAIL_NYATA`) tidak diubah refaktor.
