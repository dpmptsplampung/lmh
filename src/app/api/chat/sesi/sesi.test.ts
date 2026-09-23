import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const serverState = { callerId: 'auth-staff-1' as string | null };

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: serverState.callerId ? { id: serverState.callerId } : null },
        error: null,
      })),
    },
  })),
}));

const mockAdmin = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockAdmin()),
}));

const SESI = '3f2504e0-4f89-41d3-8a0c-0305e82c3301';

function buildReq(body: unknown) {
  return new NextRequest('http://localhost/api/chat/sesi', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

interface MakeClientOpts {
  actor: Record<string, unknown> | null;
  sesiStatus?: string;
}

function makeClient(opts: MakeClientOpts) {
  const auditInsert = vi.fn(async () => ({ error: null }));
  const chatPesanInsert = vi.fn(async () => ({ error: null }));
  const client = {
    auditInsert,
    chatPesanInsert,
    from: (t: string) => {
      if (t === 'petugas') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.actor?.kind === 'staff' ? { id: 'st-1', role: 'admin', layanan_id: null } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (t === 'pengunjung') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      if (t === 'chat_sesi') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: SESI, status: opts.sesiStatus ?? 'eskalasi', pengunjung_id: 'pg-1', layanan_id: 'ly-1' },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (t === 'chat_pesan') {
        return { insert: chatPesanInsert };
      }
      if (t === 'audit_log') {
        return { insert: auditInsert };
      }
      return {};
    },
  };
  return client;
}

describe('POST /api/chat/sesi', () => {
  beforeEach(() => {
    vi.resetModules();
    serverState.callerId = 'auth-staff-1';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('menolak tanpa login dengan 401', async () => {
    serverState.callerId = null;
    mockAdmin.mockReturnValue(makeClient({ actor: null }));
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(401);
  });

  it('menolak pengunjung (bukan staf) dengan 403', async () => {
    mockAdmin.mockReturnValue(makeClient({
      actor: { kind: 'pengunjung', id: 'pg-1' },
    }));
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(403);
  });

  it('staf ambil alih: status aktif + pesan sistem + audit', async () => {
    const client = makeClient({
      actor: { kind: 'staff', role: 'admin', layananId: null, id: 'st-1' },
    });
    mockAdmin.mockReturnValue(client);
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('aktif');
    expect(client.chatPesanInsert).toHaveBeenCalledWith(expect.objectContaining({
      pengirim: 'bot',
      sesi_id: SESI,
    }));
    expect(client.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      aksi: 'chat_sesi_takeover',
    }));
  });

  it('menolak sesi yang sudah selesai dengan 409', async () => {
    mockAdmin.mockReturnValue(makeClient({
      actor: { kind: 'staff', role: 'admin', layananId: null, id: 'st-1' },
      sesiStatus: 'selesai',
    }));
    const { POST } = await import('./route');
    const res = await POST(buildReq({ sesi_id: SESI, aksi: 'takeover' }));
    expect(res.status).toBe(409);
  });
});
