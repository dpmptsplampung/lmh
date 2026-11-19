// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { revalidateTag } from 'next/cache';
import { GET, POST } from './route';
import { buatSupabaseTiruan, isianProyek, request } from './uji-fixture';
let t: ReturnType<typeof buatSupabaseTiruan>;
beforeEach(() => { vi.clearAllMocks(); t = buatSupabaseTiruan(); vi.mocked(createClient).mockResolvedValue(t.sb); });
describe('daftar dan buat IPRO', () => {
  it.each([GET, POST])('menolak tanpa sesi dan modul investasi', async handler => {
    t.state.user = null; expect((await handler(request('POST', isianProyek))).status).toBe(401);
    t.state.user = { id: 'user' }; t.state.boleh = false;
    expect((await handler(request('POST', isianProyek))).status).toBe(403);
  });
  it('daftar membatasi rentang, mengembalikan count dan cache privat', async () => {
    expect((await GET(request('GET', undefined, '?dari=0&sampai=100'))).status).toBe(400);
    const r = await GET(request('GET', undefined, '?sumber=ptsp'));
    expect(r.status).toBe(200); expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await r.json()).toMatchObject({ count: 1, data: [{ judul: 'Energi Lampung' }] });
  });
  it('menolak mass assignment status dan badan terlalu besar', async () => {
    expect((await POST(request('POST', { ...isianProyek, status: 'terbit' }))).status).toBe(400);
    expect((await POST(request('POST', { ...isianProyek, ringkasan: 'é'.repeat(9000) }))).status).toBe(400);
  });
  it('membuat draf dengan slug unik yang dibentuk server', async () => {
    const r = await POST(request('POST', isianProyek));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ data: { slug: 'energi-lampung-2', status: 'draf', versi: 1 } });
    expect(revalidateTag).toHaveBeenCalledWith('publik-investasi', { expire: 0 });
  });
  it('membuat cuplikan FOILA dan menurunkan identitas sumber', async () => {
    const r = await POST(request('POST', { ...isianProyek, judul: 'Pelabuhan', sumber: 'foila', sumber_url: 'https://invest.lampungprov.go.id/project/pelabuhan/' }));
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ data: { sumber_slug: 'pelabuhan', sumber_url: 'https://invest.lampungprov.go.id/project/pelabuhan/' } });
  });
  it('duplikat sumber FOILA 409 tanpa pesan database', async () => {
    t.state.galat.push({ tabel: 'ipro_proyek', operasi: 'insert', error: { code: '23505', message: 'ipro_foila_unik personal@example.test' } });
    const r = await POST(request('POST', { ...isianProyek, sumber: 'foila', sumber_url: 'https://invest.lampungprov.go.id/project/pelabuhan' }));
    expect(r.status).toBe(409); expect(JSON.stringify(await r.json())).not.toContain('personal@example.test');
  });
});
