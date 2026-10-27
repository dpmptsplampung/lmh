import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ callerId: 'auth-1' as string | null, anonim: false, rpc: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: state.callerId ? { id: state.callerId, is_anonymous: state.anonim } : null }, error: null })) },
    rpc: state.rpc,
    from: () => {
      throw new Error('route tidak boleh membaca/menulis tabel langsung');
    },
  })),
}));
const serviceCreate = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient: serviceCreate }));

const SESI = '3f2504e0-4f89-41d3-8a0c-0305e82c3301';

async function panggil(body: unknown) {
  const { POST } = await import('./route');
  return POST(
    new NextRequest('http://localhost/api/chat/petugas', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}
const galat = (message: string, code = 'P0001') => ({ data: null, error: { message, code } });

describe('POST /api/chat/petugas', () => {
  beforeEach(() => {
    vi.resetModules();
    state.callerId = 'auth-1';
    state.anonim = false;
    state.rpc.mockReset();
    serviceCreate.mockReset();
  });

  it('401 tanpa login; JSON rusak 400; body tak valid 422 — RPC tidak dipanggil', async () => {
    state.callerId = null;
    expect((await panggil({ sesi_id: SESI })).status).toBe(401);
    state.callerId = 'auth-1';
    expect((await panggil('{x')).status).toBe(400);
    expect((await panggil({ sesi_id: 'x' })).status).toBe(422);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('memanggil chat_minta_petugas dengan argumen persis dan meneruskan hasilnya', async () => {
    const hasil = { ok: true, noop: false, buka: false, status: 'eskalasi', sudah_diminta: false, penerima: 2, pesan: { id: 'm1', isi: 'x' } };
    state.rpc.mockResolvedValue({ data: hasil, error: null });
    const res = await panggil({ sesi_id: SESI });
    expect(res.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('chat_minta_petugas', { p_sesi_id: SESI, p_eksplisit: true });
    expect(await res.json()).toEqual(hasil);
    expect(serviceCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['FORBIDDEN: bukan milik Anda', '42501', 403],
    ['NOT_FOUND: sesi tidak ada', 'P0002', 404],
    ['INVALID_STATUS: selesai', 'P0001', 409],
    ['LAYANAN_TIDAK_VALID: x', '22023', 422],
    ['RATE_LIMIT: terlalu banyak', 'P0001', 429],
    ['LOGIN_GOOGLE: hanya Google', '42501', 403],
    ['PESAN_WAJIB: tulis dulu', 'P0001', 422],
  ])('galat %s -> HTTP %i', async (pesan, code, status) => {
    state.rpc.mockResolvedValue(galat(pesan, code));
    const res = await panggil({ sesi_id: SESI });
    expect(res.status).toBe(status);
    expect((await res.json()).kode).toBe(pesan.split(':')[0]);
  });

  it('A3: akun anonim ditolak di server (403 LOGIN_GOOGLE) tanpa memanggil RPC', async () => {
    state.anonim = true;
    const res = await panggil({ sesi_id: SESI });
    expect(res.status).toBe(403);
    expect((await res.json()).kode).toBe('LOGIN_GOOGLE');
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('fungsi belum ada (PGRST202) -> 409 MIGRASI_BELUM_DITERAPKAN agar klien turun ke jalur lama', async () => {
    state.rpc.mockResolvedValue(galat('Could not find the function', 'PGRST202'));
    const res = await panggil({ sesi_id: SESI });
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('MIGRASI_BELUM_DITERAPKAN');
  });

  it('galat tak dikenal atau balasan tanpa ok -> 500 tanpa membocorkan detail', async () => {
    state.rpc.mockResolvedValue(galat('duplicate key secret detail', '23505'));
    const res = await panggil({ sesi_id: SESI });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret');
    state.rpc.mockResolvedValue({ data: { ok: false }, error: null });
    expect((await panggil({ sesi_id: SESI })).status).toBe(500);
  });
});
