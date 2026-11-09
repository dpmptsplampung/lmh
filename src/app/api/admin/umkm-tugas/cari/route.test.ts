// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

const cursor = '660e8400-e29b-41d4-a716-446655440001';
let rpc: ReturnType<typeof vi.fn>;
let user: { id: string } | null;
const request = (query = '?q=Kopi') => new Request(`http://localhost/api/admin/umkm-tugas/cari${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: 'pemeriksa' };
  rpc = vi.fn().mockResolvedValue({ data: { items: [], next_cursor: null }, error: null });
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) }, rpc,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
});

describe('pencarian profil melalui JWT pemeriksa', () => {
  it('meneruskan q yang ditrim serta cursor dan memakai envelope privat', async () => {
    const items = [{ id: cursor, nama: 'Kopi Lampung', status: 'disembunyikan' }];
    rpc.mockResolvedValue({ data: { items, next_cursor: cursor }, error: null });
    const res = await GET(request(`?q=%20Kopi%20&cursor=${cursor}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(rpc).toHaveBeenCalledWith('umkm_cari_profil', { p_q: 'Kopi', p_cursor: cursor });
    expect(await res.json()).toEqual({
      data: { items, next_cursor: cursor }, meta: { request_id: expect.any(String), next_cursor: cursor },
    });
  });

  it('memakai cursor null serta mempertahankan wildcard sebagai teks literal', async () => {
    expect((await GET(request('?q=Kopi%25_'))).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('umkm_cari_profil', { p_q: 'Kopi%_', p_cursor: null });
  });

  it.each(['', '?q=', '?q=%20x%20', `?q=${'x'.repeat(201)}`, '?q=Kopi&cursor=rusak',
    '?q=Kopi&cursor=', '?q=Kopi&nomor=rahasia'])('menolak query tidak valid %s', async query => {
    const res = await GET(request(query));
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await res.json()).error.code).toBe('INPUT_TIDAK_VALID');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('memeriksa sesi sebelum RPC', async () => {
    user = null;
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('LOGIN_DIPERLUKAN');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['42501', 'DILARANG', 403, 'DILARANG'],
    ['PGRST202', 'missing', 503, 'MODUL_BELUM_TERSEDIA'],
    ['22023', 'INPUT_TIDAK_VALID', 400, 'INPUT_TIDAK_VALID'],
    ['XX000', '081234567890', 500, 'GAGAL_INTERNAL'],
  ])('memetakan galat %s tanpa meneruskan pesan privat', async (code, message, status, expected) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } });
    const res = await GET(request());
    expect(res.status).toBe(status);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: expected }, request_id: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('081234567890');
  });
});
