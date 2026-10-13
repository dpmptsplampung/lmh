// Pencatat kegagalan mutasi untuk route handler (audit T2d). Helper `@/lib/supabase/mutate` sengaja
// murni (tanpa logger), jadi pemanggil sisi server menangkap `MutasiError` lalu mencatatnya di sini.
//
// Yang dicatat: operasi + route + `kode` (jaringan/ditolak/tidak_ada_baris/database) + `asalCode`
// (SQLSTATE/PGRST dari error asal). TIDAK mencatat pesan teknis mentah (bisa memuat nama konstrain,
// potongan data, dsb.). Berada di lapisan lib agar `src/lib/*` boleh mengimpornya tanpa bergantung pada `src/app`.
import { MutasiError } from '@/lib/supabase/mutate';
import { logServerEvent } from '@/lib/observability/logger';

type Level = 'error' | 'warn';

function kodeAsal(e: MutasiError): string | undefined {
  const asal = e.asal;
  if (typeof asal !== 'object' || asal === null) return undefined;
  const code = (asal as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

export function catatMutasi(
  level: Level,
  operation: string,
  route: string,
  e: unknown,
  extra: Record<string, unknown> = {},
): void {
  if (e instanceof MutasiError) {
    const asalCode = kodeAsal(e);
    logServerEvent(level, { operation, route, ...extra, kode: e.kode, ...(asalCode ? { asalCode } : {}) });
    return;
  }
  // Bukan MutasiError (bug/kegagalan tak terduga): logger menyamarkan pesan Error-nya.
  logServerEvent(level, { operation, route, ...extra, kode: 'tak_terduga', error: e });
}
