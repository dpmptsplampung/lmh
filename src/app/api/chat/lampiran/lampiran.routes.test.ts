// @vitest-environment node
// Lampiran foto live chat: presign, baca (404 seragam), dan kirim pesan dengan lampiran (POST /api/chat/messages).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SESI = '123e4567-e89b-12d3-a456-426614174000';
const LAIN = '223e4567-e89b-12d3-a456-426614174000';
const PENGUNJUNG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PESAN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UUID_OBJ = '99999999-9999-4999-8999-999999999999';

const h = vi.hoisted(() => ({
  user: { id: 'auth-1' } as { id: string } | null,
  pengunjungId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as string | null,
  sesi: null as Record<string, unknown> | null,
  pesan: null as Record<string, unknown> | null,
  insertPayload: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) }, rpc: vi.fn(), from: vi.fn() }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => {
      if (t === 'petugas') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      if (t === 'pengunjung') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.pengunjungId ? { id: h.pengunjungId } : null }) }) }) };
      if (t === 'chat_sesi') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.sesi }) }) }) };
      if (t === 'chat_pesan') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.pesan }) }) }),
          insert: (payload: Record<string, unknown>) => {
            h.insertPayload = payload;
            return { select: () => ({ single: async () => ({ data: { id: PESAN, ...payload }, error: null }) }) };
          },
        };
      }
      throw new Error(`tabel tak terduga ${t}`);
    },
  }),
}));
vi.mock('@/lib/storage/r2', () => ({
  r2Tersedia: vi.fn(() => true),
  presignPut: vi.fn(async () => 'https://r2.example/put'),
  headObject: vi.fn(),
  getObjectRange: vi.fn(),
  deleteObjects: vi.fn(async () => undefined),
  getObjectStream: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import * as r2 from '@/lib/storage/r2';
import { POST as presign } from './presign/route';
import { GET as baca } from './[pesanId]/route';
import { POST as kirimPesan } from '../messages/route';

const req = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  h.user = { id: 'auth-1' };
  h.pengunjungId = PENGUNJUNG;
  h.sesi = { id: SESI, status: 'bot', pengunjung_id: PENGUNJUNG, layanan_id: null, ditangani_oleh: null };
  h.pesan = null;
  h.insertPayload = null;
});

describe('POST /api/chat/lampiran/presign', () => {
  it('pemilik sesi -> 200 dengan kunci di bawah sesinya', async () => {
    const res = await presign(req({ sesi_id: SESI, mime: 'image/png', ukuran: 1000 }));
    expect(res.status).toBe(200);
    expect((await res.json()).kunci).toMatch(new RegExp(`^chat-lampiran/${SESI}/[0-9a-f-]{36}\\.png$`));
  });
  it('pengunjung lain -> 403', async () => {
    h.sesi = { ...h.sesi!, pengunjung_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
    expect((await presign(req({ sesi_id: SESI, mime: 'image/png', ukuran: 1000 }))).status).toBe(403);
  });
  it('gif, >5 MB, dan sesi selesai ditolak', async () => {
    expect((await presign(req({ sesi_id: SESI, mime: 'image/gif', ukuran: 1000 }))).status).toBe(400);
    expect((await presign(req({ sesi_id: SESI, mime: 'image/png', ukuran: 5 * 1024 * 1024 + 1 }))).status).toBe(400);
    h.sesi = { ...h.sesi!, status: 'selesai' };
    expect((await presign(req({ sesi_id: SESI, mime: 'image/png', ukuran: 10 }))).status).toBe(409);
  });
});

describe('GET /api/chat/lampiran/[pesanId]', () => {
  const panggil = (id = PESAN) => baca({} as NextRequest, { params: Promise.resolve({ pesanId: id }) });
  it('pesan tak ada, tanpa lampiran, atau sesi milik orang lain -> 404 seragam', async () => {
    h.pesan = null;
    const a = await panggil();
    h.pesan = { sesi_id: SESI, lampiran_kunci: null, lampiran_mime: null };
    const b = await panggil();
    h.pesan = { sesi_id: SESI, lampiran_kunci: `chat-lampiran/${SESI}/${UUID_OBJ}.png`, lampiran_mime: 'image/png' };
    h.sesi = { ...h.sesi!, pengunjung_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
    const c = await panggil();
    expect([a.status, b.status, c.status]).toEqual([404, 404, 404]);
    expect(await a.text()).toBe(await c.text());
    expect(r2.getObjectStream).not.toHaveBeenCalled();
  });
  it('pemilik sesi: stream dengan no-store dan tipe dari DB', async () => {
    h.pesan = { sesi_id: SESI, lampiran_kunci: `chat-lampiran/${SESI}/${UUID_OBJ}.png`, lampiran_mime: 'image/png' };
    (r2.getObjectStream as ReturnType<typeof vi.fn>).mockResolvedValue({ stream: new Response('x').body, contentType: 'application/octet-stream', contentLength: 1 });
    const res = await panggil();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
});

describe('POST /api/chat/messages dengan lampiran', () => {
  const lampiran = { kunci: `chat-lampiran/${SESI}/${UUID_OBJ}.png`, mime: 'image/png', ukuran: 100, nama: 'C:\\foto\\a.png' };
  const kirim = (b: Record<string, unknown>) => kirimPesan(req({ sesi_id: SESI, ...b }));
  const objekSah = () => {
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 100, contentType: 'image/png' });
    (r2.getObjectRange as ReturnType<typeof vi.fn>).mockResolvedValue(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0));
  };

  it('pesan hanya-lampiran (isi kosong) -> 201 dan kolom lampiran tersimpan, nama dibersihkan', async () => {
    objekSah();
    const res = await kirim({ isi: '', lampiran });
    expect(res.status).toBe(201);
    expect(h.insertPayload).toMatchObject({ isi: '', lampiran_kunci: lampiran.kunci, lampiran_mime: 'image/png', lampiran_ukuran: 100, lampiran_nama: 'a.png' });
  });
  it('isi kosong tanpa lampiran -> 400', async () => {
    expect((await kirim({ isi: '   ' })).status).toBe(400);
  });
  it('kunci milik sesi lain -> 400 tanpa menyentuh R2', async () => {
    const res = await kirim({ isi: '', lampiran: { ...lampiran, kunci: `chat-lampiran/${LAIN}/${UUID_OBJ}.png` } });
    expect(res.status).toBe(400);
    expect(r2.headObject).not.toHaveBeenCalled();
  });
  it('objek tidak ada -> 400; ukuran/magic bytes tidak cocok -> objek dihapus dan 422', async () => {
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await kirim({ isi: '', lampiran })).status).toBe(400);
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 100, contentType: 'image/png' });
    (r2.getObjectRange as ReturnType<typeof vi.fn>).mockResolvedValue(new TextEncoder().encode('<html>......'));
    expect((await kirim({ isi: '', lampiran })).status).toBe(422);
    expect(r2.deleteObjects).toHaveBeenCalledWith('private', [lampiran.kunci]);
    expect(h.insertPayload).toBeNull();
  });
});
