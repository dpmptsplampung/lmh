// Kalimat status buka/tutup layanan untuk kartu dan popup. Murni: keputusan buka/tutup datang dari DB
// (layanan_status_hari_ini -> is_layanan_buka_jadwal); di sini hanya merangkai teks.
import { teksBukaSetiap } from '@/lib/jadwal-teks';
import type { StatusHariIni } from './data';

export type RingkasStatus = {
  nada: 'buka' | 'tutup' | 'libur';
  teks: string;
};

/**
 * "Buka sekarang" | "Tutup saat ini · Buka setiap Kamis" | "Libur: Idul Fitri · Buka Senin–Jumat".
 * Mengembalikan null bila status tidak diketahui (RPC belum ada): kartu/popup tidak menampilkan baris status.
 */
export function ringkasStatus(status: StatusHariIni | null | undefined): RingkasStatus | null {
  if (!status) return null;
  if (status.buka) return { nada: 'buka', teks: 'Buka sekarang' };
  const buka = teksBukaSetiap(status.jadwal);
  const sambung = buka ? ` · Buka ${buka}` : ' · Jadwal belum diatur';
  if (status.liburKeterangan) return { nada: 'libur', teks: `Libur: ${status.liburKeterangan}${sambung}` };
  return { nada: 'tutup', teks: `Tutup saat ini${sambung}` };
}
