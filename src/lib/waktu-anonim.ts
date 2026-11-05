import { formatTanggal, formatTanggalWaktu } from '@/lib/utils';

// Migrasi 202611030010 membulatkan created_at semua kiriman anonim (saran/pengaduan) ke 00:00 WIB
// supaya tidak bisa dicocokkan dengan jam mengisi survei. Jam pada baris itu tidak bermakna,
// jadi UI hanya boleh menampilkan tanggal.

const TENGAH_MALAM_WIB_MS = 17 * 60 * 60 * 1000; // 00:00 WIB = 17:00 UTC hari sebelumnya (WIB tanpa DST)
const HARI_MS = 24 * 60 * 60 * 1000;

/** True hanya bila waktu tepat 00:00:00.000 WIB. */
export function tepatTengahMalamWIB(iso: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return (((t - TENGAH_MALAM_WIB_MS) % HARI_MS) + HARI_MS) % HARI_MS === 0;
}

/**
 * Teks waktu laporan.
 * - `true`: anonim, tanggal saja.
 * - `false`/`null`/`undefined`: tanggal dan jam WIB.
 * - `'otomatis'`: penanda anonim tidak tersedia (mis. halaman lacak publik). Tepat 00:00:00.000 WIB
 *   dianggap hasil pembulatan dan tampil tanggal saja. Batasnya: kiriman tidak anonim yang kebetulan
 *   masuk tepat pukul 00:00:00.000 WIB juga tampil tanggal saja, dan kiriman anonim lama yang belum
 *   dibulatkan (sebelum migrasi diterapkan) tampil dengan jam.
 */
export function tampilWaktuLaporan(iso: string, anonim: boolean | 'otomatis' | null | undefined): string {
  const tanggalSaja = anonim === true || (anonim === 'otomatis' && tepatTengahMalamWIB(iso));
  return tanggalSaja ? formatTanggal(iso) : formatTanggalWaktu(iso);
}
