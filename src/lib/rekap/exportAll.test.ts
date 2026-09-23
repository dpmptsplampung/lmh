import { describe, it, expect } from 'vitest';
import { fetchAllTicketRows, EXPORT_PAGE_SIZE, EXPORT_MAX_ROWS } from './exportAll';

function makeFakeSupabase(pages: unknown[][]) {
  const ranges: Array<[number, number]> = [];
  const makeBuilder = () => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.gte = () => b;
    b.lte = () => b;
    b.or = () => b;
    b.order = () => b;
    b.range = (from: number, to: number) => {
      ranges.push([from, to]);
      const idx = ranges.length - 1;
      return Promise.resolve({ data: pages[idx] ?? [], error: null, count: null });
    };
    return b;
  };
  return {
    supabase: { from: () => makeBuilder() } as unknown as Parameters<typeof fetchAllTicketRows>[0],
    ranges,
  };
}

const params = { layananId: null, q: '', dari: '2026-09-01', sampai: '2026-09-07' };

describe('fetchAllTicketRows', () => {
  it('mengiterasi semua halaman sampai halaman terakhir < page size', async () => {
    const pageFull = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({ id: `t${i}` }));
    const lastPage = Array.from({ length: 250 }, (_, i) => ({ id: `last${i}` }));
    const { supabase, ranges } = makeFakeSupabase([pageFull, lastPage]);

    const result = await fetchAllTicketRows(supabase, params);
    expect(result.rows.length).toBe(EXPORT_PAGE_SIZE + 250);
    expect(result.truncated).toBe(false);
    expect(ranges).toEqual([[0, EXPORT_PAGE_SIZE - 1], [EXPORT_PAGE_SIZE, EXPORT_PAGE_SIZE * 2 - 1]]);
  });

  it('menandai truncated dan memotong pada batas maksimum', async () => {
    const pageFull = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({ id: `t${i}` }));
    const pages = [pageFull, pageFull, pageFull];
    const { supabase } = makeFakeSupabase(pages);

    const result = await fetchAllTicketRows(supabase, params, 2500);
    expect(result.rows.length).toBe(2500);
    expect(result.truncated).toBe(true);
  });

  it('tepat pada batas maksimum tetap dianggap lengkap', async () => {
    const pageFull = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({ id: `t${i}` }));
    // Halaman: 50 halaman penuh + 1 halaman kosong (data persis maxRows).
    const pages = Array.from({ length: EXPORT_MAX_ROWS / EXPORT_PAGE_SIZE }, () => pageFull);
    pages.push([]);
    const { supabase } = makeFakeSupabase(pages);

    const result = await fetchAllTicketRows(supabase, params);
    expect(result.rows.length).toBe(EXPORT_MAX_ROWS);
    expect(result.truncated).toBe(false);
  });
});
