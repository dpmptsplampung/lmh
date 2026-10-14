// Pesan untuk FO tentang hasil replay antrean offline (pendaftaran walk-in yang tidak jadi diproses).
import type { ReplayResult } from './replay';

export const PESAN_LAYANAN_TUTUP = 'Layanan tutup pukul 16.00 WIB, buka kembali pada jam kerja berikutnya.';

/**
 * Pesan ringkas untuk item yang DIBUANG dari antrean offline (bukan sekadar tertunda): ditolak server
 * (mis. layanan sudah tutup, data tidak valid) atau kedaluwarsa (dibuat di hari sebelumnya). Null bila tidak ada.
 */
export function pesanHasilReplay(r: Pick<ReplayResult, 'ditolak' | 'kedaluwarsa'>): string | null {
  const bagian: string[] = [];
  if (r.ditolak) {
    bagian.push(
      `${r.ditolak} pendaftaran walk-in offline ditolak server (mis. layanan sudah tutup atau data tidak valid) dan tidak dikirim`,
    );
  }
  if (r.kedaluwarsa) {
    bagian.push(`${r.kedaluwarsa} pendaftaran offline dari hari sebelumnya dibuang`);
  }
  if (bagian.length === 0) return null;
  return `${bagian.join('; ')}. Daftarkan ulang pengunjung yang bersangkutan bila masih perlu dilayani.`;
}
