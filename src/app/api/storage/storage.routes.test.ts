// @vitest-environment node
// POST /api/storage/presign dan /konfirmasi: izin per peran, validasi aturan area, pemeriksaan magic bytes.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({
  r2Tersedia: vi.fn(() => true),
  presignPut: vi.fn(async () => 'https://r2.example/put'),
  headObject: vi.fn(),
  getObjectRange: vi.fn(),
  deleteObjects: vi.fn(async () => undefined),
  urlPublik: (k: string) => `https://pub.example.org/${k}`,
}));

import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as r2 from '@/lib/storage/r2';
import { POST as presign } from './presign/route';
import { POST as konfirmasi } from './konfirmasi/route';

const req = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest;

function masuk(role: string | null, user: { id: string } | null = { id: 'u1' }) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role, aktif: true } : null }) }) }) }),
  });
}

const ok = { area: 'absensi-foto', path: '2026-11-02/p1_1.jpg', mime: 'image/jpeg', ukuran: 1000 };

describe('POST /api/storage/presign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tanpa sesi -> 401', async () => {
    masuk(null, null);
    expect((await presign(req(ok))).status).toBe(401);
  });
  it('petugas ke absensi-foto -> 403', async () => {
    masuk('petugas');
    expect((await presign(req(ok))).status).toBe(403);
  });
  it('front_office sukses', async () => {
    masuk('front_office');
    const res = await presign(req(ok));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.kunci).toBe('absensi-foto/2026-11-02/p1_1.jpg');
    expect(j.uploadUrl).toBe('https://r2.example/put');
    expect(r2.presignPut).toHaveBeenCalledWith('private', j.kunci, { contentType: 'image/jpeg', contentLength: 1000 });
  });
  it('mime salah, terlalu besar, path jahat, area chat-lampiran -> 400', async () => {
    masuk('front_office');
    expect((await presign(req({ ...ok, mime: 'text/html' }))).status).toBe(400);
    expect((await presign(req({ ...ok, ukuran: 5 * 1024 * 1024 + 1 }))).status).toBe(400);
    expect((await presign(req({ ...ok, path: '../x' }))).status).toBe(400);
    expect((await presign(req({ ...ok, area: 'chat-lampiran' }))).status).toBe(400);
  });
});

describe('POST /api/storage/konfirmasi', () => {
  beforeEach(() => vi.clearAllMocks());
  const body = { area: 'absensi-foto', path: '2026-11-02/p1_1.jpg' };

  it('objek tidak ada -> 404', async () => {
    masuk('front_office');
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await konfirmasi(req(body))).status).toBe(404);
  });
  it('magic bytes tidak cocok -> objek dihapus dan 422', async () => {
    masuk('front_office');
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 100, contentType: 'image/jpeg' });
    (r2.getObjectRange as ReturnType<typeof vi.fn>).mockResolvedValue(new TextEncoder().encode('<html>'));
    expect((await konfirmasi(req(body))).status).toBe(422);
    expect(r2.deleteObjects).toHaveBeenCalledWith('private', ['absensi-foto/2026-11-02/p1_1.jpg']);
  });
  it('berkas sah -> 200', async () => {
    masuk('front_office');
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 100, contentType: 'image/jpeg' });
    (r2.getObjectRange as ReturnType<typeof vi.fn>).mockResolvedValue(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0));
    const res = await konfirmasi(req(body));
    expect(res.status).toBe(200);
    expect((await res.json()).kunci).toBe('absensi-foto/2026-11-02/p1_1.jpg');
  });
  it('area publik mengembalikan url', async () => {
    masuk('petugas');
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 100, contentType: 'image/jpeg' });
    (r2.getObjectRange as ReturnType<typeof vi.fn>).mockResolvedValue(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0));
    const res = await konfirmasi(req({ area: 'umkm-photos', path: 'a.jpg' }));
    expect((await res.json()).url).toBe('https://pub.example.org/umkm-photos/a.jpg');
  });
});
