// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { GalleryDoc } from '../_logika/tipe';
import { useGalleryData } from './useGalleryData';

vi.mock('@/components/Toast', () => {
  const toast = vi.fn();
  return { useToast: () => ({ toast }) };
});
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
  }),
}));

afterEach(() => vi.unstubAllGlobals());

const dokumen = (id: string): GalleryDoc => ({
  id, judul: id, file_path: id + '.pdf', kategori: null, urutan_tampil: 0,
  jumlah_halaman: 1, status: 'aktif', deskripsi: null, nilai_investasi: null,
  image_url: null, halaman_selesai: 1, galat: null,
});

it('menampilkan URL pratinjau permintaan terbaru saat respons tiba terbalik', async () => {
  const a = Promise.withResolvers<Response>();
  const b = Promise.withResolvers<Response>();
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise));
  const { result } = renderHook(useGalleryData);
  let pertama!: Promise<void>;
  let kedua!: Promise<void>;

  act(() => { pertama = result.current.handleViewDoc(dokumen('A')); });
  act(() => {
    result.current.setViewingDoc(null);
    kedua = result.current.handleViewDoc(dokumen('B'));
  });
  await act(async () => {
    b.resolve(Response.json({ signedUrl: 'https://lokal.test/B' }));
    await kedua;
  });
  await act(async () => {
    a.resolve(Response.json({ signedUrl: 'https://lokal.test/A' }));
    await pertama;
  });
  expect(result.current.viewingDoc?.id).toBe('B');
  expect(result.current.signedUrl).toBe('https://lokal.test/B');
  expect(result.current.loadingSignedUrl).toBe(false);
});
