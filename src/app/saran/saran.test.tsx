import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SaranPage from './page';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const kirim = () => fireEvent.click(screen.getByRole('button', { name: /Kirim Saran/ }));
const ketik = (label: RegExp, nilai: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: nilai } });

describe('/saran (publik)', () => {
  it('tanpa login: form langsung tampil dan nama boleh kosong', () => {
    render(<SaranPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Kotak Saran' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Saran Anda/)).toBeRequired();
    expect(screen.getByLabelText(/Nama/)).not.toBeRequired();
  });

  it('saran terlalu pendek ditolak di klien tanpa memanggil API', () => {
    render(<SaranPage />);
    ketik(/Saran Anda/, 'oke');
    kirim();
    expect(screen.getByRole('alert')).toHaveTextContent('minimal 5 karakter');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mengirim isi dan nama ke /api/saran lalu menampilkan ucapan terima kasih', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    render(<SaranPage />);
    ketik(/Saran Anda/, '  Tolong tambah kursi di ruang tunggu  ');
    ketik(/Nama/, 'Budi');
    kirim();

    expect(await screen.findByText(/saran Anda sudah kami terima/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/saran');
    expect(JSON.parse(init.body)).toEqual({ isi: 'Tolong tambah kursi di ruang tunggu', nama: 'Budi' });
  });

  it('tanpa nama: kolom nama tidak dikirim', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }));
    render(<SaranPage />);
    ketik(/Saran Anda/, 'Tolong tambah kursi di ruang tunggu');
    kirim();
    await screen.findByText(/saran Anda sudah kami terima/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ isi: 'Tolong tambah kursi di ruang tunggu' });
  });

  it('galat server ditampilkan dan form tetap berisi (tidak hilang)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Terlalu banyak kiriman. Coba lagi beberapa menit lagi.' }), { status: 429 }));
    render(<SaranPage />);
    ketik(/Saran Anda/, 'Tolong tambah kursi di ruang tunggu');
    kirim();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Terlalu banyak kiriman'));
    expect(screen.getByLabelText(/Saran Anda/)).toHaveValue('Tolong tambah kursi di ruang tunggu');
  });

  it('jebakan bot tersembunyi dari pembaca layar dan tidak bisa difokus', () => {
    const { container } = render(<SaranPage />);
    const kolom = container.querySelector('#website-saran') as HTMLInputElement;
    expect(kolom.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(kolom.tabIndex).toBe(-1);
  });
});
