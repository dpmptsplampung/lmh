// @vitest-environment node
// Audit T2d (inventaris No 52-53): delete lalu insert potongan RAG tanpa transaksi. Semua hasil harus diperiksa,
// dan potongan lama TIDAK boleh dihapus sebelum embedding baru siap (Gemini mati = dokumen tetap utuh).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/env/server', () => ({ parseServerEnv: vi.fn(() => ({})) }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const gemini = vi.hoisted(() => ({ client: {} as object | null, embedThrow: false }));
vi.mock('@/lib/gemini', () => ({
  getGenerativeClient: () => gemini.client,
  getEmbeddingModel: () => ({
    embedContent: async () => {
      if (gemini.embedThrow) throw new Error('Gemini mati');
      return { embedding: { values: [0.1, 0.2, 0.3] } };
    },
  }),
}));

import type { NextRequest } from 'next/server';

const DOK = '660e8400-e29b-41d4-a716-446655440001';
const req = () =>
  new Request('http://localhost/api/admin/dokumen/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dokumen_id: DOK }),
  }) as unknown as NextRequest;

type Hasil = { data?: unknown; error?: { code?: string; message: string } | null };

async function setup(o: { del?: Hasil; ins?: Hasil } = {}) {
  const serverMod = await import('@/lib/supabase/server');
  const baris = (data: unknown) => ({
    select: () => ({ eq: () => ({ single: async () => ({ data, error: null }) }) }),
  });
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (t: string) =>
      t === 'petugas'
        ? baris({ role: 'admin', aktif: true })
        : baris({ id: DOK, teks_utama: 'Pasal 1 isi peraturan yang cukup panjang untuk diproses.', status: 'berlaku' }),
  });

  const urutan: string[] = [];
  const del = vi.fn(() => {
    urutan.push('delete');
    return { eq: () => ({ select: async () => ({ data: [], error: null, ...o.del }) }) };
  });
  const ins = vi.fn(() => {
    urutan.push('insert');
    return Promise.resolve({ data: null, error: null, ...o.ins });
  });
  const svcMod = await import('@/lib/supabase/service');
  (svcMod.createServiceRoleClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: (t: string) => {
      if (t !== 'dokumen_potongan') throw new Error(`tabel tak terduga ${t}`);
      return { delete: del, insert: ins };
    },
  });
  const logger = await import('@/lib/observability/logger');
  return { del, ins, urutan, log: logger.logServerEvent as unknown as ReturnType<typeof vi.fn> };
}

describe('POST /api/admin/dokumen/embed - mutasi dicek', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    gemini.client = {};
    gemini.embedThrow = false;
  });

  it('jalur sukses: hapus lama (0 baris sah pada embed pertama) lalu sisipkan potongan baru', async () => {
    const s = await setup();
    const res = await (await import('./route')).POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, potongan: 1 });
    expect(s.urutan).toEqual(['delete', 'insert']);
  });

  it('delete gagal -> 500 jelas dan TIDAK menyisipkan (tidak ada potongan ganda)', async () => {
    const s = await setup({ del: { data: null, error: { code: '57014', message: 'statement timeout' } } });
    const res = await (await import('./route')).POST(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('statement timeout');
    expect(s.ins).not.toHaveBeenCalled();
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.dokumen.embed.hapus_potongan' }));
  });

  it('insert gagal -> 500 yang menyebut dokumen tanpa potongan, pesan DB tidak bocor, tercatat', async () => {
    const s = await setup({ ins: { error: { code: '23505', message: 'duplicate key value rahasia-internal' } } });
    const res = await (await import('./route')).POST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/potongan/i);
    expect(JSON.stringify(body)).not.toContain('rahasia-internal');
    expect(s.log).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ operation: 'admin.dokumen.embed.sisip_potongan', asalCode: '23505' }),
    );
  });

  it('konteks log memakai kunci nPotongan (jumlahPotongan akan disamarkan logger karena memuat "hp")', async () => {
    const s = await setup({ ins: { error: { code: '23505', message: 'dup' } } });
    await (await import('./route')).POST(req());
    const konteks = s.log.mock.calls.find((c) => c[1]?.operation === 'admin.dokumen.embed.sisip_potongan')?.[1];
    expect(konteks).toMatchObject({ nPotongan: 1 });
    expect(konteks).not.toHaveProperty('jumlahPotongan');
  });

  it('Gemini melempar error -> 500 dengan pesan baku (detail vendor tidak bocor), detail dicatat', async () => {
    gemini.embedThrow = true;
    const s = await setup();
    const res = await (await import('./route')).POST(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('Gemini mati');
    expect(body.error).toMatch(/embedding/i);
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.dokumen.embed.gagal' }));
  });

  it('Gemini tidak dikonfigurasi (503) atau gagal (500): potongan lama TIDAK dihapus', async () => {
    gemini.client = null;
    let s = await setup();
    let res = await (await import('./route')).POST(req());
    expect(res.status).toBe(503);
    expect(s.del).not.toHaveBeenCalled();

    vi.resetModules();
    gemini.client = {};
    gemini.embedThrow = true;
    s = await setup();
    res = await (await import('./route')).POST(req());
    expect(res.status).toBe(500);
    expect(s.del).not.toHaveBeenCalled();
    expect(s.ins).not.toHaveBeenCalled();
  });
});
