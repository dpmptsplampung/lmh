import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: state.rpc,
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'gte', 'lte', 'in']) b[m] = () => b;
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return b;
    },
  })),
}));

const LAYANAN = '5b6d3e5a-9f4a-4b0b-8a5c-2f1d7c9e1a11';

async function panggil(query: string) {
  const { GET } = await import('./route');
  return GET(new NextRequest(`http://localhost/api/chat/status${query}`));
}

describe('GET /api/chat/status', () => {
  beforeEach(() => {
    vi.resetModules();
    state.rpc.mockReset();
  });

  it('400 untuk layanan_id yang bukan UUID atau kosong', async () => {
    expect((await panggil('?layanan_id=abc')).status).toBe(400);
    expect((await panggil('')).status).toBe(400);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('mengembalikan status dari RPC tanpa cache', async () => {
    state.rpc.mockResolvedValue({
      data: {
        ada: true, buka: false, tanggal: '2026-10-31', hari_tanpa_layanan: true, libur_keterangan: null,
        buka_berikutnya_tanggal: '2026-11-02', buka_berikutnya_jam: '08:00',
      },
      error: null,
    });
    const res = await panggil(`?layanan_id=${LAYANAN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(state.rpc).toHaveBeenCalledWith('chat_layanan_status', { p_layanan_id: LAYANAN });
    const body = await res.json();
    expect(body.status).toMatchObject({ buka: false, sumber: 'jadwal', bukaBerikutnya: { tanggal: '2026-11-02', jam: '08:00' } });
  });

  it('RPC gagal tetap 200 dengan kalender global lama (tidak 500)', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'tidak ada' } });
    const res = await panggil(`?layanan_id=${LAYANAN}`);
    expect(res.status).toBe(200);
    expect((await res.json()).status.sumber).toBe('kalender_global');
  });
});
