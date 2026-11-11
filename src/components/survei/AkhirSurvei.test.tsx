// Layar akhir Pesan Perilaku: saran dan pengaduan opsional, anonim bila dicentang, nomor laporan tampil.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import AkhirSurvei from './AkhirSurvei';

const TOKEN = 'a'.repeat(64);
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AkhirSurvei', () => {
  it('tanpa token hanya berterima kasih (tanpa tombol saran/pengaduan)', () => {
    render(<AkhirSurvei />);
    expect(screen.queryByRole('button', { name: /Sampaikan saran/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Selesai' })).toBeInTheDocument();
  });

  it('saran anonim: mengirim token, isi, dan anonim=true', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    render(<AkhirSurvei token={TOKEN} />);
    fireEvent.click(screen.getByRole('button', { name: /Sampaikan saran/ }));
    fireEvent.change(screen.getByLabelText('Saran untuk kami'), { target: { value: '  Tambah kursi  ' } });
    fireEvent.click(screen.getByLabelText(/Kirim dengan anonim\. DPMPTSP tidak akan tahu siapa Anda yang mengirim\./));
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('saran Anda sudah kami terima'));
    expect(fetchMock).toHaveBeenCalledWith('/api/survei/saran', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: TOKEN, isi: 'Tambah kursi', anonim: true });
  });

  it('menampilkan ajakan saran dan pengaduan sebagai dua kartu dengan tombol yang jelas', () => {
    render(<AkhirSurvei token={TOKEN} />);
    expect(screen.getByRole('heading', { name: 'Ada yang ingin Anda sampaikan?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Punya saran?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mengalami hal yang kurang baik?' })).toBeInTheDocument();
    // Kelas varian Tombol (CSS Module) dikenali dari namanya: `utama` = tombol utama.
    expect(screen.getByRole('button', { name: 'Sampaikan saran' }).className).toMatch(/utama/);
    expect(screen.getByRole('button', { name: 'Laporkan pengaduan' }).className).toMatch(/utama/);
    // "Selesai" tidak boleh bersaing dengan dua ajakan di atasnya.
    expect(screen.getByRole('button', { name: 'Selesai' }).className).not.toMatch(/utama/);
  });

  it('pengaduan memakai kalimat anonim dari pemilik dan tidak menyebut "Jangan catat data diri"', () => {
    render(<AkhirSurvei token={TOKEN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Laporkan pengaduan' }));
    expect(screen.getByLabelText('Laporkan dengan anonim. DPMPTSP tidak akan tahu siapa Anda yang melaporkan.')).not.toBeChecked();
    expect(screen.queryByText(/Jangan catat data diri/)).toBeNull();
    expect(screen.getByText(/Nama dan kunjungan Anda ikut tercatat/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Laporkan dengan anonim/));
    expect(screen.getByText(/hanya dapat memantau laporan dengan nomor yang muncul sesudah mengirim/)).toBeInTheDocument();
  });

  it('pengaduan anonim terkirim: nomor tampil dengan peringatan tidak bisa dipulihkan', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, nomor: 'PABCDEFGH' }) });
    render(<AkhirSurvei token={TOKEN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Laporkan pengaduan' }));
    fireEvent.change(screen.getByLabelText('Laporkan pengaduan'), { target: { value: 'Ada pungli' } });
    fireEvent.click(screen.getByLabelText(/Laporkan dengan anonim/));
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(screen.getByText('PABCDEFGH')).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).anonim).toBe(true);
    expect(screen.getByText(/Nomor ini tidak dapat dipulihkan bila hilang/)).toBeInTheDocument();
  });

  it('teks layar akhir bebas em dash', () => {
    const { container } = render(<AkhirSurvei token={TOKEN} />);
    fireEvent.click(screen.getByRole('button', { name: 'Laporkan pengaduan' }));
    expect(container.textContent).not.toContain('\u2014');
  });

  it('pengaduan: menampilkan nomor laporan dan tautan pantau; Kirim nonaktif saat kosong', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, nomor: 'PABCDEFGH' }) });
    render(<AkhirSurvei token={TOKEN} />);
    fireEvent.click(screen.getByRole('button', { name: /Laporkan pengaduan/ }));
    expect(screen.getByRole('button', { name: 'Kirim' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Laporkan pengaduan'), { target: { value: 'Ada pungli' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(screen.getByText('PABCDEFGH')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /Pantau status laporan/ })).toHaveAttribute('href', '/pengaduan/lacak');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).anonim).toBe(false);
  });

  it('galat server ditampilkan dan form tetap terbuka', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Batas waktu pengiriman sudah lewat' }) });
    render(<AkhirSurvei token={TOKEN} />);
    fireEvent.click(screen.getByRole('button', { name: /Sampaikan saran/ }));
    fireEvent.change(screen.getByLabelText('Saran untuk kami'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Batas waktu'));
    expect(screen.getByLabelText('Saran untuk kami')).toBeInTheDocument();
  });
});
