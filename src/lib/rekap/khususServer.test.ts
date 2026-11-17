// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { muatFieldKhusus, muatJawabanKhusus } from './khususServer';

const klienRpc = (rpc: (n: string, a: { p_penanganan: string[] }) => Promise<{ data: unknown; error: unknown }>) =>
  ({ rpc: vi.fn(rpc) }) as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> };

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('muatJawabanKhusus', () => {
  it('memanggil RPC peta per potongan besar (500 id) dengan paralelisme terbatas (4) dan menggabungkan hasilnya', async () => {
    let aktif = 0;
    let puncak = 0;
    const klien = klienRpc(async (nama, arg) => {
      expect(nama).toBe('rekap_khusus_peta');
      aktif++;
      puncak = Math.max(puncak, aktif);
      await new Promise((r) => setTimeout(r, 5));
      aktif--;
      return { data: Object.fromEntries(arg.p_penanganan.map((id) => [id, { f: id }])), error: null };
    });
    const hasil = await muatJawabanKhusus(klien, ids(5200));
    // 5200 id -> 11 potongan (500) -> paling banyak 4 serentak.
    expect(klien.rpc).toHaveBeenCalledTimes(11);
    const ukuran = klien.rpc.mock.calls.map((c) => (c[1] as { p_penanganan: string[] }).p_penanganan.length);
    expect(Math.max(...ukuran)).toBe(500);
    expect(puncak).toBeLessThanOrEqual(4);
    expect(puncak).toBeGreaterThan(1);
    expect(hasil.size).toBe(5200);
    expect(hasil.get('p42')).toEqual({ f: 'p42' });
  });

  it('tanpa id: tanpa panggilan', async () => {
    const klien = klienRpc(async () => ({ data: {}, error: null }));
    expect((await muatJawabanKhusus(klien, [])).size).toBe(0);
    expect(klien.rpc).not.toHaveBeenCalled();
  });

  it('fungsi belum ada dan galat lain dilempar agar rekap tidak mengosongkan jawaban diam-diam', async () => {
    const hilang = klienRpc(async () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }));
    await expect(muatJawabanKhusus(hilang, ['a'])).rejects.toMatchObject({ code: 'PGRST202' });
    const rusak = klienRpc(async () => ({ data: null, error: { code: '57014', message: 'timeout' } }));
    await expect(muatJawabanKhusus(rusak, ['a'])).rejects.toMatchObject({ code: '57014' });
  });
});

describe('muatFieldKhusus', () => {
  const klienTabel = (hasil: { data: unknown; error: unknown }) =>
    ({
      from: () => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'order']) b[m] = () => b;
        b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(hasil).then(res, rej);
        return b;
      },
    }) as unknown as SupabaseClient;

  it('tanpa layanan: kosong tanpa kueri', async () => {
    expect(await muatFieldKhusus(klienTabel({ data: [], error: null }), undefined)).toEqual([]);
  });
  it('tabel belum ada: kosong; galat lain DILEMPAR (kolom tidak boleh hilang diam-diam)', async () => {
    expect(await muatFieldKhusus(klienTabel({ data: null, error: { code: 'PGRST205', message: 'x' } }), 'l')).toEqual([]);
    await expect(muatFieldKhusus(klienTabel({ data: null, error: { code: '57014', message: 'timeout' } }), 'l')).rejects.toMatchObject({ code: '57014' });
  });
});


describe('definisi Khusus ekspor berhalaman', () => {
  it('mengambil semua definisi meski cap server lebih kecil; urutan stabil dan kolom aktif kosong tetap ada', async () => {
    const sumber = Array.from({ length: 1203 }, (_, i) => ({ id: String(i), layanan_id: 'l', label: `Field ${i}`, urut: i,
      jenis: 'teks_singkat', tersembunyi: i === 1, pernah_diisi: false }));
    const ranges: number[][] = [];
    const supabase = { from: () => {
      let offset = 0;
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order']) b[m] = () => b;
      b.range = (from: number, to: number) => { offset = from; ranges.push([from, to]); return b; };
      b.then = (res: (v: unknown) => unknown) => res({ data: sumber.slice(offset, offset + 300), error: null });
      return b;
    } } as unknown as SupabaseClient;
    const fields = await muatFieldKhusus(supabase, 'l', { semuaHalaman: true });
    expect(fields).toHaveLength(1202);
    expect(fields.at(-1)?.label).toBe('Field 1202');
    expect(ranges.map(r => r[0])).toEqual([0, 300, 600, 900, 1200, 1203]);
  });
});
