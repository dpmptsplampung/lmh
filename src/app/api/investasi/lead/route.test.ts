// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { POST } from './route';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const ID = '550e8400-e29b-41d4-a716-446655440000';
const body = {
  doc_id: ID, nama: 'Budi Investor', email: 'budi@example.com',
  pesan: 'Mohon informasi dokumen.', setuju_pdp: true, operasi_id: ID,
};
const request = (input: unknown = body) => new Request('http://localhost/api/investasi/lead', {
  method: 'POST', body: JSON.stringify(input),
});
const rpc = vi.fn();
const getUser = vi.fn();

describe('POST /api/investasi/lead', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rpc.mockResolvedValue({ data: { id: ID }, error: null });
    getUser.mockResolvedValue({ data: { user: { id: ID, is_anonymous: true } }, error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser },
      rpc,
    } as unknown as Awaited<ReturnType<typeof createClient>>);
  });

  it('mencatat kanal dokumen lewat RPC dengan sesi anonim', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: ID } });
    expect(rpc).toHaveBeenCalledWith('investasi_kirim_minat', {
      p_kanal: 'dokumen', p_ref_id: ID, p_nama: body.nama, p_email: body.email,
      p_no_hp: null, p_instansi: null, p_pesan: body.pesan,
      p_setuju_pdp: true, p_versi_kebijakan: '1.1', p_operasi_id: ID,
    });
  });

  it('pesan dokumen opsional dan instansi diteruskan', async () => {
    const response = await POST(request({ ...body, pesan: undefined, instansi: 'PT Maju' }));
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(rpc).toHaveBeenCalledWith('investasi_kirim_minat', expect.objectContaining({
      p_kanal: 'dokumen', p_pesan: null, p_instansi: 'PT Maju',
    }));
  });

  it('honeypot tidak menyimpan minat dokumen', async () => {
    const response = await POST(request({ ...body, situs_web: 'spam.example.com' }));
    expect(response.status).toBe(201);
    expect((await response.json()).data.id).not.toBe(ID);
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(logServerEvent).toHaveBeenCalledExactlyOnceWith('info', { operation: 'investasi.honeypot' });
  });

  it('tanpa sesi mengembalikan 401', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('LOGIN_DIPERLUKAN');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    { setuju_pdp: undefined }, { setuju_pdp: false }, { operasi_id: undefined },
    { minat: 'kontrak lama' }, { catatan: 'kontrak lama' }, { doc_id: 'salah' },
  ])('menolak input di luar kontrak baru: %j', async perubahan => {
    expect((await POST(request({ ...body, ...perubahan }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['TIDAK_DITEMUKAN', 404], ['KONFLIK_OPERASI', 409], ['TERLALU_BANYAK', 429],
  ])('meneruskan galat konteks/rate/idempotensi dari RPC %s', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { message: code, code: 'P0001' } });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(response.headers.get('Retry-After')).toBe(status === 429 ? '60' : null);
  });
});
