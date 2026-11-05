// @vitest-environment node
// Validasi server buku tamu: aturan SAMA dengan formulir klien dan walk-in Front Office (lib/fo/walkin).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

type Calls = Array<[string, unknown[]]>;

function chain(result: unknown, calls: Calls) {
  const b: unknown = new Proxy({}, {
    get: (_t, k: string) => {
      if (k === 'then') return (res: (v: unknown) => unknown) => res({ error: null, ...(result as object) });
      return (...a: unknown[]) => { calls.push([k, a]); return b; };
    },
  });
  return b;
}

const BARIS = {
  id: '660e8400-e29b-41d4-a716-446655440001', nama: 'Budi Santoso', asal: 'CV Maju', no_hp: '+6281234567890',
  menemui_siapa: 'Kabid', keperluan: null, waktu_masuk: '2026-11-02T02:00:00Z', dicatat_oleh: 'p-actor',
};

async function setup(role = 'front_office') {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const actor = { id: 'p-actor', role, aktif: true, nama: 'A', username: 'a', layanan_id: null, wajib_ganti_sandi: false };
  const bukuCalls: Calls = [];
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-actor', updated_at: new Date().toISOString() } } }),
      getClaims: vi.fn().mockResolvedValue({ data: { claims: { amr: [{ method: 'otp' }] } } }),
    },
    from: (t: string) => chain(t === 'petugas' ? { data: actor } : { data: BARIS }, t === 'buku_tamu' ? bukuCalls : []),
  });
  const sbMod = await import('@supabase/supabase-js');
  (sbMod.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ from: () => chain({ data: null }, []) });
  return { bukuCalls };
}

const post = (body: unknown) => {
  const url = 'http://localhost/api/admin/buku-tamu';
  const r = new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as unknown as NextRequest;
  (r as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return r;
};
const lengkap = { nama: 'Budi Santoso', instansi: 'CV Maju', no_hp: '0812-3456-7890', bertemu: 'Kabid' };
const insertDari = (calls: Calls) => calls.find(([k]) => k === 'insert')?.[1][0] as Record<string, unknown> | undefined;

beforeEach(() => { vi.resetModules(); });

describe('POST /api/admin/buku-tamu: validasi', () => {
  it('menerima data lengkap; HP disimpan E.164, nama dirapikan spasinya', async () => {
    const { bukuCalls } = await setup();
    const { POST } = await import('./route');
    const res = await POST(post({ ...lengkap, nama: '  Budi   Santoso ' }));
    expect(res.status).toBe(201);
    expect(insertDari(bukuCalls)).toMatchObject({ nama: 'Budi Santoso', asal: 'CV Maju', no_hp: '+6281234567890' });
  });

  it('nomor HP wajib', async () => {
    const { bukuCalls } = await setup();
    const { POST } = await import('./route');
    const res = await POST(post({ nama: 'Budi Santoso', instansi: 'CV Maju', bertemu: 'Kabid' }));
    const j = await res.json();
    expect(res.status).toBe(400);
    expect(j.details.no_hp[0]).toMatch(/wajib/i);
    expect(j.error).toBe(j.details.no_hp[0]);
    expect(insertDari(bukuCalls)).toBeUndefined();
  });

  it('asal/instansi wajib', async () => {
    const { bukuCalls } = await setup();
    const { POST } = await import('./route');
    const res = await POST(post({ nama: 'Budi Santoso', no_hp: '081234567890', bertemu: 'Kabid' }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.instansi[0]).toMatch(/wajib/i);
    expect(insertDari(bukuCalls)).toBeUndefined();
  });

  it.each([
    ['telepon rumah', '0721123456', /telepon rumah/i],
    ['terlalu pendek', '08123', /terlalu pendek/i],
    ['huruf', 'abc', /hanya boleh berisi angka/i],
    ['awalan 0 setelah +62', '+62 0812345678', /Setelah \+62/],
  ])('menolak HP %s dengan pesan yang sama dengan Front Office', async (_n, hp, pesan) => {
    await setup();
    const { POST } = await import('./route');
    const res = await POST(post({ ...lengkap, no_hp: hp }));
    const j = await res.json();
    expect(res.status).toBe(400);
    expect(j.details.no_hp[0]).toMatch(pesan);
  });

  it.each([
    ['berisi angka', 'Budi123', /angka/i],
    ['simbol', 'Budi @#', /hanya boleh berisi huruf/i],
    ['terlalu pendek', 'Bu', /terlalu pendek/i],
  ])('menolak nama %s', async (_n, nama, pesan) => {
    await setup();
    const { POST } = await import('./route');
    const res = await POST(post({ ...lengkap, nama }));
    expect(res.status).toBe(400);
    expect((await res.json()).details.nama[0]).toMatch(pesan);
  });

  it('melaporkan semua isian yang salah sekaligus', async () => {
    await setup();
    const { POST } = await import('./route');
    const res = await POST(post({ nama: '1', bertemu: 'Kabid' }));
    const j = await res.json();
    expect(res.status).toBe(400);
    expect(Object.keys(j.details).sort()).toEqual(['instansi', 'nama', 'no_hp']);
  });

  it('petugas tetap ditolak (403)', async () => {
    await setup('petugas');
    const { POST } = await import('./route');
    expect((await POST(post(lengkap))).status).toBe(403);
  });
});
