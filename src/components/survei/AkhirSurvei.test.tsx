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
    fireEvent.click(screen.getByLabelText('Jangan catat data diri saya'));
    fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('saran Anda sudah kami terima'));
    expect(fetchMock).toHaveBeenCalledWith('/api/survei/saran', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: TOKEN, isi: 'Tambah kursi', anonim: true });
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
