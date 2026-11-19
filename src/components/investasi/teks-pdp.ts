import type { KanalMinat } from './formulir-logika';

/**
 * Naskah persetujuan PDP formulir minat investasi. SATU tempat untuk diganti; naskah ini ditunjukkan ke pemilik
 * sebelum rilis. Nomor versi kebijakan tidak ditulis di UI: server mengisinya (VERSI_KEBIJAKAN_INVESTASI).
 */
export const NASKAH_PDP = {
  tujuan: 'menanggapi minat investasi saya',
  data: {
    ipro: 'nama, email, nomor HP (bila diisi), instansi, dan pesan',
    dokumen: 'nama, email, instansi, dan pesan',
  },
  penerima: 'petugas Investment Gallery DPMPTSP Provinsi Lampung',
  retensi: 'Data disimpan 365 hari setelah permintaan Anda selesai atau ditolak, lalu dihapus.',
  teksTautan: 'Kebijakan Privasi',
  hrefTautan: '/kebijakan-privasi',
} as const;

/** Kalimat pada kotak centang. */
export function kalimatPersetujuan(kanal: KanalMinat): string {
  return `Saya setuju data saya (${NASKAH_PDP.data[kanal]}) dipakai oleh ${NASKAH_PDP.penerima} untuk ${NASKAH_PDP.tujuan}.`;
}
