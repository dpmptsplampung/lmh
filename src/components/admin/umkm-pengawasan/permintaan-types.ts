// Label dan rujukan permintaan untuk layar FO. Tipe data berasal dari backend (types-g4 dan types).
import type { StatusPermintaan } from '@/lib/umkm-katalog/types-g4';

export type { StatusPermintaan };

export const AKSI_PERMINTAAN: Record<string, string> = {
  ajukan: 'Permintaan diajukan', ambil: 'Permintaan diambil', setujui: 'Permintaan disetujui',
  tolak: 'Permintaan ditolak', batal: 'Permintaan dibatalkan', tautkan: 'Akun pemohon tertaut',
  tahan: 'Permintaan ditahan', lepas_tahan: 'Tahan dilepas', pemberitahuan: 'Pemohon diberi tahu',
  hasil: 'Hasil dicatat', bantu: 'Permintaan bantuan dicatat',
};

// Rujukan permintaan pada baris jejak. Kode permintaan tidak rahasia.
export type RujukanPermintaan = { id: string; versi: number; status: StatusPermintaan; kode: string | null };

export const LABEL_PERMINTAAN: Record<StatusPermintaan, string> = {
  diajukan: 'Diajukan', menunggu_izin: 'Menunggu izin', nomor_dibuka: 'Nomor dibuka',
  ditolak: 'Ditolak', dibatalkan: 'Dibatalkan',
};
