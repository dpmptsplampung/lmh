// Tipe permintaan kontak (tahap B) berasal dari backend: lib/umkm-katalog/types-g4.ts.
import type { StatusPermintaan } from '@/lib/umkm-katalog/types-g4';

export type {
  DetailPermintaan, MutasiPermintaan, StatusPermintaan, TugasPermintaan,
  BantuanPermintaan as HasilBantuan,
} from '@/lib/umkm-katalog/types-g4';
export type { HasilPermintaan as HasilPembukaan } from '@/lib/umkm-katalog/types-g4';

export const LABEL_STATUS_PERMINTAAN: Record<StatusPermintaan, string> = {
  diajukan: 'Diajukan', menunggu_izin: 'Menunggu izin UMKM', nomor_dibuka: 'Nomor dibuka',
  ditolak: 'Ditolak', dibatalkan: 'Dibatalkan',
};
