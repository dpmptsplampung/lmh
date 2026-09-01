const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function toWIBDate(date: Date): Date {
  return new Date(date.getTime() + WIB_OFFSET_MS);
}

export function formatTanggalId(dateStr: string): string {
  // Input YYYY-MM-DD or full ISO
  const d = dateStr.length === 10 ? new Date(`${dateStr}T00:00:00Z`) : new Date(dateStr);
  const wib = toWIBDate(d);
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
