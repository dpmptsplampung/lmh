// @vitest-environment node
// POST /api/pengaduan (publik, tanpa login): RPC buat_pengaduan lewat service role.
// Audit T2d (No 110): RPC yang "sukses tanpa baris" tak boleh dijawab 201 tanpa nomor tiket, dan galat teknis database
// tak boleh dibocorkan ke klien publik (hanya pesan validasi RAISE EXCEPTION yang memang ditulis untuk pengguna).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import type { NextRequest } from 'next/server';

const buildRequest = (body: unknown): NextRequest => {
  const req = new Request('http://localhost/api/pengaduan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return req as unknown as NextRequest;
};

const VALID = {
  jalur: 'layanan',
  isi: 'Pelayanan loket terlalu lambat dan tidak ada kejelasan.',
  kontak: '081234567890',
};

interface RpcResult {
  data: unknown;
  error: { message: string; code?: string; details?: string } | null;
}

async function setup(rpcResult: RpcResult) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const sb = await import('@supabase/supabase-js');
  (sb.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc });
  return { rpc };
}

describe('POST /api/pengaduan', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
      .find((e: Record<string, unknown> | null) => e?.operation === 'pengaduan.buat');

  it('berhasil: 201 dengan nomor tiket dan parameter RPC lengkap', async () => {
    const { rpc } = await setup({ data: [{ id: 'p-1', nomor_tiket: 'PGD-2026-0001' }], error: null });
    const res = await (await import('./route')).POST(buildRequest(VALID));

    expect(res.status).toBe(201);
    expect((await res.json()).nomor_tiket).toBe('PGD-2026-0001');
    expect(rpc).toHaveBeenCalledWith(
      'kirim_pengaduan_publik',
      expect.objectContaining({ p_jalur: 'layanan', p_kontak: '081234567890', p_anonim: false }),
    );
  });

  it('anonim sungguhan: kontak yang terlanjur terkirim dari klien DIBUANG sebelum ke RPC', async () => {
    const { rpc } = await setup({ data: [{ id: 'p-1', nomor_tiket: 'PABCDEFGH' }], error: null });
    const res = await (await import('./route')).POST(buildRequest({ ...VALID, anonim: true }));

    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('kirim_pengaduan_publik', expect.objectContaining({ p_anonim: true, p_kontak: null }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('081234567890');
  });

  it('nomor laporan baru (P + 8 karakter) memberi tanda boleh dipantau hanya dengan nomor; nomor lama tidak', async () => {
    await setup({ data: [{ id: 'p-1', nomor_tiket: 'PABCDEFGH' }], error: null });
    expect((await (await (await import('./route')).POST(buildRequest(VALID))).json()).lacak_dengan_nomor).toBe(true);

    vi.resetModules();
    await setup({ data: [{ id: 'p-1', nomor_tiket: 'ABC123' }], error: null });
    expect((await (await (await import('./route')).POST(buildRequest(VALID))).json()).lacak_dengan_nomor).toBe(false);
  });

  it.each(['PGRST202', '42883'])('migrasi 202611030008 belum ada (%s): jatuh ke buat_pengaduan, anonim tetap tanpa kontak', async (code) => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'function not found', code } })
      .mockResolvedValueOnce({ data: [{ id: 'p-1', nomor_tiket: 'LAMA01' }], error: null });
    const sb = await import('@supabase/supabase-js');
    (sb.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc });

    const res = await (await import('./route')).POST(buildRequest({ ...VALID, anonim: true }));

    expect(res.status).toBe(201);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(['kirim_pengaduan_publik', 'buat_pengaduan']);
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_anonim: true, p_kontak: null });
  });

  it('validasi RPC (RAISE EXCEPTION, P0001): 400 dengan pesan validasi yang memang untuk pengguna', async () => {
    await setup({ data: null, error: { message: 'kontak diperlukan untuk pelacakan (atau pilih anonim)', code: 'P0001' } });
    const res = await (await import('./route')).POST(buildRequest(VALID));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('kontak diperlukan untuk pelacakan (atau pilih anonim)');
    expect(log()).toBeUndefined();
  });

  it('layanan_id tidak ada (FK 23503): 400 pesan baku, tanpa nama konstrain', async () => {
    await setup({
      data: null,
      error: { message: 'insert or update on table "pengaduan" violates foreign key constraint "pengaduan_layanan_id_fkey"', code: '23503' },
    });
    const res = await (await import('./route')).POST(buildRequest({ ...VALID, layanan_id: '550e8400-e29b-41d4-a716-446655440000' }));

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toMatch(/constraint|fkey|pengaduan_layanan/);
  });

  it('galat teknis database: 500 pesan baku TANPA pesan database mentah; dicatat dengan kode', async () => {
    await setup({ data: null, error: { message: 'connection reset secret-xyz', code: '08006' } });
    const res = await (await import('./route')).POST(buildRequest(VALID));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Gagal menyimpan pengaduan');
    expect(JSON.stringify(json)).not.toContain('secret-xyz');
    expect(log()).toMatchObject({ kode: 'database', asalCode: '08006' });
    expect(JSON.stringify(log())).not.toContain('secret-xyz');
  });

  it('RPC sukses tetapi tanpa baris/nomor tiket: 500, BUKAN 201 "simpan nomor tiket" tanpa nomor', async () => {
    await setup({ data: [], error: null });
    const res = await (await import('./route')).POST(buildRequest(VALID));

    expect(res.status).toBe(500);
    expect(log()).toMatchObject({ kode: 'tidak_ada_baris' });
  });

  it('input tidak valid: 400 tanpa memanggil RPC', async () => {
    const { rpc } = await setup({ data: [], error: null });
    const res = await (await import('./route')).POST(buildRequest({ ...VALID, isi: 'pendek' }));

    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
