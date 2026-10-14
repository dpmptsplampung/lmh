// Klien Supabase palsu untuk test rekap penanganan/performa. Bukan test (tanpa .test) sehingga tidak dikoleksi vitest.
// Tabel `penanganan` meniru PostgREST seperlunya: filter eq/gte/lt pada kolom sederhana, urutan, range(), dan BATAS
// BARIS SERVER (`serverCap`, setara max-rows PostgREST) yang memotong tiap halaman. `h.log` mencatat tiap kueri.

export type Baris = Record<string, unknown>;
export type Op = [string, unknown[]];

export interface HRekap {
  role: string;
  meId: string;
  layananId: string | null;
  aktif: boolean;
  user: { id: string } | null;
  penanganan: Baris[];
  petugas: { id: string; nama: string }[];
  layanan: { id: string; nama: string }[];
  /** Batas baris per respons (meniru max-rows PostgREST). */
  serverCap: number;
  /** Paksa galat pada kueri penanganan. */
  galatPenanganan: boolean;
  log: { tabel: string; ops: Op[]; range: [number, number] | null }[];
  audit: Baris[];
}

export function buatHRekap(sebagian: Partial<HRekap> = {}): HRekap {
  return {
    role: 'admin', meId: 'p-saya', layananId: null, aktif: true, user: { id: 'u-saya' },
    penanganan: [], petugas: [], layanan: [], serverCap: 1000, galatPenanganan: false, log: [], audit: [],
    ...sebagian,
  };
}

function bandingkan(a: unknown, b: unknown): number {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
}

function bangunPenanganan(h: HRekap) {
  const ops: Op[] = [];
  let range: [number, number] | null = null;
  const b: Record<string, unknown> = {};
  const jalankan = () => {
    h.log.push({ tabel: 'penanganan', ops: [...ops], range });
    if (h.galatPenanganan) return { data: null, error: { message: 'boom', code: 'XX000' } };
    let rows = [...h.penanganan];
    const order: [string, boolean][] = [];
    for (const [m, a] of ops) {
      if (m === 'eq') rows = rows.filter((r) => r[a[0] as string] === a[1]);
      if (m === 'gte') rows = rows.filter((r) => r[a[0] as string] != null && new Date(r[a[0] as string] as string).getTime() >= new Date(a[1] as string).getTime());
      if (m === 'lt') rows = rows.filter((r) => r[a[0] as string] != null && new Date(r[a[0] as string] as string).getTime() < new Date(a[1] as string).getTime());
      if (m === 'order') order.push([a[0] as string, (a[1] as { ascending?: boolean } | undefined)?.ascending !== false]);
    }
    rows.sort((x, y) => {
      for (const [k, asc] of order) {
        const c = bandingkan(x[k], y[k]);
        if (c !== 0) return asc ? c : -c;
      }
      return 0;
    });
    if (range) {
      const [from, to] = range;
      rows = rows.slice(from, Math.min(to + 1, from + h.serverCap));
    } else {
      rows = rows.slice(0, h.serverCap);
    }
    return { data: rows, error: null };
  };
  for (const m of ['select', 'eq', 'gte', 'lt', 'order']) {
    b[m] = (...args: unknown[]) => {
      ops.push([m, args]);
      return b;
    };
  }
  b.range = (from: number, to: number) => {
    range = [from, to];
    return b;
  };
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(jalankan()).then(res, rej);
  return b;
}

export function buatKlienRekap(h: HRekap) {
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: h.user }, error: null }) },
    from(tabel: string) {
      if (tabel === 'penanganan') return bangunPenanganan(h);
      if (tabel === 'petugas') {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.in = () => b;
        b.order = () => b;
        b.maybeSingle = () =>
          Promise.resolve({
            data: h.user
              ? { id: h.meId, role: h.role, layanan_id: h.layananId, aktif: h.aktif }
              : null,
            error: null,
          });
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.petugas, error: null }).then(res);
        return b;
      }
      if (tabel === 'layanan') {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.layanan, error: null }).then(res);
        return b;
      }
      throw new Error(`tabel tak terduga di mock rekap: ${tabel}`);
    },
  };
}
