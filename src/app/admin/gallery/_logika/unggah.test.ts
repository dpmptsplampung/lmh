import { afterEach, describe, expect, it, vi } from 'vitest';
import { prosesDokumen } from './unggah';
afterEach(() => vi.unstubAllGlobals());
describe('ulangan batch PDF di klien', () => {
  it('memanggil lagi dari kemajuan server dan menampilkan kemajuan', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ halaman_selesai: 8, jumlah_halaman: 10, selesai: false }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ halaman_selesai: 10, jumlah_halaman: 10, selesai: true }) });
    vi.stubGlobal('fetch', fetch); const progress = vi.fn();
    await prosesDokumen({ id: 'd', halaman_selesai: 0, jumlah_halaman: 10 }, progress);
    expect(fetch.mock.calls.map(c => JSON.parse(c[1].body).mulai)).toEqual([1,9]);
    expect(progress.mock.calls).toEqual([[8,10],[10,10]]);
  });
  it('memulai ulang dari halaman tersimpan dan menangani finalisasi yang terputus', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ halaman_selesai: 10, jumlah_halaman: 10, selesai: true }) });
    vi.stubGlobal('fetch', fetch);
    await prosesDokumen({ id: 'd', halaman_selesai: 10, jumlah_halaman: 10 }, vi.fn());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ mulai: 11 });
  });
  it('galat atau kemajuan diam menghentikan pengulangan', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { message: 'Lanjutkan nanti.' } }) });
    vi.stubGlobal('fetch', fetch);
    await expect(prosesDokumen({ id: 'd', halaman_selesai: 0, jumlah_halaman: 10 }, vi.fn())).rejects.toThrow('Lanjutkan nanti.');
    fetch.mockResolvedValue({ ok: true, json: async () => ({ halaman_selesai: 0, jumlah_halaman: 10, selesai: false }) });
    await expect(prosesDokumen({ id: 'd', halaman_selesai: 0, jumlah_halaman: 10 }, vi.fn())).rejects.toThrow('Kemajuan dokumen berubah');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
