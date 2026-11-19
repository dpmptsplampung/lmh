// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { POST } from './route';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const ID = '550e8400-e29b-41d4-a716-446655440000';
const body = {
  ipro_id: ID, nama: 'Budi Investor', email: 'budi@example.com',
  pesan: 'Mohon informasi proyek ini.', setuju_pdp: true, operasi_id: ID,
};
const request = (input: unknown = body) => new Request('http://localhost/api/investasi/pesan', {
  method: 'POST', body: JSON.stringify(input),
});
const rpc = vi.fn();
const getUser = vi.fn();

describe('POST /api/investasi/pesan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rpc.mockResolvedValue({ data: { id: ID }, error: null });
    getUser.mockResolvedValue({ data: { user: { id: ID, is_anonymous: true } }, error: null });
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser },
      rpc,
    } as unknown as Awaited<ReturnType<typeof createClient>>);
  });

  it('menerima sesi anonim dan mencatat minat IPRO beserta consent melalui RPC', async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { id: ID } });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(rpc).toHaveBeenCalledWith('investasi_kirim_minat', {
      p_kanal: 'ipro', p_ref_id: ID, p_nama: body.nama, p_email: body.email,
      p_no_hp: null, p_instansi: null, p_pesan: body.pesan,
      p_setuju_pdp: true, p_versi_kebijakan: '1.1', p_operasi_id: ID,
    });
  });

  it('honeypot mengembalikan tanda terima palsu tanpa mengakses sesi atau RPC dan tanpa log PII', async () => {
    const response = await POST(request({ ...body, situs_web: 'https://spam.example.com' }));
    expect(response.status).toBe(201);
    const hasil = await response.json();
    expect(hasil).toEqual({ data: { id: expect.any(String) } });
    expect(hasil.data.id).not.toBe(ID);
    expect(createClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(logServerEvent).toHaveBeenCalledExactlyOnceWith('info', { operation: 'investasi.honeypot' });
  });

  it.each([
    { setuju_pdp: false }, { setuju_pdp: undefined }, { operasi_id: undefined },
    { ipro_id: 'bukan-uuid' }, { nama: '   ' }, { email: 'salah' },
    { pesan: 'pendek' }, { no_hp: 'nomor-tidak-valid' },
    { versi_kebijakan: 'palsu' }, { kanal: 'dokumen' },
  ])('menolak isian tidak valid atau kunci di luar kontrak: %j', async perubahan => {
    const response = await POST(request({ ...body, ...perubahan }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'INPUT_TIDAK_VALID', message: expect.any(String) }, request_id: expect.any(String),
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('menormalkan nomor kontak dan meneruskan instansi ke RPC', async () => {
    const response = await POST(request({ ...body, no_hp: '+62 (812) 3456-7890', instansi: ' PT Maju ' }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('investasi_kirim_minat', expect.objectContaining({
      p_no_hp: '+6281234567890', p_instansi: 'PT Maju',
    }));
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: ID } }, error: { message: 'sesi tidak valid' } },
  ])('tanpa sesi yang sah mengembalikan 401', async hasil => {
    getUser.mockResolvedValue(hasil);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('LOGIN_DIPERLUKAN');
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['INPUT_TIDAK_VALID', 400], ['LOGIN_DIPERLUKAN', 401], ['DILARANG', 403],
    ['TIDAK_DITEMUKAN', 404], ['KONFLIK_OPERASI', 409], ['KONFLIK_STATUS', 409],
    ['SLUG_TERKUNCI', 409], ['TERLALU_BANYAK', 429],
  ])('memetakan galat RPC %s ke HTTP %i', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { message: code, code: 'P0001' } });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: { code, message: expect.any(String) }, request_id: expect.any(String),
    });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Retry-After')).toBe(status === 429 ? '60' : null);
  });

  it('tidak membocorkan pesan galat internal atau mencatat PII', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: `internal email=${body.email}` } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    const hasil = await response.text();
    expect(hasil).toContain('GAGAL_INTERNAL');
    expect(hasil).not.toContain(body.email);
    expect(hasil).not.toContain('internal email');
    expect(logServerEvent).not.toHaveBeenCalled();
  });
  it.each([
    ['23505', 'KONFLIK_STATUS', 409], ['PGRST301', 'LOGIN_DIPERLUKAN', 401],
    ['PGRST302', 'LOGIN_DIPERLUKAN', 401], ['55P03', 'KONFLIK_VERSI', 409],
    ['23503', 'KONFLIK_STATUS', 409], ['23514', 'INPUT_TIDAK_VALID', 400], ['22003', 'INPUT_TIDAK_VALID', 400],
  ])('memakai pemeta bersama untuk SQL %s', async (sql, code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code: sql, message: 'internal rahasia' } });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it('kegagalan jaringan RPC menghasilkan galat 500 yang aman', async () => {
    rpc.mockRejectedValue(new Error(`internal ${body.email}`));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('GAGAL_INTERNAL');
    expect(logServerEvent).not.toHaveBeenCalled();
  });

  it.each([null, {}, { id: 'bukan-uuid' }])('tidak mengirim sukses tanpa tanda terima RPC yang sah: %j', async data => {
    rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request())).status).toBe(500);
  });

  it('hanya meneruskan tanda terima, tanpa field internal RPC', async () => {
    rpc.mockResolvedValue({ data: { id: ID, email: body.email }, error: null });
    expect(await (await POST(request())).json()).toEqual({ data: { id: ID } });
  });

  it.each(['{rusak', '', 'null', '[]'])('menolak JSON salah atau bentuk bukan objek: %j', async teks => {
    const response = await POST(new Request('http://localhost/api/investasi/pesan', { method: 'POST', body: teks }));
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('menolak badan kosong', async () => {
    expect((await POST(new Request('http://localhost/api/investasi/pesan', { method: 'POST' }))).status).toBe(400);
  });

  it('menolak Content-Length lebih dari 16 KiB sebelum membaca badan', async () => {
    const req = request();
    req.headers.set('Content-Length', '16385');
    expect((await POST(req)).status).toBe(400);
    expect(req.bodyUsed).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([null, '1'])('membatasi byte UTF-8 badan meski Content-Length kosong atau palsu (%s)', async panjang => {
    const req = request({ ...body, situs_web: 'あ'.repeat(6000) });
    if (panjang) req.headers.set('Content-Length', panjang);
    expect((await POST(req)).status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('menerima badan tepat 16 KiB', async () => {
    const teks = JSON.stringify(body);
    const req = new Request('http://localhost/api/investasi/pesan', {
      method: 'POST', body: teks + ' '.repeat(16384 - new TextEncoder().encode(teks).byteLength),
      headers: { 'Content-Length': '16384' },
    });
    expect((await POST(req)).status).toBe(201);
  });
});
