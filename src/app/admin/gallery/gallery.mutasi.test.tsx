// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import type { GalleryDoc } from './_logika/tipe';

const h = vi.hoisted(() => ({ toast: vi.fn(), selects: vi.fn(), docs: [] as GalleryDoc[] }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ order: async () => {
      h.selects();
      return { data: h.docs, error: null };
    } }) }),
  }),
}));

import AdminGalleryPage from './page';

const dokumen = (id: string, judul: string, urutan_tampil: number): GalleryDoc => ({
  id, judul, urutan_tampil, kategori: null, file_path: '_raw/a.pdf', jumlah_halaman: 2,
  status: 'aktif', deskripsi: null, nilai_investasi: null, image_url: null, halaman_selesai: 2, galat: null,
});
const barisDoc = (judul: string) => screen.getByText(judul).closest('tr') as HTMLElement;
const tombolBaris = (judul: string, label: string) => within(barisDoc(judul)).getByTitle(label);

describe('Mutasi Investment Gallery', () => {
  const fetch = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    fetch.mockReset();
    vi.stubGlobal('fetch', fetch);
    h.docs = [dokumen('dA', 'Dokumen A', 1), dokumen('dB', 'Dokumen B', 2)];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([409, 500])('status gagal HTTP %s mempertahankan baris', async status => {
    fetch.mockResolvedValue(Response.json({ error: { message: 'Perubahan gagal.' } }, { status }));
    render(<AdminGalleryPage />);
    await screen.findByText('Dokumen A');
    fireEvent.click(tombolBaris('Dokumen A', 'Nonaktifkan'));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.stringContaining('Gagal mengubah status dokumen'), 'error'));
    expect(tombolBaris('Dokumen A', 'Nonaktifkan')).toBeInTheDocument();
    await waitFor(() => expect(h.selects).toHaveBeenCalledTimes(status === 409 ? 2 : 1));
  });

  it('status berubah sesudah PATCH berhasil', async () => {
    fetch.mockResolvedValue(Response.json({ data: { id: 'dA' } }));
    render(<AdminGalleryPage />);
    await screen.findByText('Dokumen A');
    fireEvent.click(tombolBaris('Dokumen A', 'Nonaktifkan'));
    await waitFor(() => expect(tombolBaris('Dokumen A', 'Aktifkan')).toBeInTheDocument());
    expect(fetch.mock.calls[0][0]).toBe('/api/investment-docs/dA');
    expect(fetch.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ aksi: 'status', status: 'nonaktif', status_lama: 'aktif' });
  });

  it('satu permintaan tiap pertukaran, panah mengikuti urutan baris terbaru', async () => {
    fetch.mockImplementation(async () => {
      h.docs = h.docs.map(d => ({ ...d, urutan_tampil: 3 - d.urutan_tampil }));
      return Response.json({ data: { id: 'dA' } });
    });
    render(<AdminGalleryPage />);
    await screen.findByText('Dokumen A');
    expect(tombolBaris('Dokumen A', 'Pindah ke atas')).toBeDisabled();
    fireEvent.click(tombolBaris('Dokumen A', 'Pindah ke bawah'));
    await waitFor(() => expect(tombolBaris('Dokumen A', 'Pindah ke bawah')).toBeDisabled());
    expect(tombolBaris('Dokumen A', 'Pindah ke atas')).toBeEnabled();
    expect(barisDoc('Dokumen B').nextElementSibling).toBe(barisDoc('Dokumen A'));
    fireEvent.click(tombolBaris('Dokumen A', 'Pindah ke atas'));
    await waitFor(() => expect(tombolBaris('Dokumen A', 'Pindah ke atas')).toBeDisabled());
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { aksi: 'urutan', tetangga_id: 'dB', urutan_lama: 1, urutan_tetangga: 2 },
      { aksi: 'urutan', tetangga_id: 'dB', urutan_lama: 2, urutan_tetangga: 1 },
    ]);
  });

  it('urutan konflik memuat ulang tanpa memalsukan pertukaran', async () => {
    fetch.mockResolvedValue(Response.json({ error: { message: 'Data telah berubah.' } }, { status: 409 }));
    render(<AdminGalleryPage />);
    await screen.findByText('Dokumen A');
    fireEvent.click(tombolBaris('Dokumen A', 'Pindah ke bawah'));
    await waitFor(() => expect(h.selects).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(tombolBaris('Dokumen A', 'Pindah ke atas')).toBeDisabled());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('edit metadata tetap menampilkan isian pada kegagalan (sukses=%s)', async ok => {
    fetch.mockResolvedValue(ok
      ? Response.json({ data: { id: 'dA' } })
      : Response.json({ error: { message: 'Anda tidak berwenang.' } }, { status: 403 }));
    render(<AdminGalleryPage />);
    await screen.findByText('Dokumen A');
    fireEvent.click(tombolBaris('Dokumen A', 'Edit'));
    fireEvent.change(await screen.findByLabelText(/judul/i), { target: { value: 'Dokumen A Revisi' } });
    fireEvent.click(screen.getByRole('button', { name: /^simpan$/i }));
    if (ok) {
      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Dokumen berhasil disimpan.', 'success'));
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ aksi: 'metadata', judul: 'Dokumen A Revisi' });
      expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('urutan_tampil');
      await waitFor(() => expect(h.selects).toHaveBeenCalledTimes(2));
      expect(screen.queryByLabelText(/judul/i)).toBeNull();
    } else {
      await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Anda tidak berwenang.', 'error'));
      expect(screen.getByLabelText(/judul/i)).toHaveValue('Dokumen A Revisi');
    }
  });
});
