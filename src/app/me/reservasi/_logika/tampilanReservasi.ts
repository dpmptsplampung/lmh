// Turunan tampilan halaman reservasi (rencana refaktor 2026-11-11 tugas 9.1). MURNI: nada lencana status, nama layanan
// di daftar, petunjuk tanggal menurut tujuan, dan kapan estimasi antrean tampil.
import type { NadaLencana } from '@/components/ui/Lencana';
import { MAKS_HARI_RESERVASI, type TujuanKunjungan } from './validasiReservasi';

export function nadaReservasi(status: string): NadaLencana {
  switch (status) {
    case 'terjadwal':
      return 'info';
    case 'menunggu':
      return 'peringatan';
    case 'dilayani':
    case 'selesai':
      return 'sukses';
    case 'no_show':
    case 'tidak_terlayani':
      return 'bahaya';
    default:
      return 'netral';
  }
}

/** Nama layanan dari id saran kunjungan; "Loket Layanan" bila id kosong atau tidak (lagi) ada di daftar. */
export function namaLayananSaran(id: string | null, layanan: ReadonlyArray<{ id: string; nama: string }>): string {
  return (id && layanan.find((l) => l.id === id)?.nama) || 'Loket Layanan';
}

/** Petunjuk di bawah pemilih tanggal; mengikuti tujuan (A-05: loket tidak mengklaim hanya Senin–Jumat). */
export function petunjukTanggal(tujuan: TujuanKunjungan): string {
  if (tujuan === 'loket') {
    return `Mengikuti jadwal layanan yang dipilih (sebagian layanan juga buka hari Sabtu). Bila layanan tutup di tanggal itu, kami tunjukkan jadwal terdekat. Maksimal ${MAKS_HARI_RESERVASI} hari ke depan.`;
  }
  if (tujuan === 'bertemu_seseorang') {
    return `Bertemu seseorang hanya hari kerja (Senin–Jumat) dan bukan hari libur. Maksimal ${MAKS_HARI_RESERVASI} hari ke depan.`;
  }
  return `Hari yang tersedia mengikuti tujuan kunjungan yang Anda pilih. Maksimal ${MAKS_HARI_RESERVASI} hari ke depan.`;
}

/** A-07: v_antrian_loket = antrean HARI INI; tidak relevan bila tanggal reservasi bukan hari ini. */
export function tampilkanEstimasi(tanggalRencana: string, hariIni: string): boolean {
  return !tanggalRencana || tanggalRencana === hariIni;
}
