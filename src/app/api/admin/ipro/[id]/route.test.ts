// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ deleteObjects: vi.fn(), urlPublik: (kunci: string) => `https://gambar.test/${kunci}` }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { deleteObjects } from '@/lib/storage/r2';
import { GET, PATCH, DELETE } from './route';
import { buatSupabaseTiruan, konteks, request } from '../uji-fixture';
let t: ReturnType<typeof buatSupabaseTiruan>;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(deleteObjects).mockResolvedValue(undefined); t = buatSupabaseTiruan(); vi.mocked(createClient).mockResolvedValue(t.sb); });
it.each([GET, PATCH, DELETE])('memeriksa auth 401/403 setiap metode', async handler => {
  t.state.user = null; expect((await handler(request('PATCH', { versi: 1, judul: 'Baru' }), konteks())).status).toBe(401);
  t.state.user = { id: 'user' }; t.state.boleh = false;
  expect((await handler(request('PATCH', { versi: 1, judul: 'Baru' }), konteks())).status).toBe(403);
});
it('detail hanya ID sah, 404 bila tidak ada, sukses dengan gambar', async () => {
  expect((await GET(request('GET'), konteks('salah'))).status).toBe(400);
  const respons = await GET(request('GET'), konteks());
  expect(respons.status).toBe(200);
  const { data } = await respons.json();
  expect(data.gambar).toHaveLength(1);
  expect(data.gambar[0]).toMatchObject({
    url: `https://gambar.test/${t.state.tabel.ipro_gambar[0].kunci}`,
    url_mini: `https://gambar.test/${t.state.tabel.ipro_gambar[0].kunci_mini}`,
  });
  t.state.tabel.ipro_proyek = [];
  expect((await GET(request('GET'), konteks())).status).toBe(404);
});
it('PATCH ketat, mencegah hilang pembaruan dengan versi', async () => {
  expect((await PATCH(request('PATCH', { judul: 'Baru' }), konteks())).status).toBe(400);
  expect((await PATCH(request('PATCH', { versi: 2, judul: 'Baru' }), konteks())).status).toBe(409);
  const r = await PATCH(request('PATCH', { versi: 1, judul: 'Judul baru' }), konteks());
  expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ data: { judul: 'Judul baru', versi: 2 } });
});
it('PATCH FOILA menolak penambahan detail dan menjaga koordinat', async () => {
  expect((await PATCH(request('PATCH', { versi: 1, lat: -5 }), konteks())).status).toBe(400);
  Object.assign(t.state.tabel.ipro_proyek[0], { sumber: 'foila', sumber_url: 'https://invest.lampungprov.go.id/x' });
  expect((await PATCH(request('PATCH', { versi: 1, deskripsi: 'Detail baru' }), konteks())).status).toBe(400);
});
it('konflik DB saat update menjadi 409 dan tidak menghapus objek', async () => {
  t.state.galat.push({ tabel: 'ipro_proyek', operasi: 'update', error: { message: 'SLUG_TERKUNCI' } });
  expect((await PATCH(request('PATCH', { versi: 1, slug: 'slug-baru' }), konteks())).status).toBe(409);
  expect(deleteObjects).not.toHaveBeenCalled();
});
it('DELETE hanya draf dan menghapus objek setelah baris', async () => {
  t.state.tabel.ipro_proyek[0].status = 'terbit';
  expect((await DELETE(request('DELETE'), konteks())).status).toBe(409);
  t.state.tabel.ipro_proyek[0].status = 'draf';
  const r = await DELETE(request('DELETE'), konteks());
  expect(r.status).toBe(204); expect(await r.text()).toBe('');
  expect(deleteObjects).toHaveBeenCalledWith('public', [expect.stringMatching(/\.webp$/), expect.stringMatching(/-640.webp$/)]);
});
it('hapus R2 gagal tetap menyelesaikan penghapusan baris', async () => {
  vi.mocked(deleteObjects).mockRejectedValue(new Error('gagal'));
  expect((await DELETE(request('DELETE'), konteks())).status).toBe(204);
});
