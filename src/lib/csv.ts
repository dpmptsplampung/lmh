// Utilitas ekspor CSV aman (RFC 4180): nilai berisi koma, tanda kutip, atau
// baris baru di-escape dan dibungkus kutip ganda. Dipakai ekspor rekap &
// daftar hadir agar berkas tidak rusak saat dibuka di spreadsheet.

export interface CsvColumn {
  key: string;
  label: string;
}

export function escapeCsvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(
  columns: CsvColumn[],
  rows: ReadonlyArray<Record<string, unknown>>,
): string {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(',');
  const lines = rows.map((r) =>
    columns.map((c) => escapeCsvCell(r[c.key])).join(','),
  );
  return [header, ...lines].join('\r\n');
}
