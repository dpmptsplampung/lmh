// Aturan validasi formulir reservasi (rencana refaktor 2026-11-11 tugas 9.1; dulu `handleSubmit` di page.tsx). MURNI: tanpa
// I/O, tanpa React. Pemeriksaan yang butuh server (hari_libur, jadwal layanan) dijalankan hook useKetersediaan; berkas ini
// hanya memberi aturan sinkron dan pesannya. Urutan pemanggilan di useReservasi:
//   validasiAwal -> (bertemu: akhirPekan, lalu hari_libur) / (loket: jadwal layanan) -> validasiAkhir.
import { addDaysWIB, todayWIB } from '@/lib/time';
import { formatTanggal } from '@/lib/utils';

/** QUE-05: horizon reservasi maksimal H+7 (tanpa slot jam). */
export const MAKS_HARI_RESERVASI = 7;

export type TujuanKunjungan = 'loket' | 'bertemu_seseorang' | '';

export interface IsianReservasi {
  tujuan: TujuanKunjungan;
  layanan_id: string;
  nama_yang_ditemui: string;
  tanggal_rencana: string;
  jam_rencana: string;
  keperluan: string;
}

export const ISIAN_RESERVASI_KOSONG: IsianReservasi = {
  tujuan: '',
  layanan_id: '',
  nama_yang_ditemui: '',
  tanggal_rencana: '',
  jam_rencana: '',
  keperluan: '',
};

export const PESAN_VALIDASI_RESERVASI = {
  tujuan: 'Pilih tujuan kunjungan',
  layanan: 'Pilih layanan tujuan',
  nama: 'Masukkan nama orang yang ingin ditemui',
  tanggal: 'Pilih tanggal kedatangan',
  tanggalMaks: `Tanggal kedatangan maksimal ${MAKS_HARI_RESERVASI} hari ke depan.`,
  akhirPekan: 'Reservasi hanya tersedia pada hari kerja (Senin–Jumat). Mau tanya dulu? Live chat tersedia.',
  libur: 'Kantor libur pada tanggal tersebut.',
  persetujuan: 'Anda harus menyetujui pemrosesan data sesuai Kebijakan Privasi.',
  tanpaSesi: 'Sesi login tidak ditemukan. Silakan login ulang.',
} as const;

/** Rentang tanggal yang boleh dipilih (kalender WIB, RPT-07). */
export function batasTanggalReservasi(): { minDate: string; maxDate: string } {
  return { minDate: todayWIB(), maxDate: addDaysWIB(MAKS_HARI_RESERVASI) };
}

/** Isian wajib dan batas tanggal; mengembalikan pesan galat pertama atau null. */
export function validasiAwal(isian: IsianReservasi, maxDate: string): string | null {
  if (!isian.tujuan) return PESAN_VALIDASI_RESERVASI.tujuan;
  if (isian.tujuan === 'loket' && !isian.layanan_id) return PESAN_VALIDASI_RESERVASI.layanan;
  if (isian.tujuan === 'bertemu_seseorang' && !isian.nama_yang_ditemui.trim()) return PESAN_VALIDASI_RESERVASI.nama;
  if (!isian.tanggal_rencana) return PESAN_VALIDASI_RESERVASI.tanggal;
  if (isian.tanggal_rencana > maxDate) return PESAN_VALIDASI_RESERVASI.tanggalMaks;
  return null;
}

/**
 * Tujuan "bertemu seseorang" tidak punya jadwal layanan: hanya Senin–Jumat (mirror validasi reservasi_buat).
 * Parse eksplisit tengah malam lokal lalu `getDay()` supaya tidak tergantung zona waktu mesin.
 */
export function akhirPekan(tanggal: string): boolean {
  const hari = new Date(`${tanggal}T00:00:00`).getDay(); // 0 = Minggu, 6 = Sabtu
  return hari === 0 || hari === 6;
}

/** Pesan layanan tutup pada tanggal pilihan, menyebut jadwal terdekat bila diketahui (P3, SCH-01/SCH-11). */
export function pesanLayananTutup(namaLayanan: string, jadwalBerikutnya: string | null): string {
  const tglTeks = jadwalBerikutnya
    ? formatTanggal(`${jadwalBerikutnya}T12:00:00+07:00`, { weekday: 'long', year: undefined })
    : null;
  return tglTeks
    ? `${namaLayanan} di kantor DPMPTSP tidak beroperasi pada tanggal itu. Jadwal terdekat: ${tglTeks}. Mau reservasi untuk tanggal itu, atau tanya lewat live chat sekarang?`
    : `${namaLayanan} tidak beroperasi pada tanggal itu. Silakan tanya lewat live chat untuk jadwal pasti.`;
}

/** Persetujuan PDP dan sesi pengunjung; dicek terakhir, setelah pemeriksaan jadwal. */
export function validasiAkhir(persetujuan: boolean, pengunjungId: string | null): string | null {
  if (!persetujuan) return PESAN_VALIDASI_RESERVASI.persetujuan;
  if (!pengunjungId) return PESAN_VALIDASI_RESERVASI.tanpaSesi;
  return null;
}
