// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ r2Tersedia: () => true, bucketTerpisah: () => true,
  presignPut: vi.fn(async () => 'https://private.example/put'),
  headObject: vi.fn(async () => ({ size: 100, contentType: 'image/jpeg' })),
  getObjectRange: vi.fn(async () => Uint8Array.of(0xff, 0xd8, 0xff)),
  deleteObjects: vi.fn(), urlPublik: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { presignPut, headObject } from '@/lib/storage/r2';
import { POST as presign } from './presign/route';
import { POST as konfirmasi } from './konfirmasi/route';
const id = '660e8400-e29b-41d4-a716-446655440001';
const other = '660e8400-e29b-41d4-a716-446655440002';
let rpc: ReturnType<typeof vi.fn>;
const req = (path: string, sign: boolean) => new Request('https://lmh.example/api/storage', {
  method: 'POST', body: JSON.stringify({ area: 'umkm-draf', path,
    ...(sign ? { mime: 'image/jpeg', ukuran: 100 } : {}) }),
}) as NextRequest;
beforeEach(() => {
  vi.clearAllMocks();
  rpc = vi.fn(async (_name, args) => args?.p_profil_id === id
    ? { data: { diizinkan: true }, error: null } : { data: null, error: { code: '42501' } });
  vi.mocked(createClient).mockResolvedValue({ auth: {
    getUser: async () => ({ data: { user: { id } } }),
  }, rpc, from: () => ({ select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: null, error: null }),
  }) }) }) } as unknown as Awaited<ReturnType<typeof createClient>>);
});
it('pendaftar/pemilik memakai pemeriksaan RPC dan prefix profil pada unggah privat', async () => {
  const response = await presign(req(`${id}/foto.jpg`, true));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const body = await response.json();
  expect(body.kunci).toMatch(new RegExp(`^umkm-draf/${id}/[a-f0-9-]{36}\\.jpg$`));
  expect(body).not.toHaveProperty('url');
  expect(rpc).toHaveBeenCalledWith('umkm_akses_draf_pemilik', { p_profil_id: id });
});
it('prefix profil lain atau path tanpa profil ditolak sebelum menyentuh R2', async () => {
  for (const path of [`${other}/foto.jpg`, 'foto.jpg', `${id}/../foto.jpg`]) {
    for (const response of [await presign(req(path, true)), await konfirmasi(req(path, false))]) {
      expect(response.status).toBe(403);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }
  }
  expect(presignPut).not.toHaveBeenCalled();
  expect(headObject).not.toHaveBeenCalled();
});
it('konfirmasi mengulang hak akun dan mengembalikan kunci privat tanpa URL publik', async () => {
  const response = await konfirmasi(req(`${id}/foto.jpg`, false));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ kunci: `umkm-draf/${id}/foto.jpg` });
  expect(rpc).toHaveBeenCalledWith('umkm_akses_draf_pemilik', { p_profil_id: id });
  rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
  expect((await konfirmasi(req(`${id}/foto.jpg`, false))).status).toBe(403);
});
