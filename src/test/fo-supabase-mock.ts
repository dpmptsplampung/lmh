// Klien Supabase palsu untuk test halaman Front Office. Bukan test (tanpa .test) sehingga tidak dikoleksi vitest.
// Builder `from(tabel)` mencatat tiap operasi rantai (select/eq/in/...) ke `h.log`, bersifat thenable (await builder
// langsung) dan mendukung maybeSingle()/single(). `rpc` memanggil `h.rpc` (hasil `{data, error}`).
// Pemakaian: vi.hoisted untuk `h`, lalu
//   vi.mock('@/lib/supabase/client', async () => {
//     const { buatFakeSupabase } = await import('@/test/fo-supabase-mock');
//     return { createClient: () => buatFakeSupabase(h) };
//   });

export type Op = [string, unknown[]];

export interface HasilFake {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number;
}

export interface FakeH {
  /** Hasil per tabel; fungsi menerima operasi rantai agar satu tabel dapat menjawab kueri berbeda. */
  tabel: Record<string, HasilFake | ((ops: Op[]) => HasilFake)>;
  rpc: (nama: string, args: Record<string, unknown>) => HasilFake | Promise<HasilFake>;
  user: { id: string } | null;
  /** Setiap kueri tabel yang dieksekusi. */
  log: { tabel: string; ops: Op[] }[];
  /** Setiap panggilan rpc. */
  rpcLog: { nama: string; args: Record<string, unknown> }[];
}

export function buatH(): FakeH {
  return { tabel: {}, rpc: () => ({ data: null, error: null }), user: { id: 'u-saya' }, log: [], rpcLog: [] };
}

const METODE_RANTAI = ['select', 'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lte', 'order', 'limit', 'range', 'not', 'or'];

export function buatFakeSupabase(h: FakeH) {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: h.user }, error: null }),
    },
    from(tabel: string) {
      const ops: Op[] = [];
      const hasil = (): HasilFake => {
        h.log.push({ tabel, ops: [...ops] });
        const r = h.tabel[tabel];
        if (typeof r === 'function') return r(ops);
        return r ?? { data: [], error: null };
      };
      const b: Record<string, unknown> = {};
      for (const m of METODE_RANTAI) {
        b[m] = (...args: unknown[]) => {
          ops.push([m, args]);
          return b;
        };
      }
      const tunggal = () => {
        const r = hasil();
        return Promise.resolve({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data });
      };
      b.maybeSingle = tunggal;
      b.single = tunggal;
      b.then = (res: (v: HasilFake) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(hasil()).then(res, rej);
      return b;
    },
    rpc(nama: string, args: Record<string, unknown>) {
      h.rpcLog.push({ nama, args });
      return Promise.resolve(h.rpc(nama, args));
    },
  };
}

/** Apakah rantai operasi memuat `metode(...args)` dengan argumen awal yang sama. */
export function punyaOp(ops: Op[], metode: string, ...awal: unknown[]): boolean {
  return ops.some(([m, a]) => m === metode && awal.every((x, i) => JSON.stringify(a[i]) === JSON.stringify(x)));
}
