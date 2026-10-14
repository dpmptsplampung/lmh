// Halaman lama /admin/fo/daftar dan /admin/scan: redirect server-side ke /admin/fo/registrasi?tab=..., query diteruskan.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import FoDaftarRedirect from './daftar/page';
import AdminScanRedirect from '../scan/page';

async function tujuan(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return (e as Error).message.replace('NEXT_REDIRECT:', '');
  }
  throw new Error('tidak redirect');
}

describe('redirect halaman lama ke Registrasi Pengunjung', () => {
  beforeEach(() => {
    redirectMock.mockReset();
    redirectMock.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
  });

  it('/admin/fo/daftar -> ?tab=walkin', async () => {
    expect(await tujuan(FoDaftarRedirect({ searchParams: Promise.resolve({}) }))).toBe('/admin/fo/registrasi?tab=walkin');
  });

  it('/admin/scan -> ?tab=scan', async () => {
    expect(await tujuan(AdminScanRedirect({ searchParams: Promise.resolve({}) }))).toBe('/admin/fo/registrasi?tab=scan');
  });

  it('query string yang ada ikut diteruskan; tab lama pada URL lama tidak menimpa tab tujuan', async () => {
    expect(await tujuan(AdminScanRedirect({ searchParams: Promise.resolve({ token: 'tok-1', tab: 'walkin' }) }))).toBe(
      '/admin/fo/registrasi?tab=scan&token=tok-1',
    );
    expect(await tujuan(FoDaftarRedirect({ searchParams: Promise.resolve({ nama: ['a', 'b'] }) }))).toBe(
      '/admin/fo/registrasi?tab=walkin&nama=a&nama=b',
    );
  });
});
