import type { NadaLencana } from '@/components/ui/Lencana';
import { toWIBDateString } from '@/lib/time';
import type { Usaha } from '@/lib/umkm-katalog/types-g5';

export function tanggalWIB(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : `${toWIBDateString(d)} WIB`;
}

// Teks status ajuan dari sisi pemilik. Versi lama profil tetap tampil sampai perubahan diperiksa.
export function ringkasStatus(u: Usaha): { label: string; nada: NadaLencana; teks: string } {
  // Profil mandiri yang ditolak sebelum pernah terbit: pemilik tetap diajukan, alasan petugas tampil sebagai catatan.
  if (u.pemilik_status === 'diajukan' && u.status === 'ditolak') {
    return { label: 'Perlu diperbaiki', nada: 'bahaya', teks: 'Profil belum dapat tampil. Perbaiki sesuai catatan petugas lalu kirim lagi.' };
  }
  if (u.pemilik_status === 'diajukan') {
    return { label: 'Menunggu pemeriksaan', nada: 'peringatan', teks: `Menunggu pemeriksaan, diajukan ${tanggalWIB(u.dibuat_pada)}` };
  }
  if (u.pemilik_status === 'ditolak') {
    return { label: 'Belum dapat dilanjutkan', nada: 'bahaya', teks: 'Pengajuan belum dapat dilanjutkan.' };
  }
  if (u.perubahan === 'menunggu') {
    return { label: 'Perubahan diperiksa', nada: 'info',
      teks: 'Perubahan menunggu pemeriksaan. Versi lama tetap tampil sampai diperiksa.' };
  }
  if (u.perubahan === 'ditolak') {
    return { label: 'Perubahan belum disetujui', nada: 'bahaya',
      teks: 'Perubahan belum disetujui. Versi lama tetap tampil di katalog.' };
  }
  if (u.status === 'diajukan') {
    return { label: 'Perubahan diperiksa', nada: 'info',
      teks: 'Perubahan menunggu pemeriksaan. Versi lama tetap tampil sampai diperiksa.' };
  }
  if (u.status === 'disembunyikan') {
    return { label: 'Disembunyikan', nada: 'netral', teks: 'Profil sedang disembunyikan petugas dari katalog.' };
  }
  if (u.status === 'ditolak') {
    return { label: 'Perlu diperbaiki', nada: 'bahaya', teks: 'Profil belum dapat tampil. Perbaiki lalu kirim lagi.' };
  }
  return { label: 'Tampil di katalog', nada: 'sukses', teks: 'Profil tampil di katalog.' };
}
