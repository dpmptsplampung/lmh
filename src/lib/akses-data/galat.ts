// Deteksi "objek database belum ada" untuk Fase 3 (migrasi 202610290001/0002 belum diterapkan pemilik):
// PostgREST PGRST202 (fungsi tidak ada di cache skema), PGRST204 (kolom), PGRST205 (tabel); Postgres 42883 (fungsi),
// 42703 (kolom), 42P01 (tabel). Pemanggil memakai ini untuk turun ke perilaku lama atau menjawab 409.
export const KODE_MIGRASI_BELUM = 'MIGRASI_BELUM_DITERAPKAN' as const;

const KODE_BELUM_ADA = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42883', '42703', '42P01']);

export function objekBelumAda(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && KODE_BELUM_ADA.has(code);
}
