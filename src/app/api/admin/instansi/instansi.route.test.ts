// @vitest-environment node
// API admin Instansi. Klien Supabase dimock (migrasi belum diterapkan).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

import type { NextRequest } from 'next/server';

const ID = '660e8400-e29b-41d4-a716-446655440001';
type Hasil = { data?: unknown; error?: { code?: string; message: string } | null };
type Panggilan = { table: string; op: 'select' | 'insert' | 'update' | 'delete'; values?: unknown; filters: Array<[string, unknown]> };

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/instansi', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

async function setup(o: { role?: string; jawab?: (c: Panggilan) => Hasil | undefined } = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const role = o.role ?? 'admin';
  const calls: Panggilan[] = [];
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } } }) },
    from: (table: string) => {
      const c: Panggilan = { table, op: 'select', filters: [] };
      let single = false;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        insert: (v: unknown) => { c.op = 'insert'; c.values = v; return b; },
        update: (v: unknown) => { c.op = 'update'; c.values = v; return b; },
        eq: (k: string, v: unknown) => { c.filters.push([k, v]); return b; },
        order: () => b,
        single: () => { single = true; return b; },
        maybeSingle: () => { single = true; return b; },
        then: (res: (v: Hasil) => unknown, rej?: (e: unknown) => unknown) => {
          if (table === 'petugas') return Promise.resolve({ data: { id: 'p1', role, aktif: true }, error: null }).then(res, rej);
          calls.push(c);
          const kustom = o.jawab?.(c);
          let hasil: Hasil;
          if (kustom) hasil = { error: null, ...kustom };
          else if (c.op === 'select') hasil = { data: [{ id: ID, nama: 'DPMPTSP', singkatan: 'PTSP' }], error: null };
          else if (c.op === 'insert') hasil = { data: single ? { id: 'baru' } : null, error: null };
          else hasil = { data: [{ id: ID }], error: null };
          return Promise.resolve(hasil).then(res, rej);
        },
      });
      return b;
    },
  });
  return { calls };
}

const dup = { code: '23505', message: 'duplicate key value violates unique constraint "instansi_nama_key"' };

describe('instansi: GET / POST', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('FO GET 200 (bisa_ubah false), FO POST 403, petugas GET 403', async () => {
    await setup({ role: 'front_office' });
    const { GET, POST } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bisa_ubah).toBe(false);
    expect(body.instansi).toHaveLength(1);
    expect((await POST(req('POST', { nama: 'Dinas Baru' }))).status).toBe(403);
    vi.resetModules();
    await setup({ role: 'petugas' });
    expect((await (await import('./route')).GET()).status).toBe(403);
  });
  it('POST: nama dipangkas, singkatan kosong -> null, 201 {id}', async () => {
    const s = await setup();
    const res = await (await import('./route')).POST(req('POST', { nama: '  Dinas Perdagangan  ', singkatan: '  ' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'baru' });
    expect(s.calls.find((c) => c.op === 'insert')?.values).toEqual({ nama: 'Dinas Perdagangan', singkatan: null });
  });
  it('POST: nama 1 huruf / spasi saja / singkatan 31 huruf = 400', async () => {
    await setup();
    const { POST } = await import('./route');
    expect((await POST(req('POST', { nama: 'A' }))).status).toBe(400);
    expect((await POST(req('POST', { nama: '   ' }))).status).toBe(400);
    expect((await POST(req('POST', { nama: 'Dinas Baru', singkatan: 'x'.repeat(31) }))).status).toBe(400);
  });
  it('POST nama bentrok -> 409 NAMA_BENTROK', async () => {
    await setup({ jawab: (c) => (c.op === 'insert' ? { data: null, error: dup } : undefined) });
    const res = await (await import('./route')).POST(req('POST', { nama: 'DPMPTSP' }));
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('NAMA_BENTROK');
  });
});

describe('instansi: PATCH /[id]', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('403 non-admin, 400 body kosong / kunci asing / id jelek', async () => {
    await setup({ role: 'front_office' });
    expect((await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'Baru' }), ctx())).status).toBe(403);
    vi.resetModules();
    await setup();
    const { PATCH } = await import('./[id]/route');
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(400);
    expect((await PATCH(req('PATCH', { slug: 'x' }), ctx())).status).toBe(400);
    expect((await PATCH(req('PATCH', { nama: 'Baru' }), ctx('bukan-uuid'))).status).toBe(400);
  });
  it('ubah nama + singkatan -> 200', async () => {
    const s = await setup();
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { nama: ' Nama Baru ', singkatan: 'NB' }), ctx());
    expect(res.status).toBe(200);
    expect(s.calls.find((c) => c.op === 'update')?.values).toEqual({ nama: 'Nama Baru', singkatan: 'NB' });
  });
  it('nama bentrok -> 409 NAMA_BENTROK; tidak ada baris -> 404', async () => {
    await setup({ jawab: (c) => (c.op === 'update' ? { data: null, error: dup } : undefined) });
    const res = await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'DPMPTSP' }), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('NAMA_BENTROK');
    vi.resetModules();
    await setup({ jawab: (c) => (c.op === 'update' ? { data: [] } : undefined) });
    expect((await (await import('./[id]/route')).PATCH(req('PATCH', { nama: 'Nama Baru' }), ctx())).status).toBe(404);
  });
});
