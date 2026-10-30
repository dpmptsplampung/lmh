// @vitest-environment node
// POST /api/saran (publik): pembatas zod, jebakan bot, pembatas laju, pemetaan hasil RPC.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));

import type { NextRequest } from 'next/server';

let ipKe = 0;
const req = (b: unknown, ip?: string) =>
  new Request('http://x/api/saran', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip ?? `10.0.0.${++ipKe}` },
    body: typeof b === 'string' ? b : JSON.stringify(b),
  }) as unknown as NextRequest;

async function muat() {
  vi.resetModules();
  return (await import('./route')).POST;
}

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/saran', () => {
  it('sukses 201 dan meneruskan isi + nama ke RPC', async () => {
    const POST = await muat();
    rpc.mockResolvedValue({ data: 'submitted', error: null });
    const res = await POST(req({ isi: '  Mohon tambah loket pelayanan  ', nama: ' Budi ' }));
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('kirim_saran_publik', { p_isi: 'Mohon tambah loket pelayanan', p_nama: 'Budi' });
  });

  it('nama kosong dikirim sebagai null (saran anonim)', async () => {
    const POST = await muat();
    rpc.mockResolvedValue({ data: 'submitted', error: null });
    await POST(req({ isi: 'Mohon tambah loket pelayanan' }));
    expect(rpc).toHaveBeenCalledWith('kirim_saran_publik', { p_isi: 'Mohon tambah loket pelayanan', p_nama: null });
  });

  it.each([
    [{ isi: 'pdk' }], [{ isi: '' }], [{ isi: 'x'.repeat(2001) }], [{ isi: 'cukup panjang', nama: 'n'.repeat(121) }],
    [{ isi: 'cukup panjang', ekstra: 1 }], ['bukan json'], [{}],
  ])('menolak input tidak valid %#', async (b) => {
    const POST = await muat();
    const res = await POST(req(b));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('jebakan bot: kolom website terisi dijawab 201 tetapi tidak disimpan', async () => {
    const POST = await muat();
    const res = await POST(req({ isi: 'promosi judi online murah', website: 'http://spam.example' }));
    expect(res.status).toBe(201);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('pembatas laju per IP: kiriman ke-6 dalam 10 menit ditolak 429', async () => {
    const POST = await muat();
    rpc.mockResolvedValue({ data: 'submitted', error: null });
    for (let i = 0; i < 5; i++) expect((await POST(req({ isi: 'saran nomor ' + i + ' ok' }, '9.9.9.9'))).status).toBe(201);
    expect((await POST(req({ isi: 'saran nomor enam' }, '9.9.9.9'))).status).toBe(429);
    expect((await POST(req({ isi: 'saran dari ip lain' }, '8.8.8.8'))).status).toBe(201);
  });

  it('RPC invalid -> 400; status tak dikenal dan galat database -> 500 tanpa membocorkan pesan', async () => {
    const POST = await muat();
    rpc.mockResolvedValue({ data: 'invalid', error: null });
    expect((await POST(req({ isi: 'saran yang cukup' }))).status).toBe(400);
    rpc.mockResolvedValue({ data: 'aneh', error: null });
    expect((await POST(req({ isi: 'saran yang cukup' }))).status).toBe(500);
    rpc.mockResolvedValue({ data: null, error: { message: 'koneksi rahasia-xyz putus', code: '08006' } });
    const res = await POST(req({ isi: 'saran yang cukup' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('rahasia-xyz');
  });
});
