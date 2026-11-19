// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@/lib/supabase/server';
import { PATCH } from './route';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const ID = '550e8400-e29b-41d4-a716-446655440000';
const body = { status: 'dihubungi', versi: 1 };
const request = (input: unknown = body) => new Request(`http://localhost/api/investasi/lead/${ID}`, {
  method: 'PATCH', body: JSON.stringify(input),
});
const context = (id = ID) => ({ params: Promise.resolve({ id }) });
const rpc = vi.fn();
const getUser = vi.fn();

describe('PATCH /api/investasi/lead/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rpc.mockImplementation(async (name: string) => name === 'boleh_kelola_investasi'
      ? { data: true, error: null }
      : { data: { id: ID, status: 'dihubungi', versi: 2 }, error: null });
    getUser.mockResolvedValue({ data: { user: { id: ID } }, error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser },
      rpc,
    } as unknown as Awaited<ReturnType<typeof createClient>>);
  });

  it('petugas modul investasi mengubah status dengan versi melalui RPC', async () => {
    const response = await PATCH(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: ID, status: 'dihubungi', versi: 2 } });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(rpc).toHaveBeenNthCalledWith(1, 'boleh_kelola_investasi');
    expect(rpc).toHaveBeenCalledWith('investasi_ubah_status_minat', {
      p_id: ID, p_status: 'dihubungi', p_versi: 1,
    });
  });

  it('tanpa sesi mengembalikan 401', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await PATCH(request(), context());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('LOGIN_DIPERLUKAN');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([false, null, 'true'])('menolak pengguna tanpa akses investasi: %s', async akses => {
    rpc.mockResolvedValue({ data: akses, error: null });
    const response = await PATCH(request(), context());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('DILARANG');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('galat pemeriksaan akses tidak diteruskan menjadi mutasi', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'internal' } });
    const response = await PATCH(request(), context());
    expect(response.status).toBe(500);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toContain('internal');
  });
  it.each([['42501', 403], ['PGRST301', 401], ['PGRST302', 401]])('pemeriksaan akses %s tertutup dengan %i', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'internal rahasia' } });
    const response = await PATCH(request(), context());
    expect(response.status).toBe(status);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(await response.text()).not.toContain('rahasia');
  });

  it.each([
    ['INPUT_TIDAK_VALID', 400], ['DILARANG', 403], ['TIDAK_DITEMUKAN', 404],
    ['KONFLIK_VERSI', 409], ['TERLALU_BANYAK', 429],
  ])('memetakan galat RPC perubahan status %s', async (code, status) => {
    rpc.mockImplementation(async (name: string) => name === 'boleh_kelola_investasi'
      ? { data: true, error: null } : { data: null, error: { message: code, code: 'P0001' } });
    const response = await PATCH(request(), context());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Retry-After')).toBe(status === 429 ? '60' : null);
  });

  it.each([
    { status: 'salah' }, { status: undefined }, { versi: undefined }, { versi: 0 },
    { versi: 1.5 }, { versi: '1' }, { petugas_id: ID },
  ])('menolak input status yang tidak sah: %j', async perubahan => {
    expect((await PATCH(request({ ...body, ...perubahan }), context())).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('menolak ID bukan UUID', async () => {
    expect((await PATCH(request(), context('salah'))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('menolak JSON rusak', async () => {
    const req = new Request(`http://localhost/api/investasi/lead/${ID}`, { method: 'PATCH', body: '{rusak' });
    expect((await PATCH(req, context())).status).toBe(400);
  });

  it('membatasi badan PATCH 16 KiB', async () => {
    const req = new Request(`http://localhost/api/investasi/lead/${ID}`, { method: 'PATCH', body: ' '.repeat(16385) });
    expect((await PATCH(req, context())).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('kegagalan koneksi menghasilkan 500 tanpa pesan internal', async () => {
    rpc.mockRejectedValue(new Error('internal private contact'));
    const response = await PATCH(request(), context());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private contact');
  });

  it('tidak mengirim sukses bila hasil mutasi kosong', async () => {
    rpc.mockImplementation(async (name: string) => name === 'boleh_kelola_investasi'
      ? { data: true, error: null } : { data: null, error: null });
    expect((await PATCH(request(), context())).status).toBe(500);
  });
});
