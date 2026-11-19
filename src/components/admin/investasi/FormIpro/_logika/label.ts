import { SEKTOR_IPRO } from '@/lib/investasi/konstanta';
import type { NadaLencana } from '@/components/ui/Lencana';

export type StatusIpro = 'draf' | 'terbit' | 'arsip';
export const LABEL_STATUS: Record<StatusIpro, string> = { draf: 'Draf', terbit: 'Terbit', arsip: 'Arsip' };
export const NADA_STATUS: Record<StatusIpro, NadaLencana> = { draf: 'netral', terbit: 'sukses', arsip: 'peringatan' };
export const LABEL_SUMBER = { ptsp: 'PTSP', foila: 'FOILA' } as const;
export const labelSektor = (nilai: string) => SEKTOR_IPRO.find((s) => s.nilai === nilai)?.id ?? nilai;

// Pesan untuk kode galat server (lihat src/lib/investasi/http.ts) dalam konteks layar pengelola.
const PESAN: Record<string, string> = {
  INPUT_TIDAK_VALID: 'Isian belum sesuai. Periksa kembali lalu coba lagi.',
  LOGIN_DIPERLUKAN: 'Sesi berakhir. Masuk kembali untuk melanjutkan.',
  DILARANG: 'Akun ini tidak berwenang mengelola IPRO.',
  TIDAK_DITEMUKAN: 'Data tidak ditemukan. Mungkin sudah dihapus.',
  KONFLIK_VERSI: 'Data ini sudah diubah orang lain. Muat ulang untuk melihat versi terbaru sebelum melanjutkan.',
  KONFLIK_STATUS: 'Tindakan tidak sesuai dengan keadaan data saat ini (mungkin proyek FOILA yang sama sudah ada, atau batas gambar tercapai).',
  SLUG_TERKUNCI: 'Alamat halaman proyek yang pernah terbit tidak dapat diubah.',
  SYARAT_TERBIT: 'Proyek belum memenuhi syarat terbit.',
  TERLALU_BANYAK: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.',
};
export const pesanGalat = (kode: string, cadangan = 'Permintaan belum dapat diproses. Silakan coba lagi.') => PESAN[kode] ?? cadangan;
