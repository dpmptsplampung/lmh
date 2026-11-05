// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => {
  vi.resetModules();
  return { gagal: true, toast: vi.fn(), baca: vi.fn() };
});
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/components/layout/PageHeader', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({
  from: (tabel: string) => {
    h.baca(tabel);
    const hasil = () => h.gagal
      ? { data: null, error: { message: 'Koneksi terputus' } }
      : { data: [], error: null };
    const kueri = {
      select: () => kueri,
      order: () => kueri,
      then: (resolve: (v: ReturnType<typeof hasil>) => unknown) => Promise.resolve(hasil()).then(resolve),
    };
    return kueri;
  },
}) }));

import UmkmPage from './page';
import GalleryPage from '../gallery/page';
import DokumenPage from '../dokumen/page';

beforeEach(() => { h.gagal = true; h.toast.mockClear(); h.baca.mockClear(); });
afterEach(cleanup);

describe('keadaan daftar admin', () => {
  it.each([
    { nama: 'UMKM', Halaman: UmkmPage, pesan: 'Gagal memuat data UMKM. Silakan coba lagi.', kosong: /Belum ada listing UMKM/ },
    { nama: 'galeri', Halaman: GalleryPage, pesan: 'Gagal memuat data galeri. Silakan coba lagi.', kosong: /Belum ada dokumen\./ },
    { nama: 'dokumen', Halaman: DokumenPage, pesan: 'Gagal memuat dokumen', kosong: /Belum ada dokumen\./ },
  ])('$nama membedakan gagal dan kosong serta bisa dicoba lagi', async ({ Halaman, pesan, kosong }) => {
    render(<Halaman />);
    expect(await screen.findByText(pesan)).toBeTruthy();
    expect(screen.queryByText(kosong)).toBeNull();
    expect(screen.queryAllByText('0')).toHaveLength(0);
    h.gagal = false;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText(kosong)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(h.baca.mock.calls.length).toBeGreaterThan(1);
  });
});
