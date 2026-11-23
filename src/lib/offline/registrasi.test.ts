import { afterEach, describe, expect, it, vi } from 'vitest';
import { daftarkanServiceWorker } from './registrasi';

function wadah(registrasi: Partial<ServiceWorkerRegistration>, ready: Promise<Partial<ServiceWorkerRegistration>>) {
  const register = vi.fn().mockResolvedValue(registrasi);
  return { register, container: { register, ready } as unknown as ServiceWorkerContainer };
}

afterEach(() => vi.useRealTimers());

describe('registrasi service worker LMH', () => {
  it('berbagi registrasi root yang aktif antara layout dan tombol push', async () => {
    const reg = { scope: 'https://lmh.test/', active: {} as ServiceWorker, pushManager: {} as PushManager };
    const { container, register } = wadah(reg, new Promise(() => {}));

    const layout = daftarkanServiceWorker(container);
    const notifikasi = daftarkanServiceWorker(container);
    expect(await layout).toBe(reg);
    expect(await notifikasi).toBe(reg);
    expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/', updateViaCache: 'none' });
  });

  it('menunggu aktivasi pertama pada scope yang sama', async () => {
    const reg = { scope: 'https://lmh.test/', active: null };
    const aktif = { ...reg, active: {} as ServiceWorker };
    const { container } = wadah(reg, Promise.resolve(aktif));
    await expect(daftarkanServiceWorker(container)).resolves.toBe(aktif);
  });

  it('gagal setelah batas aktivasi dan dapat dicoba kembali', async () => {
    vi.useFakeTimers();
    const reg = { scope: 'https://lmh.test/', active: null };
    const { container, register } = wadah(reg, new Promise(() => {}));
    const gagal = expect(daftarkanServiceWorker(container)).rejects.toThrow(/belum aktif/);
    await vi.advanceTimersByTimeAsync(10000);
    await gagal;

    const aktif = { ...reg, active: {} as ServiceWorker };
    register.mockResolvedValueOnce(aktif);
    await expect(daftarkanServiceWorker(container)).resolves.toBe(aktif);
    expect(register).toHaveBeenCalledTimes(2);
  });
});
