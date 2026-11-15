// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  dokumen: [
    {
      id: 'd1', judul: 'Proyek Kopi Robusta', kategori: 'IPRO', urutan_tampil: 1, file_path: 'x.pdf', jumlah_halaman: 3,
      status: 'aktif', deskripsi: 'Kebun kopi.', nilai_investasi: 'Rp 5 M', image_url: null, halaman_gambar: ['a', 'b', 'c'],
    },
  ],
  user: { id: 'u1' } as { id: string } | null,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: h.dokumen, error: null }) }) }) }),
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock('@/lib/site-settings', () => ({ getSiteSettings: async () => ({}) }));
vi.mock('next/image', () => ({ default: () => null }));

import GalleryPage from './page';

const fetchMock = vi.fn();
beforeEach(() => {
  h.user = { id: 'u1' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function bukaPenampil() {
  render(<GalleryPage />);
  const pemicu = await screen.findByRole('button', { name: /Lihat Dokumen/ });
  pemicu.focus();
  fireEvent.click(pemicu);
  return { pemicu, dialog: await screen.findByRole('dialog') };
}

async function bukaFormulir() {
  render(<GalleryPage />);
  const pemicu = await screen.findByRole('button', { name: /Ajukan Minat Investasi/ });
  pemicu.focus();
  fireEvent.click(pemicu);
  return { pemicu, dialog: await screen.findByRole('dialog') };
}

describe('Galeri: penampil dokumen (Dialog)', () => {
  it('role dialog + aria-modal, nama dari judul dokumen, halaman dimuat', async () => {
    const { dialog } = await bukaPenampil();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Proyek Kopi Robusta');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Proyek Kopi Robusta' })).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(/View-only/);
    expect(within(dialog).getByAltText('Halaman 1 dari 3')).toBeInTheDocument();
  });

  it('Escape menutup dan fokus kembali ke tombol pemicu', async () => {
    const { pemicu } = await bukaPenampil();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pemicu).toHaveFocus();
  });

  it('tombol Tutup menutup dialog', async () => {
    const { dialog } = await bukaPenampil();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Tab berputar di dalam dialog (jebak fokus)', async () => {
    const { dialog } = await bukaPenampil();
    const tutup = within(dialog).getByRole('button', { name: 'Tutup dialog' });
    const berikutnya = within(dialog).getByRole('button', { name: /Berikutnya/ });
    berikutnya.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(tutup).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(berikutnya).toHaveFocus();
  });

  it('pindah halaman memperbarui keterangan halaman', async () => {
    const { dialog } = await bukaPenampil();
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    expect(within(dialog).getByText('Halaman 2 dari 3')).toBeInTheDocument();
  });
});

describe('Galeri: formulir minat investasi (Dialog)', () => {
  it('role dialog + aria-modal, nama dari judul, isian tampil untuk pengguna masuk', async () => {
    const { dialog } = await bukaFormulir();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Ajukan Minat Investasi');
    expect(await within(dialog).findByLabelText(/^Nama/)).toBeInTheDocument();
    expect(within(dialog).getByText('Proyek Kopi Robusta')).toBeInTheDocument();
  });

  it('Escape menutup dan fokus kembali ke tombol pemicu', async () => {
    const { pemicu } = await bukaFormulir();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pemicu).toHaveFocus();
  });

  it('Tab berputar di dalam dialog (jebak fokus)', async () => {
    const { dialog } = await bukaFormulir();
    await within(dialog).findByLabelText(/^Nama/);
    const tutup = within(dialog).getByRole('button', { name: 'Tutup dialog' });
    const kirim = within(dialog).getByRole('button', { name: /Kirim Permintaan/ });
    kirim.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(tutup).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(kirim).toHaveFocus();
  });

  it('pengguna belum masuk diminta masuk', async () => {
    h.user = null;
    const { dialog } = await bukaFormulir();
    expect(await within(dialog).findByRole('link', { name: 'Masuk' })).toHaveAttribute('href', '/login?next=/gallery');
  });

  it('kirim berhasil menampilkan konfirmasi; Tutup menutup dan pembukaan berikutnya mulai dari formulir kosong', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { dialog } = await bukaFormulir();
    fireEvent.change(await within(dialog).findByLabelText(/^Nama/), { target: { value: 'Budi' } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'budi@contoh.id' } });
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    expect(await within(dialog).findByText(/Permintaan Anda tercatat/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const badan = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(badan).toMatchObject({ doc_id: 'd1', nama: 'Budi', email: 'budi@contoh.id' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Tutup' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Ajukan Minat Investasi/ }));
    const lagi = await screen.findByRole('dialog');
    expect(await within(lagi).findByLabelText(/^Nama/)).toHaveValue('');
  });

  it('galat server tampil di role=alert dan dialog tetap terbuka', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Email tidak valid' }) });
    const { dialog } = await bukaFormulir();
    fireEvent.change(await within(dialog).findByLabelText(/^Nama/), { target: { value: 'Budi' } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'budi@contoh.id' } });
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Email tidak valid'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Galeri: tanpa penanganan fokus/Escape buatan sendiri', () => {
  const PAGE = readFileSync(join(process.cwd(), 'src/app/gallery/page.tsx'), 'utf8');

  it('page.tsx memakai Dialog bersama, bukan role=dialog atau handler Escape lokal', () => {
    expect(PAGE).toMatch(/from '@\/components\/ui\/Dialog'/);
    expect(PAGE).not.toMatch(/role="dialog"/);
    expect(PAGE).not.toMatch(/'Escape'/);
    expect(PAGE).not.toMatch(/keydown/i);
  });
});
