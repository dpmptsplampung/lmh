// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const g = vi.hoisted(() => ({ res: null as unknown, target: null as unknown, updateHasil: null as unknown }));
const audit = vi.hoisted(() => vi.fn());
const updates = vi.hoisted(() => [] as unknown[]);

vi.mock('@/lib/akun/server', () => ({
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  audit,
  requireAdmin: async () => g.res ?? {
    actor: { id: 'adm', role: 'admin', aktif: true, auth_user_id: 'a' },
    service: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: g.target }) }) }),
        update: (v: unknown) => {
          updates.push(v);
          return { eq: () => ({ select: async () => g.updateHasil ?? { data: [{ id: 'x' }], error: null } }) };
        },
      }),
    },
  },
}));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

import { PATCH } from './route';

const ID = '660e8400-e29b-41d4-a716-446655440001';
const req = (body: unknown) =>
  new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }) as unknown as NextRequest;
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

describe('PATCH /api/admin/petugas/[id]/koordinator', () => {
  beforeEach(() => {
    g.res = null;
    g.target = { id: ID, role: 'petugas', aktif: true };
    g.updateHasil = null;
    updates.length = 0;
    audit.mockReset();
  });

  it('bukan Admin = respons requireAdmin diteruskan', async () => {
    g.res = { res: new Response('{}', { status: 403 }) };
    expect((await PATCH(req({ koordinator: true }), ctx())).status).toBe(403);
  });

  it('validasi: id, body boolean ketat', async () => {
    expect((await PATCH(req({ koordinator: true }), ctx('x'))).status).toBe(400);
    expect((await PATCH(req({ koordinator: 'ya' }), ctx())).status).toBe(400);
    expect((await PATCH(req({ koordinator: true, role: 'admin' }), ctx())).status).toBe(400);
  });

  it('hanya Front Office / Petugas Layanan; Admin ditolak; akun tidak ada = 404', async () => {
    g.target = { id: ID, role: 'admin', aktif: true };
    expect((await PATCH(req({ koordinator: true }), ctx())).status).toBe(400);
    g.target = null;
    expect((await PATCH(req({ koordinator: true }), ctx())).status).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it('menyimpan penanda (role tidak disentuh) dan mencatat audit', async () => {
    const res = await PATCH(req({ koordinator: true }), ctx());
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ koordinator: true }]);
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'akun_koordinator', ID, { role: 'petugas', koordinator: true });
  });

  it('409 MIGRASI_BELUM_DITERAPKAN bila kolom belum ada', async () => {
    g.updateHasil = { data: null, error: { code: 'PGRST204', message: "Could not find the 'koordinator' column" } };
    const res = await PATCH(req({ koordinator: true }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('MIGRASI_BELUM_DITERAPKAN');
    expect(audit).not.toHaveBeenCalled();
  });
});
