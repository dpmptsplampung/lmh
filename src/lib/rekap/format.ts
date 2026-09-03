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
