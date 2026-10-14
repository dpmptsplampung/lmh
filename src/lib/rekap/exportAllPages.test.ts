import { describe, it, expect } from 'vitest';
import { fetchAllPages } from './exportAll';

// Meniru PostgREST: range(from,to) dipotong oleh max-rows server (serverCap).
function sumber(total: number, serverCap: number) {
  const data = Array.from({ length: total }, (_, i) => ({ id: i }));
  const ranges: Array<[number, number]> = [];
  const build = (from: number, to: number) => {
    ranges.push([from, to]);
    return Promise.resolve({ data: data.slice(from, Math.min(to + 1, from + serverCap)), error: null });
  };
  return { build, ranges };
}

describe('fetchAllPages (paginasi penuh tab rekap baru, audit T5)', () => {
  it('tidak terpotong untuk data > batas baris server (2.500 baris, cap 1.000)', async () => {
    const r = await fetchAllPages(sumber(2500, 1000).build);
    expect(r.rows).toHaveLength(2500);
    expect(r.truncated).toBe(false);
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(2500);
  });

  it('tahan terhadap cap server LEBIH KECIL dari ukuran halaman (cap 500): tanpa baris hilang', async () => {
    const r = await fetchAllPages(sumber(2300, 500).build, 50000, 1000);
    expect(r.rows).toHaveLength(2300);
    expect(r.rows.map((x) => x.id)).toEqual(Array.from({ length: 2300 }, (_, i) => i));
  });

  it('kelipatan tepat ukuran halaman tetap lengkap (halaman kosong menutup)', async () => {
    const { build, ranges } = sumber(2000, 1000);
    const r = await fetchAllPages(build);
    expect(r.rows).toHaveLength(2000);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('dipotong dan ditandai truncated hanya bila melebihi maxRows; tepat maxRows = lengkap', async () => {
    const a = await fetchAllPages(sumber(3000, 1000).build, 2500);
    expect(a.rows).toHaveLength(2500);
    expect(a.truncated).toBe(true);
    const b = await fetchAllPages(sumber(2500, 1000).build, 2500);
    expect(b.rows).toHaveLength(2500);
    expect(b.truncated).toBe(false);
  });

  it('melempar galat server (tidak ditelan jadi hasil kosong)', async () => {
    await expect(
      fetchAllPages(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    ).rejects.toEqual({ message: 'boom' });
  });

  it('tanpa data -> kosong', async () => {
    const r = await fetchAllPages(sumber(0, 1000).build);
    expect(r).toEqual({ rows: [], truncated: false });
  });
});
