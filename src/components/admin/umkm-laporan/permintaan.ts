// Label laporan permintaan. Tipe data berasal dari backend (LaporanStatistik).
export const LABEL_STATUS = {
  diajukan: 'Diajukan', menunggu_izin: 'Menunggu izin', nomor_dibuka: 'Nomor dibuka',
  ditolak: 'Ditolak', dibatalkan: 'Dibatalkan',
};
export const LABEL_HASIL = {
  belum_diketahui: 'Belum diketahui', kerja_sama: 'Kerja sama', tidak_berlanjut: 'Tidak berlanjut',
};

export function lamaTunggu(detik: number | null): string {
  if (detik === null) return 'belum ada keputusan';
  if (detik < 60) return `${Math.round(detik)} detik`;
  if (detik < 3600) return `${Math.round(detik / 60)} menit`;
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(detik / 3600)} jam`;
}
