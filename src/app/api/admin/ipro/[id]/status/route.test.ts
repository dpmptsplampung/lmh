// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { POST } from './route';
import { buatSupabaseTiruan, konteks, request } from '../../uji-fixture';
let t: ReturnType<typeof buatSupabaseTiruan>;
beforeEach(() => { vi.clearAllMocks(); t = buatSupabaseTiruan(); vi.mocked(createClient).mockResolvedValue(t.sb); });
it('memeriksa auth, isian ketat dan versi', async () => {
  t.state.user = null; expect((await POST(request('POST', {}), konteks())).status).toBe(401);
  t.state.user = { id: 'u' }; t.state.boleh = false; expect((await POST(request('POST', {}), konteks())).status).toBe(403);
  t.state.boleh = true; expect((await POST(request('POST', { aksi: 'terbit' }), konteks())).status).toBe(400);
  expect((await POST(request('POST', { aksi: 'terbit', versi: 2 }), konteks())).status).toBe(409);
});
it('terbit memerlukan deskripsi dan gambar utama dengan daftar kekurangan', async () => {
  t.state.tabel.ipro_proyek[0].deskripsi = '';
  t.state.tabel.ipro_gambar = [];
  const r = await POST(request('POST', { aksi: 'terbit', versi: 1 }), konteks());
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({ error: { code: 'SYARAT_TERBIT', kekurangan: ['deskripsi', 'gambar_utama'] } });
});
it.each(['terbit', 'arsip', 'kembali_draf'])('aksi %s dengan versi sah berhasil', async aksi => {
  const r = await POST(request('POST', { aksi, versi: 1 }), konteks());
  expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ data: { versi: 2 } });
  expect(t.state.catatan).toHaveLength(0);
  expect(t.state.rpc.at(-1)?.nama).toBe('ipro_ubah_status');
});
it('FOILA tepat satu gambar dan host resmi', async () => {
  Object.assign(t.state.tabel.ipro_proyek[0], { sumber: 'foila', sumber_url: 'https://evil.test/x' });
  expect((await POST(request('POST', { aksi: 'terbit', versi: 1 }), konteks())).status).toBe(409);
  t.state.tabel.ipro_proyek[0].sumber_url = 'https://invest.lampungprov.go.id/x';
  expect((await POST(request('POST', { aksi: 'terbit', versi: 1 }), konteks())).status).toBe(200);
});
