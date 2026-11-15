// @vitest-environment jsdom
// FormPengaduan (klien): menerima daftar layanan lewat props, tanpa membaca DB sendiri; perilaku kirim sama dengan formulir lama.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ peramban: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    h.peramban();
    return {};
  },
}));

import FormPengaduan from './FormPengaduan';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  h.peramban.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const uraian = 'Antrean sangat lama dan informasi di loket tidak jelas sama sekali.';
const layanan = [
  { id: 'l1', nama: 'Bank Lampung' },
  { id: 'l2', nama: 'Konsultasi OSS' },
];

describe('FormPengaduan', () => {
  it('opsi layanan berasal dari props (tanpa memanggil klien Supabase peramban)', () => {
    render(<FormPengaduan layanan={layanan} />);
    const opsi = screen.getAllByRole('option').map((o) => [o.getAttribute('value'), o.textContent]);
    expect(opsi).toEqual([
      ['', 'Umum / tidak spesifik'],
      ['l1', 'Bank Lampung'],
      ['l2', 'Konsultasi OSS'],
    ]);
    expect(h.peramban).not.toHaveBeenCalled();
  });

  it('daftar layanan kosong: hanya opsi umum', () => {
    render(<FormPengaduan layanan={[]} />);
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('memilih layanan, uraian, dan kontak: badan kirim memuat layanan_id dan jalur layanan', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ nomor_tiket: 'PXYZ12345', lacak_dengan_nomor: false }), { status: 201 }));
    render(<FormPengaduan layanan={layanan} />);
    fireEvent.change(screen.getByLabelText(/Layanan terkait/), { target: { value: 'l2' } });
    fireEvent.change(screen.getByLabelText(/Uraian pengaduan/), { target: { value: uraian } });
    fireEvent.change(screen.getByLabelText(/Kontak/), { target: { value: ' nama@email.com ' } });
    fireEvent.click(screen.getByRole('button', { name: /Kirim Pengaduan/ }));

    await screen.findByText('PXYZ12345');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/pengaduan');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      jalur: 'layanan',
      isi: uraian,
      kontak: 'nama@email.com',
      layanan_id: 'l2',
      anonim: false,
    });
    expect(screen.getByText(/Lacak status dengan nomor ini dan kontak Anda/)).toBeInTheDocument();
  });

  it('jalur integritas menyembunyikan pilihan layanan', () => {
    render(<FormPengaduan layanan={layanan} />);
    expect(screen.getByLabelText(/Layanan terkait/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Pengaduan Perilaku/ }));
    expect(screen.queryByLabelText(/Layanan terkait/)).toBeNull();
  });

  it('uraian kurang dari 10 karakter ditolak di klien tanpa memanggil API', () => {
    render(<FormPengaduan layanan={layanan} />);
    fireEvent.change(screen.getByLabelText(/Uraian pengaduan/), { target: { value: 'pendek' } });
    fireEvent.click(screen.getByRole('button', { name: /Kirim Pengaduan/ }));
    expect(screen.getByText('Mohon jelaskan pengaduan Anda minimal 10 karakter.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('galat dari API ditampilkan dan formulir tetap bisa dikirim ulang', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Terlalu banyak permintaan.' }), { status: 429 }));
    render(<FormPengaduan layanan={layanan} />);
    fireEvent.change(screen.getByLabelText(/Uraian pengaduan/), { target: { value: uraian } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Laporkan dengan anonim/ }));
    fireEvent.click(screen.getByRole('button', { name: /Kirim Pengaduan/ }));
    expect(await screen.findByText(/Terlalu banyak permintaan/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kirim Pengaduan/ })).toBeEnabled();
  });

  it('gangguan jaringan menampilkan pesan umum', async () => {
    fetchMock.mockRejectedValue(new Error('putus'));
    render(<FormPengaduan layanan={layanan} />);
    fireEvent.change(screen.getByLabelText(/Uraian pengaduan/), { target: { value: uraian } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Laporkan dengan anonim/ }));
    fireEvent.click(screen.getByRole('button', { name: /Kirim Pengaduan/ }));
    expect(await screen.findByText(/Gangguan jaringan/)).toBeInTheDocument();
  });
});
