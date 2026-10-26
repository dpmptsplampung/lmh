// @vitest-environment node
// API Admin Pendataan Khusus (Fase 4): daftar, tambah, urutan, ubah, hapus. Klien Supabase dimock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/akun/server', async (orig) => ({ ...(await orig<typeof import('@/lib/akun/server')>()), requireAdmin: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const LID = '660e8400-e29b-41d4-a716-446655440001';
const FID = '770e8400-e29b-41d4-a716-446655440002';
type Hasil = { data?: unknown; error?: { code?: string; message: string } | null };
type Panggilan = { table: string; op: 'select' | 'insert' | 'update' | 'delete'; values?: unknown; filters: Array<[string, unknown]> };

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/layanan/x/pendataan-khusus', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
const ctxKoleksi = { params: Promise.resolve({ id: LID }) };
const ctxField = { params: Promise.resolve({ id: LID, fieldId: FID }) };

async function setup(o: { admin?: boolean; jawab?: (c: Panggilan) => Hasil | undefined; rpcHasil?: Hasil } = {}) {
  const calls: Panggilan[] = [];
  const rpc = vi.fn(() => Promise.resolve(o.rpcHasil ?? { data: 0, error: null }));
  const akun = await import('@/lib/akun/server');
  vi.mocked(akun.requireAdmin).mockResolvedValue(
    o.admin === false
      ? ({ res: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) } as never)
      : ({ actor: { id: 'p1', role: 'admin', aktif: true, auth_user_id: 'a1' }, service: {} } as never),
  );
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    rpc,
    from: (table: string) => {
      const c: Panggilan = { table, op: 'select', filters: [] };
      let single = false;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        insert: (v: unknown) => { c.op = 'insert'; c.values = v; return b; },
        update: (v: unknown) => { c.op = 'update'; c.values = v; return b; },
        delete: () => { c.op = 'delete'; return b; },
        eq: (k: string, v: unknown) => { c.filters.push([k, v]); return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: () => { single = true; return b; },
        then: (res: (v: Hasil) => unknown, rej?: (e: unknown) => unknown) => {
          calls.push(c);
          const kustom = o.jawab?.(c);
          let hasil: Hasil;
          if (kustom) hasil = { error: null, ...kustom };
          else if (c.table === 'layanan') hasil = { data: single ? { id: LID, form_pendataan: null } : [], error: null };
          else if (c.op === 'select') hasil = { data: [], error: null };
          else if (c.op === 'insert') hasil = { data: [{ id: FID, ...(c.values as object) }], error: null };
          else hasil = { data: [{ id: FID }], error: null };
          return Promise.resolve(hasil).then(res, rej);
        },
      });
      return b;
    },
  });
  return { calls, rpc };
}

describe('GET pendataan-khusus', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('bukan admin -> 403', async () => {
    await setup({ admin: false });
    const { GET } = await import('./route');
    expect((await GET(req('GET'), ctxKoleksi)).status).toBe(403);
  });

  it('mengembalikan isian dan penanda form_tetap', async () => {
    await setup({
      jawab: (c) => c.table === 'pendataan_khusus_field'
        ? { data: [{ id: FID, layanan_id: LID, label: 'Nomor', jenis: 'teks_singkat', wajib: true, opsi: [], urut: 0, tersembunyi: false, pernah_diisi: false }] }
        : undefined,
    });
    const { GET } = await import('./route');
    const res = await GET(req('GET'), ctxKoleksi);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.form_tetap).toBe(false);
    expect(j.isian).toHaveLength(1);
    expect(j.isian[0]).toMatchObject({ id: FID, label: 'Nomor', jenis: 'teks_singkat' });
  });

  it('Layanan ber-formulir tetap -> form_tetap true', async () => {
    await setup({ jawab: (c) => (c.table === 'layanan' ? { data: { id: LID, form_pendataan: 'oss' } } : undefined) });
    const { GET } = await import('./route');
    expect((await (await GET(req('GET'), ctxKoleksi)).json()).form_tetap).toBe(true);
  });

  it('tabel belum ada (migrasi belum diterapkan) -> 409 MIGRASI_BELUM_DITERAPKAN', async () => {
    await setup({ jawab: (c) => (c.table === 'pendataan_khusus_field' ? { error: { code: 'PGRST205', message: 'no table' } } : undefined) });
    const { GET } = await import('./route');
    const res = await GET(req('GET'), ctxKoleksi);
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('MIGRASI_BELUM_DITERAPKAN');
  });
});

describe('POST pendataan-khusus', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('body tidak valid -> 422 (jenis berkas, pilihan kurang dari 2)', async () => {
    await setup();
    const { POST } = await import('./route');
    expect((await POST(req('POST', { label: 'Berkas', jenis: 'berkas' }), ctxKoleksi)).status).toBe(422);
    expect((await POST(req('POST', { label: 'Pilih', jenis: 'pilihan_tunggal', opsi: ['A'] }), ctxKoleksi)).status).toBe(422);
  });

  it('menambah isian: layanan_id dari URL; urut TIDAK dikirim (diberikan trigger DB di bawah kunci per Layanan)', async () => {
    const { calls } = await setup();
    const { POST } = await import('./route');
    const res = await POST(req('POST', { label: 'Nomor surat', jenis: 'teks_singkat', wajib: true }), ctxKoleksi);
    expect(res.status).toBe(201);
    const ins = calls.find((c) => c.op === 'insert');
    expect(ins?.values).toEqual({ layanan_id: LID, label: 'Nomor surat', jenis: 'teks_singkat', wajib: true, opsi: [] });
    expect(ins?.values).not.toHaveProperty('urut');
  });

  it('Layanan ber-formulir tetap (trigger DB) -> 409', async () => {
    await setup({
      jawab: (c) => (c.op === 'insert' ? { error: { code: '22023', message: 'LAYANAN_FORMULIR_TETAP: x' } } : undefined),
    });
    const { POST } = await import('./route');
    const res = await POST(req('POST', { label: 'Nomor surat', jenis: 'teks_singkat' }), ctxKoleksi);
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('LAYANAN_FORMULIR_TETAP');
  });

  it('Layanan tidak ada -> 404', async () => {
    await setup({ jawab: (c) => (c.table === 'layanan' ? { data: null } : undefined) });
    const { POST } = await import('./route');
    expect((await POST(req('POST', { label: 'Nomor surat', jenis: 'teks_singkat' }), ctxKoleksi)).status).toBe(404);
  });
});

describe('PUT urutan', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
  const B = '880e8400-e29b-41d4-a716-446655440003';

  it('atomik: satu RPC pendataan_khusus_urutkan, tanpa UPDATE per isian dari aplikasi', async () => {
    const { calls, rpc } = await setup({ rpcHasil: { data: 2, error: null } });
    const { PUT } = await import('./route');
    const res = await PUT(req('PUT', { urutan: [B, FID] }), ctxKoleksi);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('pendataan_khusus_urutkan', { p_layanan: LID, p_urutan: [B, FID] });
    expect(calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  it('isian di luar Layanan / bukan admin (galat DB ISIAN_TIDAK_DITEMUKAN) -> 404; fungsi belum ada -> 409', async () => {
    await setup({ rpcHasil: { data: null, error: { code: 'P0002', message: 'ISIAN_TIDAK_DITEMUKAN: x' } } });
    const { PUT } = await import('./route');
    expect((await PUT(req('PUT', { urutan: [B] }), ctxKoleksi)).status).toBe(404);
    vi.resetModules();
    await setup({ rpcHasil: { data: null, error: { code: 'PGRST202', message: 'x' } } });
    const m = await import('./route');
    const res = await m.PUT(req('PUT', { urutan: [B] }), ctxKoleksi);
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('MIGRASI_BELUM_DITERAPKAN');
  });
});

describe('PATCH / DELETE pendataan-khusus/[fieldId]', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('PATCH menolak jenis (tidak dapat diubah) -> 422', async () => {
    await setup();
    const { PATCH } = await import('./[fieldId]/route');
    expect((await PATCH(req('PATCH', { jenis: 'angka' }), ctxField)).status).toBe(422);
  });

  it('PATCH label/tersembunyi -> 200 dan membatasi pada layanan dari URL', async () => {
    const { calls } = await setup();
    const { PATCH } = await import('./[fieldId]/route');
    const res = await PATCH(req('PATCH', { label: 'Label baru', tersembunyi: true }), ctxField);
    expect(res.status).toBe(200);
    const upd = calls.find((c) => c.op === 'update');
    expect(upd?.values).toEqual({ label: 'Label baru', tersembunyi: true });
    expect(upd?.filters).toEqual([['id', FID], ['layanan_id', LID]]);
  });

  it('PATCH galat DB JENIS_TERKUNCI dipetakan 409', async () => {
    await setup({ jawab: (c) => (c.op === 'update' ? { error: { code: '23514', message: 'JENIS_TERKUNCI: x' } } : undefined) });
    const { PATCH } = await import('./[fieldId]/route');
    const res = await PATCH(req('PATCH', { wajib: true }), ctxField);
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('JENIS_TERKUNCI');
  });

  it('PATCH id tidak ada -> 404', async () => {
    await setup({ jawab: (c) => (c.op === 'update' ? { data: [] } : undefined) });
    const { PATCH } = await import('./[fieldId]/route');
    expect((await PATCH(req('PATCH', { wajib: true }), ctxField)).status).toBe(404);
  });

  it('DELETE isian yang pernah diisi -> 409 SUDAH_DIISI', async () => {
    await setup({ jawab: (c) => (c.op === 'delete' ? { error: { code: '23503', message: 'SUDAH_DIISI: x' } } : undefined) });
    const { DELETE } = await import('./[fieldId]/route');
    const res = await DELETE(req('DELETE'), ctxField);
    expect(res.status).toBe(409);
    expect((await res.json()).kode).toBe('SUDAH_DIISI');
  });

  it('DELETE isian belum terisi -> 200; bukan admin -> 403', async () => {
    await setup();
    const { DELETE } = await import('./[fieldId]/route');
    expect((await DELETE(req('DELETE'), ctxField)).status).toBe(200);
    vi.resetModules();
    await setup({ admin: false });
    const m = await import('./[fieldId]/route');
    expect((await m.DELETE(req('DELETE'), ctxField)).status).toBe(403);
  });
});
