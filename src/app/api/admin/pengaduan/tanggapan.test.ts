// @vitest-environment node
// POST /api/admin/pengaduan/[id]/tanggapan dan GET /api/pengaduan/lampiran.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '11111111-1111-4111-8111-111111111111';
const OBJ = '99999999-9999-4999-8999-999999999999';
const h = vi.hoisted(() => ({ role: 'front_office' as string | null, rpc: vi.fn(), user: { id: 'u' } as { id: string } | null, svcRpc: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.role ? { role: h.role, aktif: true } : null }) }) }) }),
    rpc: h.rpc,
  }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: h.svcRpc }) }));
vi.mock('@/lib/storage/r2', () => ({
  r2Tersedia: () => true, headObject: vi.fn(), getObjectRange: vi.fn(), deleteObjects: vi.fn(async () => undefined), getObjectStream: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import * as r2 from '@/lib/storage/r2';
import { POST } from './[id]/tanggapan/route';
import { GET } from '../../pengaduan/lampiran/route';

const kirim = (b: unknown, id = ID) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }) as unknown as NextRequest, { params: Promise.resolve({ id }) });
const lamp = { kunci: `pengaduan-bukti/${ID}/${OBJ}.pdf`, nama: 'surat.pdf', mime: 'application/pdf', ukuran: 100 };
const objekSah = () => {
  (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 100, contentType: 'application/pdf' });
  (r2.getObjectRange as ReturnType<typeof vi.fn>).mockResolvedValue(new TextEncoder().encode('%PDF-1.7....'));
};

beforeEach(() => {
  vi.clearAllMocks();
  h.role = 'front_office'; h.user = { id: 'u' };
  h.rpc.mockResolvedValue({ data: 'tid', error: null });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
});

describe('POST tanggapan', () => {
  it('petugas -> 403; tanpa sesi -> 401; isi kosong -> 400', async () => {
    h.role = 'petugas';
    expect((await kirim({ isi: 'x' })).status).toBe(403);
    h.user = null;
    expect((await kirim({ isi: 'x' })).status).toBe(401);
    h.user = { id: 'u' }; h.role = 'admin';
    expect((await kirim({ isi: '  ' })).status).toBe(400);
  });
  it('teks saja -> RPC dipanggil dengan status, email, dan lampiran kosong', async () => {
    const res = await kirim({ isi: 'Sudah ditindaklanjuti', status: 'selesai', kirim_email: true });
    expect(res.status).toBe(201);
    expect(h.rpc).toHaveBeenCalledWith('tanggapi_pengaduan', { p_pengaduan_id: ID, p_isi: 'Sudah ditindaklanjuti', p_status: 'selesai', p_kirim_email: true, p_lampiran: [] });
  });
  it('lampiran milik pengaduan lain -> 400 tanpa RPC', async () => {
    const res = await kirim({ isi: 'x', lampiran: [{ ...lamp, kunci: `pengaduan-bukti/${'2'.repeat(8)}-2222-4222-8222-222222222222/${OBJ}.pdf` }] });
    expect(res.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('magic bytes salah -> objek dihapus, 422', async () => {
    (r2.headObject as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 100, contentType: 'application/pdf' });
    (r2.getObjectRange as ReturnType<typeof vi.fn>).mockResolvedValue(new TextEncoder().encode('<html>......'));
    expect((await kirim({ isi: 'x', lampiran: [lamp] })).status).toBe(422);
    expect(r2.deleteObjects).toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it('RPC gagal -> berkas terunggah dihapus', async () => {
    objekSah();
    h.rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    expect((await kirim({ isi: 'x', lampiran: [lamp] })).status).toBe(500);
    expect(r2.deleteObjects).toHaveBeenCalledWith('private', [lamp.kunci]);
  });
  it('lampiran sah -> 201 dan diteruskan ke RPC', async () => {
    objekSah();
    expect((await kirim({ isi: 'x', lampiran: [lamp] })).status).toBe(201);
    expect(h.rpc.mock.calls[0][1].p_lampiran).toEqual([lamp]);
  });
});

describe('GET /api/pengaduan/lampiran', () => {
  const ambil = (q: string) => { const u = new URL(`http://x/api/pengaduan/lampiran?${q}`); const r = new Request(u); (r as unknown as { nextUrl: URL }).nextUrl = u; return GET(r as unknown as NextRequest); };
  it('nomor salah -> 404 seragam', async () => {
    h.svcRpc.mockResolvedValue({ data: [], error: null });
    expect((await ambil(`nomor=PABCDEFGH&id=${OBJ}`)).status).toBe(404);
    expect((await ambil('nomor=x')).status).toBe(404);
  });
  it('sukses: attachment, nama dibersihkan', async () => {
    h.svcRpc.mockResolvedValue({ data: [{ kunci: 'pengaduan-bukti/a/b.pdf', nama_asli: 'su"rat\r\n.pdf', mime: 'application/pdf' }], error: null });
    (r2.getObjectStream as ReturnType<typeof vi.fn>).mockResolvedValue({ stream: new Response('x').body, contentType: 'x', contentLength: 1 });
    const res = await ambil(`nomor=PABCDEFGH&id=${OBJ}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="su_rat__.pdf"');
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
  });
});
