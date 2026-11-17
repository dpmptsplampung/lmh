// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
vi.mock('@/lib/akun/server', () => ({ json: vi.fn(), requireStaf: vi.fn() }));
import { semuaTamu } from './server';

function sumber(total: number, cap: number) {
  const ranges: number[][] = [];
  const client = { from: () => {
    let start = 0, end = 0;
    const b: unknown = new Proxy({}, { get(_t, k: string) {
      if (k === 'then') return (resolve: (v: unknown) => void) => resolve({
        data: Array.from({ length: Math.max(0, Math.min(total - start, cap, end - start + 1)) }, (_, i) => ({ id: String(start + i) })), error: null,
      });
      return (...args: unknown[]) => {
        if (k === 'range') { start = Number(args[0]); end = Number(args[1]); ranges.push([start, end]); }
        return b;
      };
    } });
    return b;
  } } as unknown as SupabaseClient;
  return { client, ranges };
}
describe('Buku Tamu ekspor seluruh halaman', () => {
  it('melewati cap server 500 tanpa baris hilang; tepat batas bukan truncated', async () => {
    const { client } = sumber(2300, 500);
    const hasil = await semuaTamu(client, {}, 2300);
    expect(hasil.rows.map(r => r.id)).toEqual(Array.from({ length: 2300 }, (_, i) => String(i)));
    expect(hasil.truncated).toBe(false);
  });
  it('lebih dari batas dipotong dan diberi tanda', async () => {
    const { client } = sumber(2301, 500);
    const hasil = await semuaTamu(client, {}, 2300);
    expect(hasil.rows).toHaveLength(2300);
    expect(hasil.truncated).toBe(true);
  });
});
