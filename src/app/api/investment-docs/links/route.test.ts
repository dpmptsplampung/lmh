// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { getObjectBytes } from '@/lib/storage/r2';
import { BERKAS_TAUTAN_KOSONG } from '@/lib/investasi/tautan';
import { ID, tiruan } from '../_logika/uji-fixture';
import { GET } from './route';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/storage/r2', () => ({ getObjectBytes: vi.fn() }));
const cachePublik = 'public, max-age=300, s-maxage=300';
const berkas = {
  versi: 1,
  tautan: [
    { hal: 1, x: 0.1, y: 0.2, w: 0.2, h: 0.1, ke: 2 },
    { hal: 2, x: 0.2, y: 0.1, w: 0.2, h: 0.1, url: 'https://lampung.example/' },
  ],
};
const bytes = (data: unknown) => new TextEncoder().encode(JSON.stringify(data));
let db: ReturnType<typeof tiruan>;
let giliran = 0;
let ip: string;
const request = (id = ID) => new Request(`https://local.test/api/investment-docs/links?doc_id=${id}`, {
  headers: { 'x-forwarded-for': ip, cookie: 'sesi=fixture' },
});

beforeEach(() => {
  vi.resetAllMocks();
  db = tiruan();
  db.state.rows[0].status = 'aktif';
  ip = `198.51.100.${++giliran}`;
  vi.mocked(createClient).mockReturnValue(db.sb as unknown as ReturnType<typeof createClient>);
});

describe('tautan dokumen investasi publik', () => {
  it('mengirim berkas langsung dengan cache publik', async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(bytes(berkas));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(cachePublik);
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(await response.json()).toEqual(berkas);
    expect(vi.mocked(createClient).mock.calls[0][2]?.auth).toEqual({
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
    });
    expect(getObjectBytes).toHaveBeenCalledWith('private', `investment-docs/pages/${ID}/${ID}/links.json`);
  });

  it.each(['nonaktif', 'diproses', 'gagal', 'hilang'])('menyembunyikan dokumen %s sebelum membaca R2', async status => {
    if (status === 'hilang') db.state.rows = [];
    else db.state.rows[0].status = status;
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it('mengembalikan tautan kosong untuk dokumen lama tanpa berkas', async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(cachePublik);
    expect(await response.json()).toEqual(BERKAS_TAUTAN_KOSONG);
  });

  it.each([
    new TextEncoder().encode('{'),
    bytes({ versi: 9, tautan: [] }),
    bytes({ versi: 1, tautan: [{ ...berkas.tautan[0], ke: 11 }] }),
    bytes({ versi: 1, tautan: [{ ...berkas.tautan[1], url: 'javascript:alert(1)' }] }),
  ])('menolak berkas rusak atau tidak aman', async rusak => {
    vi.mocked(getObjectBytes).mockResolvedValue(rusak);
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('menyembunyikan galat dari penyimpanan', async () => {
    vi.mocked(getObjectBytes).mockRejectedValue(new Error('detail penyimpanan rahasia'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('detail penyimpanan');
  });

  it('menghentikan permintaan saat klien basis data gagal dibuat', async () => {
    vi.mocked(createClient).mockImplementationOnce(() => { throw new Error('galat konfigurasi'); });
    expect((await GET(request())).status).toBe(500);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it('menolak UUID tidak sah sebelum mengakses layanan', async () => {
    expect((await GET(request('invalid'))).status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it('membatasi 60 permintaan per menit per IP sebelum mengakses layanan', async () => {
    vi.mocked(getObjectBytes).mockResolvedValue(null);
    for (let i = 0; i < 60; i++) expect((await GET(request())).status).toBe(200);
    expect((await GET(request())).status).toBe(429);
    expect(createClient).toHaveBeenCalledTimes(60);
    ip = '203.0.113.1';
    expect((await GET(request())).status).toBe(200);
  });
});
