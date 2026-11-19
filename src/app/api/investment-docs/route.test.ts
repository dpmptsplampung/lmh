// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ headObject: vi.fn(async () => ({ size: 100, contentType: 'application/pdf', etag: 'snapshot-A' })), copyObject: vi.fn(async () => {}), deleteObjects: vi.fn(async () => {}) }));
vi.mock('./_logika/pdf', () => ({ MAKS_BYTE: 50 * 1024 * 1024, bacaPdf: vi.fn(async () => new Uint8Array()), bukaPdf: vi.fn(async () => ({ doc: { numPages: 12 }, tutup: vi.fn() })) }));
import { createClient } from '@/lib/supabase/server';
import { copyObject, deleteObjects } from '@/lib/storage/r2';
import { bacaPdf, bukaPdf } from './_logika/pdf';
import { tiruan, kunci, request } from './_logika/uji-fixture';
import { POST } from './route';
let t: ReturnType<typeof tiruan>;
beforeEach(() => { vi.clearAllMocks(); t = tiruan(); vi.mocked(createClient).mockResolvedValue(t.sb); });
describe('buat catatan PDF yang telah diunggah', () => {
  it('B tidak dapat mendaftarkan raw milik A atau menghapusnya', async () => {
    t.state.user = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    expect((await POST(request({ kunci, judul: 'Kajian' }))).status).toBe(403);
    expect(copyObject).not.toHaveBeenCalled(); expect(deleteObjects).not.toHaveBeenCalled();
  });
  it('kunci hanya dapat dikonsumsi sekali, termasuk sesudah dokumen dihapus', async () => {
    expect((await POST(request({ kunci, judul: 'Kajian' }))).status).toBe(201);
    t.state.rows = [];
    vi.mocked(deleteObjects).mockClear();
    expect((await POST(request({ kunci, judul: 'Duplikat' }))).status).toBe(409);
    expect(deleteObjects).not.toHaveBeenCalled();
  });
  it('dua pendaftaran serentak hanya satu menyalin sumber', async () => {
    const responses = await Promise.all([POST(request({ kunci, judul: 'A' })), POST(request({ kunci, judul: 'B' }))]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect(copyObject).toHaveBeenCalledTimes(1);
  });
  it('tanpa sesi 401; bukan pengelola investasi 403 sebelum membaca objek', async () => {
    t.state.user = null; expect((await POST(request({ kunci, judul: 'Kajian' }))).status).toBe(401);
    t.state.user = { id: 'u' }; t.state.boleh = false;
    expect((await POST(request({ kunci, judul: 'Kajian' }))).status).toBe(403);
    expect(bacaPdf).not.toHaveBeenCalled();
  });
  it.each([{ kunci: 'umkm-draf/a.pdf' }, { status: 'aktif' }, { judul: '' }, { judul: 'Judul\u0000' }, { urutan_tampil: -1 }])('menolak isian %j', async ubah => {
    expect((await POST(request({ kunci, judul: 'Kajian', ...ubah }))).status).toBe(400);
    expect(bacaPdf).not.toHaveBeenCalled();
  });
  it('badan JSON lebih dari 16 KiB ditolak', async () => {
    expect((await POST(request({ kunci, judul: 'x'.repeat(17000) }))).status).toBe(400);
  });
  it('objek hilang 404, PDF tidak valid 400, tanpa insert', async () => {
    vi.mocked(bacaPdf).mockRejectedValueOnce(new Error('TIDAK_DITEMUKAN'));
    expect((await POST(request({ kunci, judul: 'Kajian' }))).status).toBe(404);
    vi.mocked(bukaPdf).mockRejectedValueOnce(new Error('INPUT_TIDAK_VALID'));
    const baru = kunci.replace('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');
    expect((await POST(request({ kunci: baru, judul: 'Kajian' }))).status).toBe(400);
    expect(t.state.rows).toHaveLength(1);
  });
  it('201 menyimpan jumlah halaman dari parser dan status diproses tanpa PDF dalam request', async () => {
    const r = await POST(request({ kunci, judul: ' Kajian ', urutan_tampil: 3 }));
    expect(r.status).toBe(201); expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await r.json();
    expect(body).toEqual({ id: expect.any(String), jumlah_halaman: 12 });
    expect(t.state.rows[1]).toMatchObject({ judul: 'Kajian', jumlah_halaman: 12, status: 'diproses', halaman_selesai: 0, file_path: `src/${body.id}.pdf`, halaman_gambar: [] });
  });
  it('galat insert tidak membocorkan PII', async () => {
    t.state.insertError = { code: 'XX000', message: 'data personal@example.invalid' };
    const r = await POST(request({ kunci, judul: 'Kajian' }));
    expect(r.status).toBe(500); expect(JSON.stringify(await r.json())).not.toContain('personal@');
  });
});
