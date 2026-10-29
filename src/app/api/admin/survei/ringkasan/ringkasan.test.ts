// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';

type Baris = Record<string, unknown>;

function buatKlien(o: { user?: { id: string } | null; role?: string; spak?: Baris[]; skm?: Baris[]; rpcGalat?: boolean } = {}) {
  const from = vi.fn((tabel: string) => {
    if (tabel === 'petugas') {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: () => Promise.resolve({ data: { id: 'p-1', role: o.role ?? 'admin', layanan_id: null, aktif: true }, error: null }),
      };
      return b;
    }
    const data = tabel === 'skm_respons' ? o.skm ?? [] : o.spak ?? [];
    const b: Record<string, unknown> = {};
    for (const k of ['select', 'gte', 'lt', 'order']) b[k] = () => b;
    b.range = (dari: number, sampai: number) => Promise.resolve({ data: data.slice(dari, sampai + 1), error: null });
    return b;
  });
  const rpc = vi.fn(() =>
    Promise.resolve(
      o.rpcGalat
        ? { data: null, error: { message: 'rpc gagal' } }
        : {
            data: [
              { layanan_id: 'l-1', unit: 'layanan', nama: 'A', diundang: 6, mengisi: 3 },
              { layanan_id: null, unit: 'fo', nama: 'Front Office', diundang: 4, mengisi: 1 },
            ],
            error: null,
          },
    ),
  );
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: o.user === undefined ? { id: 'u-1' } : o.user }, error: null }) },
    from,
    rpc,
  };
}

const minta = (q = 'dari=2026-11-01&sampai=2026-11-30') => new NextRequest(`http://localhost/api/admin/survei/ringkasan?${q}`);
const pasang = (o?: Parameters<typeof buatKlien>[0]) => {
  const k = buatKlien(o);
  vi.mocked(createClient).mockResolvedValue(k as never);
  return k;
};

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/admin/survei/ringkasan', () => {
  it('401 tanpa login, 403 untuk petugas', async () => {
    pasang({ user: null });
    expect((await GET(minta())).status).toBe(401);
    pasang({ role: 'petugas' });
    expect((await GET(minta())).status).toBe(403);
  });

  it.each([['dari=2026-11-01'], ['dari=2026-11-30&sampai=2026-11-01'], ['dari=2026-02-31&sampai=2026-03-01']])('400 untuk periode tidak valid (%s)', async (q) => {
    pasang();
    expect((await GET(minta(q))).status).toBe(400);
  });

  it.each(['admin', 'front_office'])('%s: mengembalikan SPAK dan IKM GLOBAL tanpa pemecahan per layanan', async (role) => {
    pasang({
      role,
      spak: [
        { id: '1', created_at: '2026-11-02T03:00:00Z', layanan_id: 'l-1', unit: 'layanan', p1_tanpa_diskriminasi: 6, p2_tanpa_kecurangan: 6, p3_tanpa_imbalan: 6, p4_tanpa_pungli: 6, p5_tanpa_percaloan: 6 },
        { id: '2', created_at: '2026-11-02T04:00:00Z', layanan_id: null, unit: 'fo', p1_tanpa_diskriminasi: 2, p2_tanpa_kecurangan: 2, p3_tanpa_imbalan: 2, p4_tanpa_pungli: 2, p5_tanpa_percaloan: 2 },
      ],
      skm: [
        { id: '3', created_at: '2026-11-02T03:00:00Z', layanan_id: 'l-1', unit: 'layanan', u1_persyaratan: 4, u2_prosedur: 4, u3_waktu: 4, u4_biaya: 4, u5_produk: 4, u6_kompetensi: 4, u7_perilaku: 4, u8_sarana: 4, u9_pengaduan: 4, u10_transparansi: null, u11_integritas: null },
      ],
    });
    const res = await GET(minta());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.spak.responden).toBe(2);
    expect(j.spak.rata).toBe(4);
    expect(j.spak.indeks).toBeCloseTo(66.667, 2);
    expect(j.ikm).toMatchObject({ responden: 1, ikm: 100, mutu: 'A' });
    expect(j.responseRate).toEqual({ diundang: 10, mengisi: 4, persen: 40 });
    expect(JSON.stringify(j)).not.toMatch(/layanan_id|Front Office|l-1/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('500 bila RPC response rate gagal, tanpa membocorkan pesan', async () => {
    pasang({ rpcGalat: true });
    const res = await GET(minta());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('rpc gagal');
  });
});
