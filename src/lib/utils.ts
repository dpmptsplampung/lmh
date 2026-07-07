// Utility functions

/**
 * Format tanggal ke locale Indonesia
 */
export function formatTanggal(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...options,
  });
}

/**
 * Format waktu ke locale Indonesia
 */
export function formatWaktu(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format tanggal + waktu
 */
export function formatTanggalWaktu(date: string | Date): string {
  return `${formatTanggal(date)} ${formatWaktu(date)}`;
}

/**
 * Hitung durasi dari dua timestamp dalam menit
 */
export function hitungDurasiMenit(mulai: string | Date, selesai: string | Date): number {
  const start = typeof mulai === 'string' ? new Date(mulai) : mulai;
  const end = typeof selesai === 'string' ? new Date(selesai) : selesai;
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

/**
 * Format durasi menit ke string yang readable
 */
export function formatDurasi(menit: number): string {
  if (menit < 1) return '< 1 menit';
  if (menit < 60) return `${menit} menit`;
  const jam = Math.floor(menit / 60);
  const sisaMenit = menit % 60;
  if (sisaMenit === 0) return `${jam} jam`;
  return `${jam} jam ${sisaMenit} menit`;
}

/**
 * Relative time (e.g., "5 menit lalu")
 */
export function relativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'baru saja';
  if (diffMin < 60) return `${diffMin} menit lalu`;
  if (diffHour < 24) return `${diffHour} jam lalu`;
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return formatTanggal(d);
}

/**
 * Truncate text
 */
export function truncate(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '…';
}

/**
 * Generate WhatsApp link (untuk kontak UMKM)
 */
export function waLink(phone: string, message?: string): string {
  const cleaned = phone.replace(/\D/g, '');
  const withCountry = cleaned.startsWith('0')
    ? '62' + cleaned.slice(1)
    : cleaned;
  const base = `https://wa.me/${withCountry}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/**
 * CN: helper sederhana untuk conditional class names
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
