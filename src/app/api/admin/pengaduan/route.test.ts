// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/pengaduan', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;

const petugasQ = (role: string) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'p1', role, layanan_id: 'l1', aktif: true } }),
});

async function pasang(from: ReturnType<typeof vi.fn>) {
  const { createClient } = await import('@/lib/supabase/server');
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u' } } }) },
    from,
  });
  return import('./route');
}

describe('/api/admin/pengaduan', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('PATCH oleh petugas = 403 (bukan sukses palsu)', async () => {
    const from = vi.fn((t: string) => (t === 'petugas' ? petugasQ('petugas') : {}));
    const { PATCH } = await pasang(from);
    const res = await PATCH(req('PATCH', { id: 'x', status: 'selesai' }));
    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalledWith('pengaduan');
  });

  it('PATCH FO: UPDATE yang menyentuh 0 baris (ditolak RLS) = 403, bukan ok', async () => {
    const upd = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const sel = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'x', jalur: 'layanan', layanan_id: 'l1', status: 'baru' } }),
    };
    let n = 0;
    const from = vi.fn((t: string) => (t === 'petugas' ? petugasQ('front_office') : n++ === 0 ? sel : upd));
    const { PATCH } = await pasang(from);
    expect((await PATCH(req('PATCH', { id: 'x', status: 'selesai' }))).status).toBe(403);
  });

  it('GET: petugas membaca view v_pengaduan_petugas, Admin membaca tabel', async () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq']) chain[m] = vi.fn().mockReturnValue(chain);
    chain.range = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
    for (const [role, tabel] of [['petugas', 'v_pengaduan_petugas'], ['admin', 'pengaduan']]) {
      vi.resetModules();
      const from = vi.fn((t: string) => (t === 'petugas' ? petugasQ(role) : chain));
      const { GET } = await pasang(from);
      const r = req('GET') as unknown as { nextUrl: URL };
      r.nextUrl = new URL('http://localhost/api/admin/pengaduan');
      const res = await GET(r as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(from).toHaveBeenCalledWith(tabel);
    }
  });
});
