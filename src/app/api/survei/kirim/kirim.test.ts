// @vitest-environment node
// Uji POST /api/survei/kirim (Task 8): pembatas validasi (zod strict) di depan RPC kirim_survei. Pola: /api/skm/submit.
// Yang dijaga: payload nakal TIDAK PERNAH sampai ke RPC (Review Focus 4), status RPC dipetakan ke kode HTTP yang benar,
// dan galat basis data tidak bocor ke respons (hanya dicatat dengan kode).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PERTANYAAN_SPAK, RENTANG, UNSUR_SKM } from '@/lib/survei/pertanyaan';
import { kirimSurveiSchema } from '@/lib/survei/schemas';

const TOKEN = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SPAK_OK = { p1: 6, p2: 5, p3: 4, p4: 3, p5: 1 };
const SKM_OK = { u1: 4, u2: 3, u3: 2, u4: 1, u5: 4, u6: 3, u7: 2, u8: 1, u9: 4, u10: 3, u11: 2 };
const validBody = { token: TOKEN, spak: SPAK_OK, skm: SKM_OK };

function request(body: unknown): NextRequest {
  return new Request('http://localhost/api/survei/kirim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as NextRequest;
}

function mockRpc(data: unknown, error: { message: string; code?: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ rpc });
  return rpc;
}

/** Salinan dalam `validBody` yang boleh dimutasi pemanggil. */
function varian(ubah: (b: { token: unknown; spak: unknown; skm: unknown }) => void) {
  const b = JSON.parse(JSON.stringify(validBody));
  ubah(b);
  return b;
}

describe('POST /api/survei/kirim', () => {
  beforeEach(() => vi.clearAllMocks());

  it('payload sah memanggil kirim_survei SEKALI hanya dengan token, spak, dan skm, lalu membalas 201 { ok: true }', async () => {
    const rpc = mockRpc('submitted');
    const { POST } = await import('./route');
    const res = await POST(request(validBody));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('kirim_survei', { p_token: TOKEN, p_spak: SPAK_OK, p_skm: SKM_OK });
    const [, args] = rpc.mock.calls[0];
    expect(Object.keys(args.p_spak)).toEqual(PERTANYAAN_SPAK.map((p) => p.kunci));
    expect(Object.keys(args.p_skm)).toEqual(UNSUR_SKM.map((u) => u.kunci));
  });

  it('batas rentang sah diterima: SPAK semua 1 atau semua 6, SKM semua 1 atau semua 4', async () => {
    for (const [spakNilai, skmNilai] of [[RENTANG.spak.min, RENTANG.skm.min], [RENTANG.spak.max, RENTANG.skm.max]]) {
      const rpc = mockRpc('submitted');
      const { POST } = await import('./route');
      const spak = Object.fromEntries(PERTANYAAN_SPAK.map((p) => [p.kunci, spakNilai]));
      const skm = Object.fromEntries(UNSUR_SKM.map((u) => [u.kunci, skmNilai]));
      const res = await POST(request({ token: TOKEN, spak, skm }));
      expect(res.status).toBe(201);
      expect(rpc).toHaveBeenCalledWith('kirim_survei', { p_token: TOKEN, p_spak: spak, p_skm: skm });
    }
  });

  it.each([
    ['submitted', 201, undefined],
    ['invalid', 400, 'Jawaban survei tidak valid'],
    ['not_found', 404, 'Tautan survei tidak ditemukan'],
    ['duplicate', 409, 'Survei ini sudah terisi'],
    ['expired', 410, 'Tautan survei sudah kedaluwarsa'],
  ])('status RPC %s dipetakan ke HTTP %i', async (hasil, status, pesan) => {
    mockRpc(hasil);
    const { POST } = await import('./route');
    const res = await POST(request(validBody));
    expect(res.status).toBe(status);
    const body = await res.json();
    if (pesan) expect(body).toEqual({ error: pesan });
    else expect(body).toEqual({ ok: true });
  });

  describe('payload nakal -> 400 dan RPC TIDAK dipanggil', () => {
    const nakal: [string, unknown][] = [
      ['kunci asing di level atas (visit_id)', { ...validBody, visit_id: '550e8400-e29b-41d4-a716-446655440000' }],
      ['kunci asing di level atas (saran)', { ...validBody, saran: 'halo' }],
      ['kunci asing di spak (p6)', varian((b) => { (b.spak as Record<string, unknown>).p6 = 3; })],
      ['kunci asing di skm (u12)', varian((b) => { (b.skm as Record<string, unknown>).u12 = 3; })],
      ['kunci spak kurang (p5)', varian((b) => { delete (b.spak as Record<string, unknown>).p5; })],
      ['kunci skm kurang (u11)', varian((b) => { delete (b.skm as Record<string, unknown>).u11; })],
      ['kunci skm kurang (u10, bentuk 9 unsur lama)', varian((b) => { delete (b.skm as Record<string, unknown>).u10; delete (b.skm as Record<string, unknown>).u11; })],
      ['spak kosong {}', varian((b) => { b.spak = {}; })],
      ['skm kosong {}', varian((b) => { b.skm = {}; })],
      ['spak hilang', { token: TOKEN, skm: SKM_OK }],
      ['skm hilang', { token: TOKEN, spak: SPAK_OK }],
      ['SPAK bernilai 0', varian((b) => { (b.spak as Record<string, unknown>).p1 = 0; })],
      ['SPAK bernilai 7', varian((b) => { (b.spak as Record<string, unknown>).p2 = 7; })],
      ['SKM bernilai 0', varian((b) => { (b.skm as Record<string, unknown>).u1 = 0; })],
      ['SKM bernilai 5 (skala SPAK terselip)', varian((b) => { (b.skm as Record<string, unknown>).u9 = 5; })],
      ['SKM bernilai 6', varian((b) => { (b.skm as Record<string, unknown>).u11 = 6; })],
      ['nilai negatif', varian((b) => { (b.spak as Record<string, unknown>).p3 = -1; })],
      ['nilai desimal 3.5 (SPAK)', varian((b) => { (b.spak as Record<string, unknown>).p4 = 3.5; })],
      ['nilai desimal 3.5 (SKM)', varian((b) => { (b.skm as Record<string, unknown>).u5 = 3.5; })],
      ['nilai string "3"', varian((b) => { (b.spak as Record<string, unknown>).p1 = '3'; })],
      ['nilai string "3" (SKM)', varian((b) => { (b.skm as Record<string, unknown>).u3 = '3'; })],
      ['nilai null', varian((b) => { (b.skm as Record<string, unknown>).u2 = null; })],
      ['nilai boolean true', varian((b) => { (b.spak as Record<string, unknown>).p5 = true; })],
      ['nilai array [3]', varian((b) => { (b.spak as Record<string, unknown>).p5 = [3]; })],
      ['nilai objek {}', varian((b) => { (b.skm as Record<string, unknown>).u4 = {}; })],
      ['spak berupa array', varian((b) => { b.spak = [3, 3, 3, 3, 3]; })],
      ['spak berupa string', varian((b) => { b.spak = 'p1=3'; })],
      ['spak null', varian((b) => { b.spak = null; })],
      ['skm berupa array', varian((b) => { b.skm = [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3]; })],
      ['skm berupa angka', varian((b) => { b.skm = 3; })],
      ['skm null', varian((b) => { b.skm = null; })],
      ['token hilang', { spak: SPAK_OK, skm: SKM_OK }],
      ['token terlalu pendek (31)', { ...validBody, token: 'a'.repeat(31) }],
      ['token terlalu panjang (129)', { ...validBody, token: 'a'.repeat(129) }],
      ['token bukan string', { ...validBody, token: 123 }],
      ['token null', { ...validBody, token: null }],
      ['body null', null],
      ['body array', [validBody]],
      ['body string JSON', JSON.stringify('teks')],
      ['body angka', 42],
      ['body kosong ({})', {}],
    ];

    it.each(nakal)('%s', async (_nama, body) => {
      const rpc = mockRpc('submitted');
      const { POST } = await import('./route');
      const res = await POST(request(body));
      expect(res.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    });

    it.each([
      ['JSON rusak', '{"token": '],
      ['teks biasa', 'bukan json'],
      ['badan kosong', ''],
    ])('%s', async (_nama, mentah) => {
      const rpc = mockRpc('submitted');
      const { POST } = await import('./route');
      const res = await POST(request(mentah));
      expect(res.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    });

    // Sejak zod 4.6.6 kunci `__proto__` milik sendiri pada objek strict ditolak (sebelumnya diabaikan diam-diam).
    // Yang dijaga: kunci itu tidak pernah sampai ke RPC/basis data.
    it('kunci "__proto__" pada skm ditolak 400 dan RPC TIDAK dipanggil', async () => {
      const rpc = mockRpc('submitted');
      const { POST } = await import('./route');
      const mentah = `{"token":"${TOKEN}","spak":${JSON.stringify(SPAK_OK)},"skm":${JSON.stringify(SKM_OK).slice(0, -1)},"__proto__":{"x":1}}}`;
      const res = await POST(request(mentah));
      expect(res.status).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    });

    it('respons 400 tidak memantulkan nilai kiriman', async () => {
      mockRpc('submitted');
      const { POST } = await import('./route');
      const res = await POST(request({ ...validBody, visit_id: 'RAHASIA-123' }));
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain('RAHASIA-123');
    });
  });

  describe('kegagalan RPC', () => {
    let errSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      errSpy.mockRestore();
      vi.unstubAllGlobals();
    });
    const log = () =>
      errSpy.mock.calls
        .map((c: unknown[]) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
        .find((e: Record<string, unknown> | null) => e?.operation === 'survei.kirim');

    it('RPC error: 500 tanpa teks galat mentah, dicatat dengan kode (catatMutasi), tanpa pesan teknis', async () => {
      mockRpc(null, { message: 'sensitive database error', code: '08006' });
      const { POST } = await import('./route');
      const res = await POST(request(validBody));
      expect(res.status).toBe(500);
      const teks = await res.text();
      expect(teks).not.toContain('sensitive');
      expect(JSON.parse(teks)).toEqual({ error: 'Gagal mengirim survei' });
      expect(log()).toMatchObject({ route: '/api/survei/kirim', kode: 'database', asalCode: '08006' });
      expect(JSON.stringify(log())).not.toContain('sensitive');
      expect(JSON.stringify(log())).not.toContain(TOKEN);
    });

    it('RPC sukses tetapi bukan string status: 500 dan dicatat tidak_ada_baris', async () => {
      mockRpc(null, null);
      const { POST } = await import('./route');
      const res = await POST(request(validBody));
      expect(res.status).toBe(500);
      expect(log()).toMatchObject({ kode: 'tidak_ada_baris' });
    });

    it('status RPC tak dikenal: 500 dan dicatat (bukan 2xx palsu)', async () => {
      mockRpc('selesai_tapi_aneh');
      const { POST } = await import('./route');
      const res = await POST(request(validBody));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Gagal mengirim survei' });
      expect(log()).toBeDefined();
    });

    it('galat jaringan (rpc menolak) menjadi 500 dan dicatat tanpa melempar ke Next', async () => {
      const rpc = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ rpc });
      const { POST } = await import('./route');
      const res = await POST(request(validBody));
      expect(res.status).toBe(500);
      expect(log()).toMatchObject({ kode: 'jaringan' });
    });
  });
});

describe('kirimSurveiSchema dibangun dari konstanta pertanyaan.ts', () => {
  it('kunci spak/skm persis kunci pertanyaan, dan batas rentang mengikuti RENTANG (tepi dalam diterima, tepi luar ditolak)', () => {
    expect(Object.keys(kirimSurveiSchema.shape.spak.shape)).toEqual(PERTANYAAN_SPAK.map((p) => p.kunci));
    expect(Object.keys(kirimSurveiSchema.shape.skm.shape)).toEqual(UNSUR_SKM.map((u) => u.kunci));

    const dengan = (spak: number, skm: number) => ({
      token: TOKEN,
      spak: Object.fromEntries(PERTANYAAN_SPAK.map((p) => [p.kunci, spak])),
      skm: Object.fromEntries(UNSUR_SKM.map((u) => [u.kunci, skm])),
    });
    expect(kirimSurveiSchema.safeParse(dengan(RENTANG.spak.min, RENTANG.skm.min)).success).toBe(true);
    expect(kirimSurveiSchema.safeParse(dengan(RENTANG.spak.max, RENTANG.skm.max)).success).toBe(true);
    expect(kirimSurveiSchema.safeParse(dengan(RENTANG.spak.min - 1, RENTANG.skm.min)).success).toBe(false);
    expect(kirimSurveiSchema.safeParse(dengan(RENTANG.spak.max + 1, RENTANG.skm.max)).success).toBe(false);
    expect(kirimSurveiSchema.safeParse(dengan(RENTANG.spak.max, RENTANG.skm.min - 1)).success).toBe(false);
    expect(kirimSurveiSchema.safeParse(dengan(RENTANG.spak.max, RENTANG.skm.max + 1)).success).toBe(false);
  });

  it('token 32 dan 128 karakter diterima, 31 dan 129 ditolak', () => {
    const b = (token: string) => ({ ...validBody, token });
    expect(kirimSurveiSchema.safeParse(b('a'.repeat(32))).success).toBe(true);
    expect(kirimSurveiSchema.safeParse(b('a'.repeat(128))).success).toBe(true);
    expect(kirimSurveiSchema.safeParse(b('a'.repeat(31))).success).toBe(false);
    expect(kirimSurveiSchema.safeParse(b('a'.repeat(129))).success).toBe(false);
  });
});
