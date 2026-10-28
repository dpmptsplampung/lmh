// @vitest-environment node
// POST /api/survei/saran dan /api/survei/pengaduan: pembatas zod di depan RPC, pemetaan status.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));

import type { NextRequest } from 'next/server';
import { POST as saran } from './saran/route';
import { POST as pengaduan } from './pengaduan/route';

const TOKEN = 'a'.repeat(64);
const req = (b: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(b) }) as unknown as NextRequest;
const ok = { token: TOKEN, isi: 'Mohon tambah loket', anonim: true };

beforeEach(() => rpc.mockReset());

describe('POST /api/survei/saran', () => {
  it('sukses 201 dan meneruskan parameter', async () => {
    rpc.mockResolvedValue({ data: 'submitted', error: null });
    expect((await saran(req(ok))).status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('kirim_saran', { p_token: TOKEN, p_isi: 'Mohon tambah loket', p_anonim: true });
  });
  it.each([
    [{ ...ok, isi: '' }], [{ ...ok, isi: 'x'.repeat(2001) }], [{ ...ok, anonim: 'ya' }], [{ ...ok, token: 'pendek' }], [{ ...ok, ekstra: 1 }],
  ])('menolak input tidak valid %#', async (b) => {
    expect((await saran(req(b))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([['duplicate', 409], ['expired', 410], ['not_found', 404], ['belum_survei', 409], ['invalid', 400]])('status %s -> %i', async (s, kode) => {
    rpc.mockResolvedValue({ data: s, error: null });
    expect((await saran(req(ok))).status).toBe(kode);
  });
  it('status tak dikenal -> 500', async () => {
    rpc.mockResolvedValue({ data: 'aneh', error: null });
    expect((await saran(req(ok))).status).toBe(500);
  });
});

describe('POST /api/survei/pengaduan', () => {
  it('sukses 201 membawa nomor laporan', async () => {
    rpc.mockResolvedValue({ data: { hasil: 'submitted', nomor: 'PABCDEFGH' }, error: null });
    const res = await pengaduan(req({ ...ok, anonim: false }));
    expect(res.status).toBe(201);
    expect((await res.json()).nomor).toBe('PABCDEFGH');
    expect(rpc).toHaveBeenCalledWith('kirim_pengaduan_survei', { p_token: TOKEN, p_isi: 'Mohon tambah loket', p_anonim: false });
  });
  it('duplicate -> 409; tanpa nomor -> 500', async () => {
    rpc.mockResolvedValue({ data: { hasil: 'duplicate' }, error: null });
    expect((await pengaduan(req(ok))).status).toBe(409);
    rpc.mockResolvedValue({ data: { hasil: 'submitted' }, error: null });
    expect((await pengaduan(req(ok))).status).toBe(500);
  });
});
