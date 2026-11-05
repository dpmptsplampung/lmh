// @vitest-environment node
// POST /api/saran (publik): pembatas zod, jebakan bot, pembatas laju, pemetaan hasil RPC.
// RPC kirim_saran_publik hanya untuk service_role (202611040001): route memakai service client, bukan sesi/anon.
// Laju: RPC catat_laju_publik (penghitung bersama di DB). Mock `kirim` = kirim_saran_publik; `laju` meniru satu DB
// bersama (Map di luar modul route) sehingga dua muatan modul = dua instance yang berbagi kuota.
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kirim = vi.fn();
const dbLaju = new Map<string, number>();
const laju = vi.fn(async (a: { p_aksi: string; p_kunci: string; p_maks: number; p_jendela_detik: number }) => {
  const k = `${a.p_aksi}:${a.p_kunci}`;
  const n = dbLaju.get(k) ?? 0;
  if (n >= a.p_maks) return { data: false, error: null };
  dbLaju.set(k, n + 1);
  return { data: true, error: null };
});
const rpc = vi.fn((fn: string, args: Record<string, unknown>) =>
  fn === 'catat_laju_publik' ? laju(args as Parameters<typeof laju>[0]) : kirim(fn, args));
const buatService = vi.fn((url: string, key: string) => {
  void url;
  void key;
  return { rpc };
});
const sesi = vi.fn(async () => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: buatService }));
vi.mock('@/lib/supabase/server', () => ({ createClient: sesi }));

import type { NextRequest } from 'next/server';

let ipKe = 0;
const req = (b: unknown, ip?: string) =>
  new Request('http://x/api/saran', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip ?? `10.0.0.${++ipKe}` },
    body: typeof b === 'string' ? b : JSON.stringify(b),
  }) as unknown as NextRequest;

async function muat() {
  vi.resetModules();
  return (await import('./route')).POST;
}

beforeEach(() => {
  kirim.mockReset();
  laju.mockClear();
  dbLaju.clear();
  rpc.mockClear();
  buatService.mockClear();
  sesi.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'kunci-uji-service';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/saran', () => {
  it('sukses 201 dan meneruskan isi + nama ke RPC', async () => {
    const POST = await muat();
    kirim.mockResolvedValue({ data: 'submitted', error: null });
    const res = await POST(req({ isi: '  Mohon tambah loket pelayanan  ', nama: ' Budi ' }));
    expect(res.status).toBe(201);
    expect(kirim).toHaveBeenCalledWith('kirim_saran_publik', { p_isi: 'Mohon tambah loket pelayanan', p_nama: 'Budi' });
  });

  it('memanggil RPC lewat service client, tidak pernah lewat klien sesi/anon', async () => {
    const POST = await muat();
    kirim.mockResolvedValue({ data: 'submitted', error: null });
    expect((await POST(req({ isi: 'Mohon tambah loket pelayanan' }))).status).toBe(201);
    expect(buatService).toHaveBeenCalledWith('http://supabase.local', 'kunci-uji-service', expect.anything());
    expect(sesi).not.toHaveBeenCalled();
  });

  it('konfigurasi service role kosong -> 500 tanpa memanggil RPC', async () => {
    const POST = await muat();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await POST(req({ isi: 'Mohon tambah loket pelayanan' }));
    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
    expect(sesi).not.toHaveBeenCalled();
  });

  it('nama kosong dikirim sebagai null (saran anonim)', async () => {
    const POST = await muat();
    kirim.mockResolvedValue({ data: 'submitted', error: null });
    await POST(req({ isi: 'Mohon tambah loket pelayanan' }));
    expect(kirim).toHaveBeenCalledWith('kirim_saran_publik', { p_isi: 'Mohon tambah loket pelayanan', p_nama: null });
  });

  it.each([
    [{ isi: 'pdk' }], [{ isi: '' }], [{ isi: 'x'.repeat(2001) }], [{ isi: 'cukup panjang', nama: 'n'.repeat(121) }],
    [{ isi: 'cukup panjang', ekstra: 1 }], ['bukan json'], [{}],
  ])('menolak input tidak valid %#', async (b) => {
    const POST = await muat();
    const res = await POST(req(b));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('jebakan bot: kolom website terisi dijawab 201 tetapi tidak disimpan', async () => {
    const POST = await muat();
    const res = await POST(req({ isi: 'promosi judi online murah', website: 'http://spam.example' }));
    expect(res.status).toBe(201);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('pembatas laju per IP: kiriman ke-6 dalam 10 menit ditolak 429 tanpa menyimpan', async () => {
    const POST = await muat();
    kirim.mockResolvedValue({ data: 'submitted', error: null });
    for (let i = 0; i < 5; i++) expect((await POST(req({ isi: 'saran nomor ' + i + ' ok' }, '9.9.9.9'))).status).toBe(201);
    expect((await POST(req({ isi: 'saran nomor enam' }, '9.9.9.9'))).status).toBe(429);
    expect(kirim).toHaveBeenCalledTimes(5);
    expect((await POST(req({ isi: 'saran dari ip lain' }, '8.8.8.8'))).status).toBe(201);
  });

  it('kuota dibagi lintas instance: 3 kiriman di instance A + 2 di B, keenam di mana pun = 429', async () => {
    kirim.mockResolvedValue({ data: 'submitted', error: null });
    const A = await muat();
    const B = await muat();
    expect(A).not.toBe(B);
    for (let i = 0; i < 3; i++) expect((await A(req({ isi: 'saran instance A ' + i }, '7.7.7.7'))).status).toBe(201);
    for (let i = 0; i < 2; i++) expect((await B(req({ isi: 'saran instance B ' + i }, '7.7.7.7'))).status).toBe(201);
    expect((await A(req({ isi: 'saran keenam di A' }, '7.7.7.7'))).status).toBe(429);
    expect((await B(req({ isi: 'saran keenam di B' }, '7.7.7.7'))).status).toBe(429);
    expect(kirim).toHaveBeenCalledTimes(5);
  });

  it('DB menerima SHA-256 IP (bukan IP mentah), 5 per 600 detik, lewat service client', async () => {
    const POST = await muat();
    kirim.mockResolvedValue({ data: 'submitted', error: null });
    await POST(req({ isi: 'Mohon tambah loket pelayanan' }, '203.0.113.9, 10.0.0.1'));
    const harap = createHash('sha256').update('lmh-laju:203.0.113.9').digest('hex');
    expect(laju).toHaveBeenCalledWith({ p_aksi: 'saran.publik', p_kunci: harap, p_maks: 5, p_jendela_detik: 600 });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('203.0.113.9');
  });

  it('validasi gagal dan jebakan bot tidak memakai kuota', async () => {
    const POST = await muat();
    await POST(req({ isi: 'pdk' }, '6.6.6.6'));
    await POST(req({ isi: 'promosi judi online', website: 'http://spam.example' }, '6.6.6.6'));
    expect(laju).not.toHaveBeenCalled();
  });

  it.each([
    ['galat DB', async () => ({ data: null, error: { code: '42883', message: 'function catat_laju_publik rahasia-xyz does not exist' } })],
    ['data bukan boolean', async () => ({ data: null, error: null })],
    ['RPC melempar', async () => { throw new Error('jaringan rahasia-xyz'); }],
  ])('pemeriksaan laju gagal (%s) -> 503 pesan umum, saran tidak disimpan (fail-closed)', async (_n, impl) => {
    const POST = await muat();
    laju.mockImplementationOnce(impl as never);
    const res = await POST(req({ isi: 'Mohon tambah loket pelayanan' }));
    expect(res.status).toBe(503);
    const teks = JSON.stringify(await res.json());
    expect(teks).toContain('Gagal mengirim saran');
    expect(teks).not.toContain('rahasia-xyz');
    expect(kirim).not.toHaveBeenCalled();
  });

  it('RPC invalid -> 400; status tak dikenal dan galat database -> 500 tanpa membocorkan pesan', async () => {
    const POST = await muat();
    kirim.mockResolvedValue({ data: 'invalid', error: null });
    expect((await POST(req({ isi: 'saran yang cukup' }))).status).toBe(400);
    kirim.mockResolvedValue({ data: 'aneh', error: null });
    expect((await POST(req({ isi: 'saran yang cukup' }))).status).toBe(500);
    kirim.mockResolvedValue({ data: null, error: { message: 'koneksi rahasia-xyz putus', code: '08006' } });
    const res = await POST(req({ isi: 'saran yang cukup' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('rahasia-xyz');
  });
});
