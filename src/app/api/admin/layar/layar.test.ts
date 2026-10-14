// @vitest-environment node
// Audit T2d (inventaris No 57-58): pencabutan token layar yang menyentuh 0 baris = sukses palsu (token tetap aktif).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const ID = '660e8400-e29b-41d4-a716-446655440001';
const req = (body: unknown) =>
  new Request('http://localhost/api/admin/layar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

type Hasil = { data?: unknown; error?: { code?: string; message: string } | null };

async function setup(o: { role?: string; user?: { id: string } | null; update?: Hasil; insert?: Hasil; select?: Hasil } = {}) {
  const user = o.user === undefined ? { id: 'auth-1' } : o.user;
  const dipanggil: string[] = [];
  const updateSelect = vi.fn(async () => ({ data: [{ id: ID }], error: null, ...o.update }));
  const supabase = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (t: string) => {
      if (t === 'petugas') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'p-1', role: o.role ?? 'admin' } }) }) }) };
      }
      return {
        select: () => ({ order: async () => ({ data: [], error: null, ...o.select }) }),
        insert: () => {
          dipanggil.push('insert');
          return { select: () => ({ single: async () => ({ data: { id: ID, nama: 'Lobi' }, error: null, ...o.insert }) }) };
        },
        update: (v: unknown) => {
          dipanggil.push(`update:${JSON.stringify(v)}`);
          return { eq: () => ({ select: updateSelect }) };
        },
      };
    },
  };
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);
  const logger = await import('@/lib/observability/logger');
  const log = vi.mocked(logger.logServerEvent);
  log.mockClear();
  return { dipanggil, updateSelect, log };
}

describe('POST /api/admin/layar', () => {
  beforeEach(() => vi.resetModules());

  it('tanpa login 401; bukan admin 403', async () => {
    await setup({ user: null });
    expect((await (await import('./route')).POST(req({ aksi: 'cabut', id: ID }))).status).toBe(401);
    vi.resetModules();
    await setup({ role: 'front_office' });
    expect((await (await import('./route')).POST(req({ aksi: 'cabut', id: ID }))).status).toBe(403);
  });

  it('buat token -> 201 dengan data', async () => {
    await setup();
    const res = await (await import('./route')).POST(req({ aksi: 'buat', nama: ' Lobi ' }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.id).toBe(ID);
  });

  it('cabut berhasil (1 baris) -> ok, memakai aktif=false', async () => {
    const s = await setup();
    const res = await (await import('./route')).POST(req({ aksi: 'cabut', id: ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(s.dipanggil).toContain('update:{"aktif":false}');
  });

  it('cabut yang menyentuh 0 baris (id salah / ditolak RLS) = 404, BUKAN ok', async () => {
    const s = await setup({ update: { data: [] } });
    const res = await (await import('./route')).POST(req({ aksi: 'cabut', id: ID }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBeUndefined();
    expect(typeof body.error).toBe('string');
    expect(s.log).toHaveBeenCalledWith('warn', expect.objectContaining({ operation: 'admin.layar.cabut', kode: 'tidak_ada_baris' }));
  });

  it('cabut ditolak database (42501) = 403; gangguan database = 500; pesan teknis tidak bocor', async () => {
    await setup({ update: { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "layar_token"' } } });
    let res = await (await import('./route')).POST(req({ aksi: 'cabut', id: ID }));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('layar_token');

    vi.resetModules();
    const s = await setup({ update: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } });
    res = await (await import('./route')).POST(req({ aksi: 'cabut', id: ID }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('statement timeout');
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.layar.cabut', asalCode: '57014' }));
  });

  it('GET gagal: 500 pesan baku, pesan DB tidak bocor, detail dicatat', async () => {
    const s = await setup({ select: { data: null, error: { code: '42P01', message: 'relation "layar_token" secret-xyz' } } });
    const res = await (await import('./route')).GET();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret-xyz');
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.layar.daftar', asalCode: '42P01' }));
  });

  it('buat token gagal: 500 pesan baku, pesan DB tidak bocor, detail dicatat', async () => {
    const s = await setup({ insert: { data: null, error: { code: '23505', message: 'duplicate key layar_token_token_key secret-xyz' } } });
    const res = await (await import('./route')).POST(req({ aksi: 'buat', nama: 'Lobi' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret-xyz');
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.layar.buat', asalCode: '23505' }));
  });
});
