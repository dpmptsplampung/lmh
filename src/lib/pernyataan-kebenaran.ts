// Pernyataan kebenaran data pengunjung (K12; spec docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md §4.9).
//
// Teks ini dicatat ke `consent_log` bersama VERSI-nya (kolom `tujuan` = JENIS, `versi_kebijakan` = VERSI) setiap kali
// pengunjung menyimpan profilnya. Karena bukti persetujuan merujuk teks yang DIBACA pengunjung saat itu, mengubah TEKS
// WAJIB menaikkan VERSI; `pernyataan-kebenaran.test.ts` mengunci pasangan keduanya lewat hash teks.

/** Nilai kolom `consent_log.tujuan` untuk pernyataan ini. */
export const PERNYATAAN_KEBENARAN_JENIS = 'pernyataan_kebenaran';

/** Nilai kolom `consent_log.versi_kebijakan`. Naikkan setiap kali TEKS berubah (juga perbarui hash di test). */
export const PERNYATAAN_KEBENARAN_VERSI = '1.0';

/** Teks pada kotak centang. */
export const PERNYATAAN_KEBENARAN_TEKS =
  'Saya menyatakan bahwa seluruh data yang saya isi adalah benar dan dapat dipertanggungjawabkan. ' +
  'Saya memahami bahwa data yang tidak benar dapat menghambat atau membatalkan layanan.';
