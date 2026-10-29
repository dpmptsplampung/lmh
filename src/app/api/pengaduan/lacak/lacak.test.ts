// @vitest-environment node
// GET /api/pengaduan/lacak: nomor laporan Pesan Perilaku cukup dengan nomor; laporan lama tetap butuh kontak.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));

import type { NextRequest } from 'next/server';

const buat = (tiket: string, kontak?: string, ip = '9.9.9.9') => {
  const url = new URL('http://x/api/pengaduan/lacak');
  url.searchParams.set('tiket', tiket);
  if (kontak !== undefined) url.searchParams.set('kontak', kontak);
  const r = new Request(url, { headers: { 'x-forwarded-for': ip } });
  (r as unknown as { nextUrl: URL }).nextUrl = url;
  return r as unknown as NextRequest;
};

beforeEach(() => {
  rpc.mockReset();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
});

describe('GET /api/pengaduan/lacak', () => {
  it('nomor laporan (tanda hubung/huruf kecil) tanpa kontak -> lacak_pengaduan_nomor', async () => {
    const { GET } = await import('./route');
    rpc.mockResolvedValue({ data: [{ nomor_tiket: 'PABCDEFGH', status: 'baru', created_at: '2026-10-28T00:00:00Z' }], error: null });
    const res = await GET(buat('p-abcd-efgh', undefined, '1.1.1.1'));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('lacak_pengaduan_nomor', { p_nomor: 'PABCDEFGH' });
    expect((await res.json()).status).toBe('baru');
  });
  it('nomor lama tanpa kontak -> 400 tanpa menyentuh DB', async () => {
    const { GET } = await import('./route');
    const res = await GET(buat('PK7M2N', '', '2.2.2.2'));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('nomor lama + kontak -> lacak_pengaduan; tidak ditemukan -> 404 seragam', async () => {
    const { GET } = await import('./route');
    rpc.mockResolvedValue({ data: [], error: null });
    const res = await GET(buat('PK7M2N', 'a@b.id', '3.3.3.3'));
    expect(rpc).toHaveBeenCalledWith('lacak_pengaduan', { p_tiket: 'PK7M2N', p_kontak: 'a@b.id' });
    expect(res.status).toBe(404);
  });
});
