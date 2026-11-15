// @vitest-environment node
// Helper klien `segarkanPublik`: meminta server membuang cache data publik setelah admin menyimpan. Kegagalan APA PUN
// diabaikan (tidak melempar, tidak ada toast): paling buruk halaman publik basi sampai revalidate 60 detik berikutnya.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_PUBLIK_KLIEN, segarkanPublik } from './segarkanPublik';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const badan = (panggilan: unknown[]) => JSON.parse((panggilan[1] as { body: string }).body) as { tag: string };

describe('segarkanPublik', () => {
  it('satu tag -> satu POST /api/admin/revalidasi dengan badan { tag }', async () => {
    await segarkanPublik(TAG_PUBLIK_KLIEN.beranda);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/revalidasi');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(badan(fetchMock.mock.calls[0])).toEqual({ tag: 'publik-beranda' });
  });

  it('keepalive menyala: permintaan tetap selesai walau admin langsung berpindah halaman', async () => {
    await segarkanPublik('publik-faq');
    expect((fetchMock.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
  });

  it('daftar tag -> satu POST per tag, tiap tag tepat sekali', async () => {
    await segarkanPublik([TAG_PUBLIK_KLIEN.layanan, TAG_PUBLIK_KLIEN.beranda]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(badan).map((b) => b.tag).sort()).toEqual(['publik-beranda', 'publik-layanan']);
  });

  it('tag kembar dalam daftar digabung (satu panggilan per tag)', async () => {
    await segarkanPublik(['publik-layanan', 'publik-layanan', 'publik-beranda']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('daftar kosong -> tidak memanggil fetch', async () => {
    await segarkanPublik([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetch menolak (jaringan putus) -> tidak melempar', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(segarkanPublik('publik-beranda')).resolves.toBeUndefined();
  });

  it('fetch melempar sinkron -> tidak melempar', async () => {
    fetchMock.mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(segarkanPublik('publik-beranda')).resolves.toBeUndefined();
  });

  it('fetch tidak tersedia sama sekali -> tidak melempar', async () => {
    vi.stubGlobal('fetch', undefined);
    await expect(segarkanPublik('publik-beranda')).resolves.toBeUndefined();
  });

  it('respons 401/403/500 diabaikan (tanpa melempar)', async () => {
    for (const status of [401, 403, 500]) {
      fetchMock.mockResolvedValue({ ok: false, status, json: () => Promise.resolve({ error: 'x' }) });
      await expect(segarkanPublik(['publik-beranda', 'publik-layanan'])).resolves.toBeUndefined();
    }
  });

  it('satu tag gagal tidak membatalkan tag lain', async () => {
    fetchMock.mockRejectedValueOnce(new Error('gagal'));
    await expect(segarkanPublik(['publik-layanan', 'publik-beranda'])).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
