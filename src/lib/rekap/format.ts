import { LABEL_STATUS_TIKET } from '@/lib/constants';

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function toWIBDate(date: Date): Date {
  return new Date(date.getTime() + WIB_OFFSET_MS);
}

export function formatTanggalId(dateStr: string): string {
  // Input YYYY-MM-DD (date-only, already a calendar date — no timezone math,
  // a +7h shift could roll it into the next day) or full ISO timestamp (UTC).
  if (dateStr.length === 10) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  const wib = toWIBDate(new Date(dateStr));
  const dd = String(wib.getUTCDate()).padStart(2, '0');
  const mm = String(wib.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = wib.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatWaktuId(iso: string | null): string {
  if (!iso) return '';
  const wib = toWIBDate(new Date(iso));
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function hitungDurasiMenit(mulai: string | null, selesai: string | null): number | null {
  if (!mulai || !selesai) return null;
  const diffMs = new Date(selesai).getTime() - new Date(mulai).getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

/** Slug aman untuk nama file (lowercase alnum + dash). */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Tanggal hari ini menurut zona waktu kantor (WIB), format YYYY-MM-DD. */
export function todayWIB(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

// ---------------------------------------------------------------------------
// Rekap penanganan (Tahap D): label status/hasil dan helper hari WIB.
// ---------------------------------------------------------------------------

/** Selisih menit TANPA pembulatan (untuk rata-rata); null bila salah satu kosong/tidak valid. Tidak pernah negatif. */
export function selisihMenit(mulai: string | null | undefined, selesai: string | null | undefined): number | null {
  if (!mulai || !selesai) return null;
  const a = new Date(mulai).getTime();
  const b = new Date(selesai).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, (b - a) / 60000);
}

/** Tanggal kalender WIB ('YYYY-MM-DD') dari instan ISO; batas hari = 00:00 WIB (= 17:00 UTC hari sebelumnya). */
export function hariWIB(iso: string): string {
  return toWIBDate(new Date(iso)).toISOString().slice(0, 10);
}

/** Awal hari (00:00 WIB) untuk tanggal 'YYYY-MM-DD' sebagai ISO UTC. WIB tanpa DST sehingga offset +07:00 tetap. */
export function awalHariWIB(tanggal: string): string {
  return new Date(`${tanggal}T00:00:00+07:00`).toISOString();
}

/** Awal hari BERIKUTNYA (batas atas eksklusif) untuk tanggal 'YYYY-MM-DD'. */
export function awalHariBerikutnyaWIB(tanggal: string): string {
  return new Date(new Date(`${tanggal}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

export type HasilPenanganan = 'selesai' | 'dieskalasi' | 'dikembalikan';

export const LABEL_HASIL_PENANGANAN: Record<HasilPenanganan, string> = {
  selesai: 'Selesai',
  dieskalasi: 'Dieskalasi ke layanan',
  dikembalikan: 'Dikembalikan ke Front Office',
};

export const LABEL_STATUS_PENANGANAN: Record<string, string> = {
  menunggu: 'Menunggu',
  berjalan: 'Sedang berjalan',
  selesai: 'Selesai',
  batal: 'Dibatalkan',
};

export const LABEL_BATAL_KARENA: Record<string, string> = {
  dialihkan: 'Dialihkan ke layanan lain',
  diambil_alih: 'Diambil alih (Admin/Koordinator)',
  tidak_terlayani: 'Tidak terlayani (lewat jam tutup)',
};

export const LABEL_SALURAN: Record<string, string> = {
  walk_in: 'Walk-in',
  qr: 'Reservasi (QR)',
  chat: 'Chat',
};

export function labelSaluran(saluran: string): string {
  return LABEL_SALURAN[saluran] ?? saluran;
}

/** Label status tiket (termasuk 'dikembalikan' dan 'dialihkan'); status tak dikenal ditampilkan apa adanya. */
export function labelStatusTiket(status: string): string {
  return (LABEL_STATUS_TIKET as Record<string, string>)[status] ?? status;
}

/**
 * Label hasil sebuah tahap untuk tampilan/ekspor: hasil bila tahap selesai; alasan pembatalan bila batal;
 * "Belum ditutup" bila masih berjalan/menunggu.
 */
export function labelHasilTahap(t: { status: string; hasil: string | null; batal_karena: string | null }): string {
  if (t.status === 'selesai' && t.hasil) return LABEL_HASIL_PENANGANAN[t.hasil as HasilPenanganan] ?? t.hasil;
  if (t.status === 'batal') {
    const alasan = t.batal_karena ? (LABEL_BATAL_KARENA[t.batal_karena] ?? t.batal_karena) : null;
    return alasan ? `Dibatalkan: ${alasan}` : 'Dibatalkan';
  }
  return 'Belum ditutup';
}

/** Persentase (0..1) -> "12,5%"; null (pembagi nol / tidak ada data) -> "—". */
export function formatPersen(rasio: number | null | undefined): string {
  if (rasio == null || Number.isNaN(rasio)) return '—';
  return `${(rasio * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
}

/** Menit dengan satu desimal ("12,5 mnt"); null -> "—". */
export function formatMenit(menit: number | null | undefined): string {
  if (menit == null || Number.isNaN(menit)) return '—';
  return `${menit.toLocaleString('id-ID', { maximumFractionDigits: 1 })} mnt`;
}
