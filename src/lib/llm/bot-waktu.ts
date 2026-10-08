// Mode waktu bot (semua WIB): akhir pekan, hari libur nasional (tabel hari_libur), setelah jam tutup
// (site_settings.jam_tutup_layanan, default 16:00). Di luar jam layanan bot TETAP menjawab, tanpa eskalasi.
import { toWIBDateString } from '@/lib/time';

export type AlasanTutup = 'akhir_pekan' | 'libur_nasional' | 'setelah_jam_tutup';
export interface ModeLayanan {
  tutup: boolean;
  alasan: AlasanTutup | null;
  /** Tanggal ISO hari kerja berikutnya (null bila layanan sedang buka). */
  kerjaBerikutnya: string | null;
}

export const JAM_TUTUP_DEFAULT_MENIT = 16 * 60;

/** "16:00" -> 960. Nilai tak valid -> default 16:00 (sama dengan fungsi DB jam_tutup_layanan). */
export function parseJamTutup(v: string | null | undefined): number {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((v ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : JAM_TUTUP_DEFAULT_MENIT;
}

const WIB_MS = 7 * 3600 * 1000;
const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isWeekend = (iso: string): boolean => {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/** Hari kerja pertama SETELAH `iso` (lewati Sabtu/Minggu & hari libur). */
export function hariKerjaBerikutnya(iso: string, libur: ReadonlySet<string>): string {
  let d = addDays(iso, 1);
  for (let i = 0; i < 60 && (isWeekend(d) || libur.has(d)); i++) d = addDays(d, 1);
  return d;
}

export function hitungMode(now: Date, jamTutupMenit: number, libur: ReadonlySet<string>): ModeLayanan {
  const hari = toWIBDateString(now);
  const wib = new Date(now.getTime() + WIB_MS);
  const menit = wib.getUTCHours() * 60 + wib.getUTCMinutes();
  const alasan: AlasanTutup | null = isWeekend(hari)
    ? 'akhir_pekan'
    : libur.has(hari)
      ? 'libur_nasional'
      : menit >= jamTutupMenit
        ? 'setelah_jam_tutup'
        : null;
  return { tutup: alasan !== null, alasan, kerjaBerikutnya: alasan ? hariKerjaBerikutnya(hari, libur) : null };
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export function labelTanggalID(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${HARI[d.getUTCDay()]}, ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
