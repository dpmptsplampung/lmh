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
      expect(nama).toBe('pendataan_khusus_peta');
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

  it('fungsi belum ada (migrasi belum diterapkan): peta kosong; galat lain dilempar', async () => {
    const hilang = klienRpc(async () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }));
    expect((await muatJawabanKhusus(hilang, ['a'])).size).toBe(0);
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
