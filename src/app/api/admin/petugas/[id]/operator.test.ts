// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { createClient as serviceClient } from '@supabase/supabase-js';
import { PATCH } from './route';
import { GET } from '../route';

const ID = '660e8400-e29b-41d4-a716-446655440001';
let role = 'admin';
let user: { id: string } | null;
let rpc: ReturnType<typeof vi.fn>;
let serviceFrom: ReturnType<typeof vi.fn>;
let flagResult: { data: { id: string; operator_aktif: boolean }[] | null; error: { code: string } | null };
const req = (body: unknown) => new Request('http://localhost/api/admin/petugas/' + ID, {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}) as NextRequest;
const ctx = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.local');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'mock-key');
  role = 'admin';
  user = { id: 'auth-admin' };
  rpc = vi.fn().mockResolvedValue({ data: { ok: true, operator_aktif: true }, error: null });
  flagResult = { data: [{ id: ID, operator_aktif: true }], error: null };
  serviceFrom = vi.fn(() => ({ select: (columns: string) =>
    columns === 'id, operator_aktif' ? Promise.resolve(flagResult) : Promise.resolve({ data: [{ id: ID, koordinator: false }], error: null }),
  }));
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) }, rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'admin', role, aktif: true } }) }) }) }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(serviceClient).mockReturnValue({ from: serviceFrom,
    rpc: vi.fn().mockResolvedValue({ data: [{ id: ID, nama: 'Petugas' }], error: null }),
  } as unknown as ReturnType<typeof serviceClient>);
});

describe('Admin mengatur operator', () => {
  it('flag berubah melalui RPC sesi Admin tanpa UPDATE lewat service role', async () => {
    const res = await PATCH(req({ operator_aktif: true }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, operator_aktif: true });
    expect(rpc).toHaveBeenCalledWith('admin_atur_operator', { p_petugas_id: ID, p_aktif: true });
    expect(serviceFrom).not.toHaveBeenCalled();
  });
  it('daftar Admin menyertakan flag per akun dan ketersediaan saklar', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ operator_aktif_tersedia: true, akun: [{ id: ID, operator_aktif: true }] });
  });
  it('sebelum migrasi daftar tetap tersedia dan saklar tersembunyi', async () => {
    flagResult = { data: null, error: { code: '42703' } };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ operator_aktif_tersedia: false, akun: [{ id: ID, operator_aktif: false }] });
  });
  it('galat baca flag lain tidak disembunyikan sebagai flag mati', async () => {
    flagResult = { data: null, error: { code: 'XX000' } };
    expect((await GET()).status).toBe(500);
  });
  it('saklar dapat dimatikan lewat RPC yang sama', async () => {
    const res = await PATCH(req({ operator_aktif: false }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, operator_aktif: false });
    expect(rpc).toHaveBeenCalledWith('admin_atur_operator', { p_petugas_id: ID, p_aktif: false });
  });
  it.each(['front_office', 'petugas'])('peran %s tidak boleh mengubah operator', async (bukanAdmin) => {
    role = bukanAdmin;
    expect((await PATCH(req({ operator_aktif: true }), ctx)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('tanpa sesi ditolak', async () => {
    user = null;
    expect((await PATCH(req({ operator_aktif: true }), ctx)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ operator_aktif: 'true' }, { operator_aktif: null }, { operator_aktif: true, nama: 'Nama' }])(
    'input salah atau patch campuran ditolak', async (patch) => {
      expect((await PATCH(req(patch), ctx)).status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    });
  it.each([['PGRST202', 409], ['42501', 403], ['P0002', 404], ['22023', 400], ['XX000', 500]])(
    'galat RPC %s menjadi HTTP %s', async (code, status) => {
      rpc.mockResolvedValue({ data: null, error: { code } });
      const res = await PATCH(req({ operator_aktif: true }), ctx);
      expect(res.status).toBe(status);
      if (status === 409) expect(await res.json()).toMatchObject({ kode: 'MIGRASI_BELUM_DITERAPKAN' });
    });
});
