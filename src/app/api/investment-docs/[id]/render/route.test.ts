// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ putObject: vi.fn(async () => {}), deleteObjects: vi.fn(async () => {}) }));
vi.mock('../../_logika/pdf', () => ({ bacaPdf: vi.fn(async () => new Uint8Array()), bukaPdf: vi.fn(async () => ({ doc: { numPages: 10 }, tutup: vi.fn() })), renderHalaman: vi.fn(async () => Buffer.from('png')) }));
import { createClient } from '@/lib/supabase/server';
import { putObject, deleteObjects } from '@/lib/storage/r2';
import { revalidateTag } from 'next/cache';
import { renderHalaman } from '../../_logika/pdf';
import { tiruan, context, request, ID } from '../../_logika/uji-fixture';
import { POST } from './route';
let t: ReturnType<typeof tiruan>;
beforeEach(() => { vi.clearAllMocks(); t = tiruan(); vi.mocked(createClient).mockResolvedValue(t.sb); });
describe('render PDF bertahap', () => {
  it.each(['error', 'nol'])('PUT berhasil, checkpoint %s: PNG dibersihkan', async mode => {
    vi.mocked(putObject).mockImplementationOnce(async () => {
      if (mode === 'error') t.state.updateError = { code: 'XX000' };
      else t.state.nol = true;
    });
    expect((await POST(request({ mulai: 1 }), context)).status).toBe(mode === 'error' ? 500 : 409);
    const path = vi.mocked(putObject).mock.calls[0][1];
    expect(deleteObjects).toHaveBeenCalledWith('private', [path]);
    expect(t.state.rows[0].halaman_selesai).toBe(0);
  });
  it('baris hilang setelah PUT: PNG yang baru diunggah tetap dibersihkan', async () => {
    vi.mocked(putObject).mockImplementationOnce(async () => { t.state.rows = []; });
    expect((await POST(request({ mulai: 1 }), context)).status).toBe(409);
    expect(deleteObjects).toHaveBeenCalledWith('private', [vi.mocked(putObject).mock.calls[0][1]]);
  });
  it('autentikasi dan modul diperiksa sebelum storage', async () => {
    t.state.user = null; expect((await POST(request({ mulai: 1 }), context)).status).toBe(401);
    t.state.user = { id: 'u' }; t.state.boleh = false;
    expect((await POST(request({ mulai: 1 }), context)).status).toBe(403);
    expect(putObject).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, 52])('menolak mulai tidak sah %s', async mulai => {
    expect((await POST(request({ mulai }), context)).status).toBe(400);
    expect(renderHalaman).not.toHaveBeenCalled();
  });
  it('dokumen yang tidak terlihat 404 tanpa render', async () => {
    t.state.rows = [];
    expect((await POST(request({ mulai: 1 }), context)).status).toBe(404);
    expect(renderHalaman).not.toHaveBeenCalled();
  });
  it.each(['raw/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/x.pdf', 'src/22222222-2222-4222-8222-222222222222.pdf', '_raw/lama.pdf'])(
    'file_path selain salinan final dokumen ini (%s) ditolak tanpa membaca storage', async path => {
      const { bacaPdf } = await import('../../_logika/pdf');
      t.state.rows[0].file_path = path;
      expect((await POST(request({ mulai: 1 }), context)).status).toBe(409);
      expect(bacaPdf).not.toHaveBeenCalled();
      expect(t.state.rows[0].diproses_pada).toBeNull();
    });
  it('mulai yang salah 409 tanpa render dan id salah 400', async () => {
    expect((await POST(request({ mulai: 2 }), context)).status).toBe(409);
    expect((await POST(request({ mulai: 1 }), { params: Promise.resolve({ id: 'salah' }) })).status).toBe(400);
    expect(renderHalaman).not.toHaveBeenCalled();
  });
  it('maksimal delapan halaman, kemajuan ditulis per halaman, dilanjutkan sampai aktif', async () => {
    const a = await POST(request({ mulai: 1 }), context);
    expect(a.status).toBe(200); expect(await a.json()).toEqual({ halaman_selesai: 8, jumlah_halaman: 10, selesai: false });
    expect(renderHalaman).toHaveBeenCalledTimes(8); expect(revalidateTag).not.toHaveBeenCalled();
    expect(t.state.updates.filter(p => p.halaman_selesai !== undefined).map(p => p.halaman_selesai)).toEqual([1,2,3,4,5,6,7,8]);
    const b = await POST(request({ mulai: 9 }), context);
    expect(await b.json()).toEqual({ halaman_selesai: 10, jumlah_halaman: 10, selesai: true });
    expect(t.state.rows[0]).toMatchObject({ status: 'aktif', halaman_selesai: 10, diproses_pada: null });
    expect(putObject).toHaveBeenLastCalledWith('private', expect.stringMatching(new RegExp(`^investment-docs/pages/${ID}/[0-9a-f-]{36}/page-10.png$`)), expect.any(Buffer), 'image/png');
    expect(revalidateTag).toHaveBeenCalledWith('publik-investasi', { expire: 0 });
    expect((await POST(request({ mulai: 9 }), context)).status).toBe(409);
    expect((await POST(request({ mulai: 11 }), context)).status).toBe(200);
    expect(renderHalaman).toHaveBeenCalledTimes(10);
  });
  it('dua pemanggil mulai sama hanya satu memperoleh klaim CAS', async () => {
    const responses = await Promise.all([POST(request({ mulai: 1 }), context), POST(request({ mulai: 1 }), context)]);
    expect(responses.map(r => r.status).sort()).toEqual([200,409]);
    expect(renderHalaman).toHaveBeenCalledTimes(8);
  });
  it('lease aktif ditolak, lease kedaluwarsa dapat diambil ulang', async () => {
    t.state.rows[0].diproses_pada = new Date().toISOString();
    expect((await POST(request({ mulai: 1 }), context)).status).toBe(409);
    t.state.rows[0].diproses_pada = '2020-01-01T00:00:00Z';
    expect((await POST(request({ mulai: 1 }), context)).status).toBe(200);
  });
  it('kegagalan storage mempertahankan kemajuan; retry mulai dari halaman terakhir', async () => {
    vi.mocked(putObject).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('personal@example.invalid'));
    const r = await POST(request({ mulai: 1 }), context);
    expect(r.status).toBe(500); expect(JSON.stringify(await r.json())).not.toContain('personal@');
    expect(t.state.rows[0]).toMatchObject({ status: 'gagal', halaman_selesai: 1, diproses_pada: null });
    expect(String(t.state.rows[0].galat)).not.toContain('personal@');
    expect((await POST(request({ mulai: 2 }), context)).status).toBe(200);
    expect(t.state.rows[0].halaman_selesai).toBe(9);
  });
  it('0 baris CAS 409 dan galat DB 500 tanpa memulai render', async () => {
    t.state.nol = true;
    expect((await POST(request({ mulai: 1 }), context)).status).toBe(409);
    t.state.nol = false; t.state.updateError = { code: 'XX000', message: 'rahasia' };
    expect((await POST(request({ mulai: 1 }), context)).status).toBe(500);
    expect(renderHalaman).not.toHaveBeenCalled();
  });
});
