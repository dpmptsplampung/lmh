// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const TOKEN = '0123456789abcdef0123456789abcdef';
const validBody = {
  token: TOKEN,
  u1: 4,
  u2: 3,
  u3: 4,
  u4: 4,
  u5: 3,
  u6: 4,
  u7: 4,
  u8: 3,
  u9: 4,
  saran: 'Pelayanan baik',
};

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/skm/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as NextRequest;
}

function mockRpc(data: string | null, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ rpc });
  return rpc;
}

describe('POST /api/skm/submit token-only RPC boundary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects client-supplied visit_id and layanan_id', async () => {
    mockRpc('submitted');
    const { POST } = await import('./route');
    const res = await POST(request({
      ...validBody,
      visit_id: '550e8400-e29b-41d4-a716-446655440000',
      layanan_id: '660e8400-e29b-41d4-a716-446655440000',
    }));
    expect(res.status).toBe(400);
  });

  it('submits only the opaque token and ratings to submit_skm_response', async () => {
    const rpc = mockRpc('submitted');
    const { POST } = await import('./route');
    const res = await POST(request(validBody));

    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('submit_skm_response', {
      p_token: TOKEN,
      p_u1: 4,
      p_u2: 3,
      p_u3: 4,
      p_u4: 4,
      p_u5: 3,
      p_u6: 4,
      p_u7: 4,
      p_u8: 3,
      p_u9: 4,
      p_saran: 'Pelayanan baik',
    });
    expect(JSON.stringify(await res.json())).not.toMatch(/visit_id|layanan_id|nama|email/i);
  });

  it.each([
    ['duplicate', 409],
    ['not_completed', 400],
    ['not_found', 404],
  ])('maps RPC result %s to HTTP %i', async (result, status) => {
    mockRpc(result);
    const { POST } = await import('./route');
    const res = await POST(request(validBody));
    expect(res.status).toBe(status);
  });

  it('returns 500 without leaking database details when the RPC fails', async () => {
    mockRpc(null, { message: 'sensitive database error' });
    const { POST } = await import('./route');
    const res = await POST(request(validBody));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('sensitive database error');
  });

  // Audit T2d (No 111): kegagalan RPC kini tercatat dengan kode (sebelumnya 500 tanpa jejak sama sekali).
  describe('kegagalan RPC tercatat', () => {
    let errSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      errSpy.mockRestore();
      vi.unstubAllGlobals();
    });
    const log = () =>
      errSpy.mock.calls
        .map((c: unknown[]) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
        .find((e: Record<string, unknown> | null) => e?.operation === 'skm.submit');

    it('RPC error: 500 dan dicatat dengan kode tanpa pesan teknis', async () => {
      mockRpc(null, { message: 'sensitive database error', code: '08006' });
      const { POST } = await import('./route');
      expect((await POST(request(validBody))).status).toBe(500);
      expect(log()).toMatchObject({ kode: 'database', asalCode: '08006' });
      expect(JSON.stringify(log())).not.toContain('sensitive');
    });

    it('RPC sukses tetapi bukan string status: 500 dan dicatat tidak_ada_baris', async () => {
      mockRpc(null, null);
      const { POST } = await import('./route');
      expect((await POST(request(validBody))).status).toBe(500);
      expect(log()).toMatchObject({ kode: 'tidak_ada_baris' });
    });
  });
});
