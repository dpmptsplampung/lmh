// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ deleteObjects: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { deleteObjects } from '@/lib/storage/r2';
import { logServerEvent } from '@/lib/observability/logger';
import { PATCH, DELETE } from './route';
import { buatSupabaseTiruan, gambar, ID, GAMBAR_ID, LAIN_ID, konteksGambar, request } from '../../../uji-fixture';
let t: ReturnType<typeof buatSupabaseTiruan>;
beforeEach(() => { vi.resetAllMocks(); t = buatSupabaseTiruan(); vi.mocked(createClient).mockResolvedValue(t.sb); vi.mocked(deleteObjects).mockResolvedValue(undefined); });
it.each([PATCH, DELETE])('menjaga auth untuk setiap metode', async handler => {
  t.state.user = null; expect((await handler(request('PATCH', { alt: 'Baru' }), konteksGambar())).status).toBe(401);
  t.state.user = { id: 'u' }; t.state.boleh = false; expect((await handler(request('PATCH', { alt: 'Baru' }), konteksGambar())).status).toBe(403);
});
it('validasi 400 dan IDOR 404 tanpa mutasi proyek lain', async () => {
  expect((await PATCH(request('PATCH', { kunci: 'x' }), konteksGambar())).status).toBe(400);
  t.state.tabel.ipro_gambar[0].proyek_id = LAIN_ID;
  expect((await PATCH(request('PATCH', { utama: true }), konteksGambar())).status).toBe(404);
  expect((await DELETE(request('DELETE'), konteksGambar())).status).toBe(404);
  expect(deleteObjects).not.toHaveBeenCalled();
});
it('mengubah alt, urutan, utama hanya dalam proyek yang sama', async () => {
  const r = await PATCH(request('PATCH', { alt: 'Lokasi terbaru', urutan: 3, utama: true }), konteksGambar());
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ data: { id: GAMBAR_ID, alt: 'Lokasi terbaru', urutan: 3, utama: true } });
});
it('konflik indeks utama menjadi 409', async () => {
  t.state.galat.push({ tabel: 'ipro_gambar', operasi: 'update', error: { code: '23505', message: 'unique' } });
  expect((await PATCH(request('PATCH', { utama: true }), konteksGambar())).status).toBe(409);
});
it('kegagalan UPDATE target sesudah reset tidak menghilangkan utama lama', async () => {
  t.state.tabel.ipro_gambar.push(gambar({ id: LAIN_ID, utama: false }));
  t.state.galat.push({ tabel: 'ipro_gambar', operasi: 'update', setelah: 1,
    error: { code: '23505', message: 'gagal langkah kedua internal' } });
  const r = await PATCH(request('PATCH', { utama: true }), konteksGambar(ID, LAIN_ID));
  expect(r.status).toBe(409);
  expect(t.state.tabel.ipro_gambar.filter(g => g.utama).map(g => g.id)).toEqual([GAMBAR_ID]);
  expect(await r.text()).not.toContain('internal');
});
it('gambar utama proyek terbit tetap memenuhi syarat', async () => {
  t.state.tabel.ipro_proyek[0].status = 'terbit';
  expect((await PATCH(request('PATCH', { utama: false }), konteksGambar())).status).toBe(409);
  expect((await DELETE(request('DELETE'), konteksGambar())).status).toBe(409);
});
it('DELETE berhasil meskipun R2 gagal dihapus', async () => {
  vi.mocked(deleteObjects).mockImplementationOnce(async () => {
    expect(t.state.tabel.ipro_gambar).toHaveLength(0);
    throw new Error('gagal');
  });
  expect((await DELETE(request('DELETE'), konteksGambar())).status).toBe(204);
  expect(t.state.tabel.ipro_gambar).toHaveLength(0);
  expect(logServerEvent).toHaveBeenCalledWith('warn', { operation: 'investasi.gambar.hapus_gagal' });
  expect(t.state.catatan).toHaveLength(0);
});
