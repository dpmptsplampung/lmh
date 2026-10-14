import type { SupabaseClient } from '@supabase/supabase-js';
import { buildTicketsQuery, type TicketsQueryParams } from './query';

export const EXPORT_PAGE_SIZE = 1000;
export const EXPORT_MAX_ROWS = 50000;

export interface FetchAllResult {
  rows: Record<string, unknown>[];
  truncated: boolean;
}

// Ekspor harus mengiterasi SEMUA halaman: tanpa .range() eksplisit per halaman,
// PostgREST memotong hasil di 1.000 baris default sehingga berkas rekap tidak
// lengkap. Berhenti bila halaman terakhir < page size atau mencapai maxRows.
export async function fetchAllTicketRows(
  supabase: SupabaseClient,
  params: Omit<TicketsQueryParams, 'from' | 'to'>,
  maxRows = EXPORT_MAX_ROWS,
): Promise<FetchAllResult> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  while (from < maxRows) {
    const query = buildTicketsQuery(supabase, {
      ...params,
      from,
      to: from + EXPORT_PAGE_SIZE - 1,
    });
    const { data, error } = await query;
    if (error) throw error;
    const page = data ?? [];
    rows.push(...(page as Record<string, unknown>[]));
    if (page.length < EXPORT_PAGE_SIZE) break;
    from += EXPORT_PAGE_SIZE;
  }
  // Terpotong hanya bila jumlah data melebihi batas; tepat pada batas tetap
  // dianggap lengkap (halaman ekstra kosong sudah terambil).
  const truncated = rows.length > maxRows;
  return { rows: rows.slice(0, maxRows), truncated };
}

export interface FetchAllPagesResult<T> {
  rows: T[];
  truncated: boolean;
}

type HalamanHasil<T> = { data: T[] | null; error: unknown };

/**
 * Paginasi penuh generik untuk tab rekap baru (penanganan, performa). Berbeda dari `fetchAllTicketRows`:
 *  - offset berikutnya = offset + JUMLAH BARIS YANG DITERIMA (bukan + ukuran halaman), dan berhenti hanya pada
 *    halaman KOSONG. Bila batas baris PostgREST (`max-rows`) lebih kecil dari ukuran halaman, server memotong
 *    tiap halaman dan penghentian "halaman < ukuran" akan menghilangkan baris diam-diam (audit T5).
 *  - `buildPage` WAJIB memakai urutan deterministik (mis. mulai_at lalu id) agar offset tidak bergeser.
 *  - `truncated` true hanya bila masih ada baris di atas `maxRows` (satu baris pembuktian ikut terambil).
 */
export async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => PromiseLike<HalamanHasil<T>>,
  maxRows = EXPORT_MAX_ROWS,
  pageSize = EXPORT_PAGE_SIZE,
): Promise<FetchAllPagesResult<T>> {
  const rows: T[] = [];
  let from = 0;
  while (rows.length <= maxRows) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    from += page.length;
  }
  const truncated = rows.length > maxRows;
  return { rows: truncated ? rows.slice(0, maxRows) : rows, truncated };
}
