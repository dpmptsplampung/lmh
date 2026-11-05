// @vitest-environment node
// Rute aksi penangan/linimasa pengaduan: hanya Admin dan Front Office aktif; galat RPC dipetakan ke status HTTP yang jelas.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const ID = '11111111-2222-4333-8444-555555555555';
const ctx = { params: Promise.resolve({ id: ID }) };
const req = (body?: unknown) =>
  new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as unknown as NextRequest;

async function pasang(role: string | null, rpc: ReturnType<typeof vi.fn>, aktif = true) {
  const { createClient } = await import('@/lib/supabase/server');
  const petugas = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: role ? { role, aktif } : null }),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: role === null && !aktif ? null : { id: 'u' } } }) },
    from: vi.fn(() => petugas),
    rpc,
  });
}

describe('pengaduan: tangani, ambil alih, linimasa', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it.each([['petugas'], ['front_office'], ['admin']])('tangani oleh %s', async (role) => {
    const rpc = vi.fn().mockResolvedValue({ data: { penangan_id: 'p1', penangan_nama: 'Sari' }, error: null });
    await pasang(role, rpc);
    const { POST } = await import('./[id]/tangani/route');
    const res = await POST(req(), ctx);
    if (role === 'petugas') {
      expect(res.status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    } else {
      expect(res.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith('tangani_pengaduan', { p_pengaduan_id: ID });
      expect((await res.json()).penangan.penangan_nama).toBe('Sari');
    }
  });

  it('tanpa sesi = 401; id bukan UUID = 404 tanpa memanggil RPC', async () => {
    const rpc = vi.fn();
    await pasang(null, rpc, false);
    const { POST } = await import('./[id]/tangani/route');
    expect((await POST(req(), ctx)).status).toBe(401);
    const bad = await POST(req(), { params: Promise.resolve({ id: 'bukan-uuid' }) });
    expect(bad.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('tangani: penangan sudah ada = 409 dengan nama penangan; ditutup = 409; 42501 = 403', async () => {
    const { POST } = await import('./[id]/tangani/route');
    for (const [galat, status, kode] of [
      [{ code: 'P0001', message: 'PENANGAN_SUDAH_ADA', details: 'Sari' }, 409, 'PENANGAN_SUDAH_ADA'],
      [{ code: 'P0001', message: 'PENGADUAN_DITUTUP' }, 409, 'PENGADUAN_DITUTUP'],
      [{ code: '42501', message: 'FORBIDDEN: bukan Admin atau Front Office' }, 403, undefined],
    ] as const) {
      await pasang('front_office', vi.fn().mockResolvedValue({ data: null, error: galat }));
      const res = await POST(req(), ctx);
      expect(res.status).toBe(status);
      const json = await res.json();
      if (kode) expect(json.kode).toBe(kode);
      if (kode === 'PENANGAN_SUDAH_ADA') expect(json.penangan_nama).toBe('Sari');
    }
  });

  it('ambil alih tanpa penangan (PENANGAN_KOSONG) = 409; alasan ditolak DB (22023) = 400; tidak ditemukan = 404', async () => {
    const { POST } = await import('./[id]/ambil-alih/route');
    for (const [galat, status] of [
      [{ code: '55000', message: 'PENANGAN_KOSONG: gunakan tangani_pengaduan' }, 409],
      [{ code: '22023', message: 'ALASAN_WAJIB: minimal 5 karakter' }, 400],
      [{ code: 'P0002', message: 'TIDAK_DITEMUKAN: pengaduan' }, 404],
    ] as const) {
      await pasang('admin', vi.fn().mockResolvedValue({ data: null, error: galat }));
      expect((await POST(req({ alasan: 'alasan sah' }), ctx)).status).toBe(status);
    }
  });

  it('migrasi belum diterapkan (PGRST202) = 409 dengan kode MIGRASI_BELUM_DITERAPKAN', async () => {
    await pasang('admin', vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'no function' } }));
    const { POST } = await import('./[id]/tangani/route');
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('MIGRASI_BELUM_DITERAPKAN');
  });

  it('ambil alih: alasan wajib 5 sampai 500 karakter; petugas ditolak', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { penangan_nama: 'Budi' }, error: null });
    await pasang('front_office', rpc);
    const { POST } = await import('./[id]/ambil-alih/route');
    expect((await POST(req({ alasan: 'abc' }), ctx)).status).toBe(400);
    expect((await POST(req({}), ctx)).status).toBe(400);
    expect((await POST(req({ alasan: 'x'.repeat(501) }), ctx)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    const ok = await POST(req({ alasan: '  Penangan sedang cuti  ' }), ctx);
    expect(ok.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('ambil_alih_pengaduan', { p_pengaduan_id: ID, p_alasan: 'Penangan sedang cuti' });

    await pasang('petugas', rpc);
    vi.resetModules();
    const { POST: p2 } = await import('./[id]/ambil-alih/route');
    expect((await p2(req({ alasan: 'alasan sah' }), ctx)).status).toBe(403);
  });

  it('linimasa: mengembalikan entri; non-array menjadi daftar kosong; petugas 403', async () => {
    await pasang('admin', vi.fn().mockResolvedValue({ data: [{ jenis: 'status', waktu: '2026-11-03T01:00:00Z' }], error: null }));
    const { GET } = await import('./[id]/linimasa/route');
    const res = await GET(req(), ctx);
    expect((await res.json()).entri).toHaveLength(1);
    await pasang('admin', vi.fn().mockResolvedValue({ data: null, error: null }));
    expect((await (await GET(req(), ctx)).json()).entri).toEqual([]);
    await pasang('petugas', vi.fn());
    expect((await GET(req(), ctx)).status).toBe(403);
  });
});
