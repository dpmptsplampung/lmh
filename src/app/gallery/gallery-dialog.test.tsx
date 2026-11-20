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
  signInAnon: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: h.dokumen, error: null }) }) }) }),
    auth: {
      getUser: async () => ({ data: { user: h.user } }),
      getSession: async () => ({ data: { session: h.user ? { user: h.user } : null }, error: null }),
      signInAnonymously: h.signInAnon,
    },
  }),
}));
vi.mock('@/lib/site-settings', () => ({ getSiteSettings: async () => ({}) }));
vi.mock('next/image', () => ({ default: () => null }));

import GalleryPage from './page';

const fetchMock = vi.fn();
const sukses = () => ({ ok: true, status: 201, json: async () => ({ data: { id: '30000000-0000-4000-8000-000000000001' } }) });
const kirim = (dialog: HTMLElement) => fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
const isiDasar = async (dialog: HTMLElement, nama: string, email: string) => {
  fireEvent.change(await within(dialog).findByLabelText(/^Nama/), { target: { value: nama } });
  fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: email } });
  fireEvent.click(within(dialog).getByRole('checkbox'));
};
beforeEach(() => {
  h.user = { id: 'u1' };
  h.signInAnon.mockReset();
  h.signInAnon.mockResolvedValue({ data: { session: { user: { id: 'anon' } } }, error: null });
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
    expect(dialog).toHaveAccessibleDescription(/Hanya lihat/);
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

  it('pengunjung tanpa sesi tetap bisa mengirim: sesi anonim dibuat otomatis, tanpa tautan masuk', async () => {
    h.user = null;
    fetchMock.mockResolvedValue(sukses());
    const { dialog } = await bukaFormulir();
    expect(within(dialog).queryByRole('link', { name: 'Masuk' })).toBeNull();
    await isiDasar(dialog, 'Sari', 'sari@contoh.id');
    kirim(dialog);
    expect(await within(dialog).findByText(/Permintaan Anda tercatat/)).toBeInTheDocument();
    expect(h.signInAnon).toHaveBeenCalledTimes(1);
  });

  it('kirim berhasil menampilkan konfirmasi; Tutup menutup dan pembukaan berikutnya mulai dari formulir kosong', async () => {
    fetchMock.mockResolvedValue(sukses());
    const { dialog } = await bukaFormulir();
    await isiDasar(dialog, 'Budi', 'budi@contoh.id');
    kirim(dialog);
    expect(await within(dialog).findByText(/Permintaan Anda tercatat/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/investasi/lead');
    const badan = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(badan).toMatchObject({ doc_id: 'd1', nama: 'Budi', email: 'budi@contoh.id', setuju_pdp: true, situs_web: '' });
    expect(badan.operasi_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(badan).not.toHaveProperty('minat');
    expect(badan).not.toHaveProperty('catatan');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Selesai' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Ajukan Minat Investasi/ }));
    const lagi = await screen.findByRole('dialog');
    expect(await within(lagi).findByLabelText(/^Nama/)).toHaveValue('');
  });

  it('galat server tampil di role=alert dan dialog tetap terbuka', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 'INPUT_TIDAK_VALID', message: 'x' }, request_id: 'r' }) });
    const { dialog } = await bukaFormulir();
    await isiDasar(dialog, 'Budi', 'budi@contoh.id');
    kirim(dialog);
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Periksa kembali isian Anda'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Galeri: formulir minat memakai kontrak baru (PDP, honeypot, operasi_id)', () => {
  it('tanpa centang persetujuan PDP tidak ada pengiriman dan galat terhubung ke kotak centang', async () => {
    const { dialog } = await bukaFormulir();
    fireEvent.change(await within(dialog).findByLabelText(/^Nama/), { target: { value: 'Budi' } });
    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'budi@contoh.id' } });
    kirim(dialog);
    expect(within(dialog).getByRole('checkbox')).toHaveAccessibleDescription(/Centang persetujuan/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honeypot situs_web tidak terjangkau papan ketik dan pembaca layar; tautan kebijakan privasi tersedia', async () => {
    const { dialog } = await bukaFormulir();
    const jebakan = (await within(dialog).findByLabelText(/^Nama/)) && dialog.querySelector('input[name="situs_web"]');
    expect(jebakan).toHaveAttribute('tabindex', '-1');
    expect(jebakan?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(dialog).getByRole('link', { name: 'Kebijakan Privasi' })).toHaveAttribute('href', '/kebijakan-privasi');
  });
});

describe('Galeri: judul, remah roti, dan tautan ke hub investasi', () => {
  it('h1 "Dokumen Investasi" dan remah roti ke /investasi', async () => {
    render(<GalleryPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Dokumen Investasi' })).toBeInTheDocument();
    const remah = screen.getByRole('navigation', { name: 'Remah roti' });
    expect(within(remah).getByRole('link', { name: 'Investasi' })).toHaveAttribute('href', '/investasi');
    expect(within(remah).getByText('Dokumen Investasi')).toHaveAttribute('aria-current', 'page');
  });
});

describe('Galeri: tanpa penanganan fokus/Escape buatan sendiri', () => {
  const baca = (berkas: string) => readFileSync(join(process.cwd(), berkas), 'utf8');
  const PAGE = baca('src/app/gallery/page.tsx');
  const PENAMPIL = baca('src/components/investasi/PenampilDokumen.tsx');
  const FORMULIR = baca('src/components/investasi/FormulirMinat.tsx');

  it('penampil dan formulir (dulu di page.tsx) memakai cangkang modal bersama, bukan role=dialog atau handler Escape lokal', () => {
    expect(PENAMPIL).toMatch(/from '@\/components\/ui\/Dialog'/);
    expect(FORMULIR).toMatch(/from '@\/components\/ui\/KerangkaModal'/);
    for (const sumber of [PAGE, PENAMPIL, FORMULIR]) {
      expect(sumber).not.toMatch(/role="dialog"/);
      expect(sumber).not.toMatch(/'Escape'/);
      expect(sumber).not.toMatch(/keydown/i);
    }
  });

  it('penampil dan formulir diekstrak ke components/investasi; halaman tidak mengirim atau membuat sesi sendiri', () => {
    expect(PAGE).toMatch(/from '@\/components\/investasi\/PenampilDokumen'/);
    expect(PAGE).toMatch(/from '@\/components\/investasi\/FormulirMinat'/);
    expect(PAGE).not.toMatch(/signInAnonymously/);
    expect(PAGE).not.toMatch(/\/api\/investasi\/lead/);
    expect(PAGE).not.toMatch(/page-image/);
  });
});
