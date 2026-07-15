// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const buildRequest = (body: unknown): NextRequest => {
  const req = new Request('http://localhost/api/checkin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return req as unknown as NextRequest;
};

describe('POST /api/checkin consent assertion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('rejects authenticated check-in without consent_given and does not write consent_log', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const consentInsert = vi.fn();
    const visitInsert = vi.fn();

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'consent_log') {
          return { insert: consentInsert };
        }
        if (table === 'visit') {
          return {
            insert: visitInsert.mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'v1' }, error: null }),
              }),
            }),
          };
        }
        return {};
      }),
    });

    const { POST } = await import('./route');
    const res = await POST(
      buildRequest({
        nama: 'Budi',
        layanan_id: '11111111-1111-4111-8111-111111111111',
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/consent/i);
    expect(consentInsert).not.toHaveBeenCalled();
    expect(visitInsert).not.toHaveBeenCalled();
  });

  it('writes consent_log only when consent_given is true', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const consentInsert = vi.fn().mockResolvedValue({ error: null });
    const visitInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'v1' }, error: null }),
      }),
    });

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'consent_log') return { insert: consentInsert };
        if (table === 'visit') return { insert: visitInsert };
        return {};
      }),
    });

    const { POST } = await import('./route');
    const res = await POST(
      buildRequest({
        nama: 'Budi',
        layanan_id: '11111111-1111-4111-8111-111111111111',
        consent_given: true,
        versi_kebijakan: '1.0',
      }),
    );

    expect(res.status).toBe(201);
    expect(consentInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        subjek_ref: 'user-1',
        disetujui: true,
        versi_kebijakan: '1.0',
      }),
    );
  });
});
