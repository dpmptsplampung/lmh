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
