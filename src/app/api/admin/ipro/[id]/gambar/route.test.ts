// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ headObject: vi.fn(), getObjectBytes: vi.fn(), putObject: vi.fn(), deleteObjects: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { deleteObjects, getObjectBytes, headObject, putObject } from '@/lib/storage/r2';
import { logServerEvent } from '@/lib/observability/logger';
import { POST } from './route';
import { buatSupabaseTiruan, gambar, ID, LAIN_ID, konteks, request } from '../../uji-fixture';
let t: ReturnType<typeof buatSupabaseTiruan>;
const input = { kunci_mentah: `ipro-mentah/${ID}/${LAIN_ID}.png`, alt: 'Lokasi proyek' };
beforeEach(async () => {
  vi.resetAllMocks(); t = buatSupabaseTiruan(); vi.mocked(createClient).mockResolvedValue(t.sb);
  vi.mocked(headObject).mockResolvedValue({ size: 100, contentType: 'image/png' });
  vi.mocked(getObjectBytes).mockResolvedValue(await sharp({ create: { width: 16, height: 10, channels: 3, background: 'red' } }).png().toBuffer());
  vi.mocked(putObject).mockResolvedValue(undefined); vi.mocked(deleteObjects).mockResolvedValue(undefined);
});
it('auth 401/403 dan validasi 400 sebelum mengakses gambar mentah', async () => {
  t.state.user = null; expect((await POST(request('POST', input), konteks())).status).toBe(401);
  t.state.user = { id: 'u' }; t.state.boleh = false; expect((await POST(request('POST', input), konteks())).status).toBe(403);
  t.state.boleh = true;
  expect((await POST(request('POST', { ...input, kunci_mentah: `ipro-mentah/${LAIN_ID}/${LAIN_ID}.png` }), konteks())).status).toBe(400);
  expect(getObjectBytes).not.toHaveBeenCalled();
});
it('membatasi FOILA satu gambar dan PTSP dua belas', async () => {
  t.state.tabel.ipro_proyek[0].sumber = 'foila';
  expect((await POST(request('POST', input), konteks())).status).toBe(409);
  t.state.tabel.ipro_proyek[0].sumber = 'ptsp';
  t.state.tabel.ipro_gambar = Array.from({ length: 12 }, () => ({ ...t.state.tabel.ipro_gambar[0] }));
  expect((await POST(request('POST', input), konteks())).status).toBe(409);
  expect(getObjectBytes).not.toHaveBeenCalled();
});
it('menghasilkan gambar WebP dan menyimpan metadata aman', async () => {
  const r = await POST(request('POST', input), konteks());
  expect(r.status).toBe(201);
  expect(await r.json()).toMatchObject({ data: { proyek_id: ID, lebar: 16, tinggi: 10, alt: 'Lokasi proyek', urutan: 1 } });
  expect(putObject).toHaveBeenCalledTimes(2);
});
it('membersihkan objek bila insert metadata gagal dan memetakan konflik 409', async () => {
  t.state.galat.push({ tabel: 'ipro_gambar', operasi: 'insert', error: { code: '23505', message: 'unique' } });
  expect((await POST(request('POST', { ...input, utama: true }), konteks())).status).toBe(409);
  expect(t.state.tabel.ipro_gambar.filter(g => g.utama)).toHaveLength(1);
  expect(deleteObjects).toHaveBeenCalledWith('public', [expect.stringMatching(/\.webp$/), expect.stringMatching(/-640.webp$/)]);
});
it('menolak skrip berlabel gambar dan tidak menyimpan metadata', async () => {
  vi.mocked(getObjectBytes).mockResolvedValue(Buffer.from('<svg><script/></svg>'));
  expect((await POST(request('POST', input), konteks())).status).toBe(400);
  expect(t.state.catatan.some(q => q.operasi === 'insert')).toBe(false);
});
it('status commit tidak pasti akibat jaringan dicatat tanpa menghapus objek yang mungkin sudah dirujuk DB', async () => {
  t.state.galat.push({ tabel: 'ipro_gambar', operasi: 'insert', error: { message: 'fetch failed internal' } });
  const response = await POST(request('POST', input), konteks());
  expect(response.status).toBe(500);
  expect(deleteObjects).not.toHaveBeenCalledWith('public', expect.anything());
  expect(logServerEvent).toHaveBeenCalledWith('warn', { operation: 'investasi.gambar.commit_tidak_pasti',
    requestId: expect.any(String), kunci: [expect.stringMatching(/\.webp$/), expect.stringMatching(/-640.webp$/)] });
  expect(await response.text()).not.toContain('internal');
});
it.each([['ptsp', 11, 12], ['foila', 0, 1]])('unggahan serentak %s melewati snapshot yang sama tetapi batas RPC tetap berlaku', async (sumber, awal, akhir) => {
  t.state.tabel.ipro_proyek[0].sumber = sumber;
  t.state.tabel.ipro_gambar = Array.from({ length: awal }, (_, i) => ({ ...gambar(), id: `lama-${i}`, utama: i === 0 }));
  const responses = await Promise.all([0, 1].map(() => POST(request('POST', { ...input, utama: false }), konteks())));
  expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
  expect(t.state.tabel.ipro_gambar).toHaveLength(akhir);
  expect(t.state.tabel.ipro_gambar.filter(g => g.utama)).toHaveLength(1);
});
