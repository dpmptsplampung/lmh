// @vitest-environment jsdom
// Lacak pengaduan publik: dua jenis nomor jelas (A-25), galat/hasil diumumkan ke pembaca layar (A-26/C2-03), zona WIB.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LacakPengaduanPage from './page';

const balas = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Lacak pengaduan: dua jenis nomor (A-25)', () => {
  it('tidak memakai istilah internal "Pesan Perilaku" dan menawarkan dua pilihan jelas', () => {
    const { container } = render(<LacakPengaduanPage />);
    expect(container.textContent).not.toMatch(/Pesan Perilaku/i);
    expect(screen.getByRole('radio', { name: /laporan baru/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /laporan lama/i })).not.toBeChecked();
  });

  it('pilihan laporan baru: kolom kontak tidak tampil dan tidak dikirim', async () => {
    fetchMock.mockResolvedValue(balas(200, { nomor_tiket: 'PK7M2N9XQ', jalur: 'layanan', status: 'baru', dibuat_pada: '2026-11-01T17:30:00Z' }));
    render(<LacakPengaduanPage />);
    expect(screen.queryByLabelText(/^kontak/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^nomor/i), { target: { value: 'PK7M2N9XQ' } });
    fireEvent.click(screen.getByRole('button', { name: /lacak status/i }));
    await screen.findByRole('heading', { name: 'Status Pengaduan' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pengaduan/lacak?tiket=PK7M2N9XQ&kontak=');
  });

  it('pilihan laporan lama: kontak muncul, wajib, dan ikut dikirim', async () => {
    fetchMock.mockResolvedValue(balas(200, { nomor_tiket: 'LAMA1', jalur: 'layanan', status: 'diproses', dibuat_pada: '2026-11-01T17:30:00Z' }));
    render(<LacakPengaduanPage />);
    fireEvent.click(screen.getByRole('radio', { name: /laporan lama/i }));
    const kontak = screen.getByLabelText(/^kontak/i);
    expect(kontak).toBeRequired();
    fireEvent.change(screen.getByLabelText(/^nomor/i), { target: { value: 'LAMA1' } });
    fireEvent.change(kontak, { target: { value: 'a@b.id' } });
    fireEvent.click(screen.getByRole('button', { name: /lacak status/i }));
    await screen.findByRole('heading', { name: 'Status Pengaduan' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pengaduan/lacak?tiket=LAMA1&kontak=a%40b.id');
  });

  it('berpindah ke laporan baru membuang kontak yang sudah terisi', async () => {
    fetchMock.mockResolvedValue(balas(200, { nomor_tiket: 'X', jalur: 'layanan', status: 'baru', dibuat_pada: '2026-11-01T17:30:00Z' }));
    render(<LacakPengaduanPage />);
    fireEvent.click(screen.getByRole('radio', { name: /laporan lama/i }));
    fireEvent.change(screen.getByLabelText(/^kontak/i), { target: { value: 'a@b.id' } });
    fireEvent.click(screen.getByRole('radio', { name: /laporan baru/i }));
    fireEvent.change(screen.getByLabelText(/^nomor/i), { target: { value: 'PK7M2N9XQ' } });
    fireEvent.click(screen.getByRole('button', { name: /lacak status/i }));
    await screen.findByRole('heading', { name: 'Status Pengaduan' });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pengaduan/lacak?tiket=PK7M2N9XQ&kontak=');
  });
});

describe('Lacak pengaduan: pengumuman dan zona waktu (A-26, C2-03)', () => {
  it('galat server diumumkan lewat role=alert', async () => {
    fetchMock.mockResolvedValue(balas(404, { error: 'Pengaduan tidak ditemukan.' }));
    render(<LacakPengaduanPage />);
    fireEvent.change(screen.getByLabelText(/^nomor/i), { target: { value: 'SALAH' } });
    fireEvent.click(screen.getByRole('button', { name: /lacak status/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pengaduan tidak ditemukan.');
  });

  it('gangguan jaringan diumumkan lewat role=alert', async () => {
    fetchMock.mockRejectedValue(new Error('putus'));
    render(<LacakPengaduanPage />);
    fireEvent.change(screen.getByLabelText(/^nomor/i), { target: { value: 'PK7M2N9XQ' } });
    fireEvent.click(screen.getByRole('button', { name: /lacak status/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/jaringan/i);
  });

  it('hasil berada di region role=status yang menerima fokus dan digulir ke layar', async () => {
    const gulir = vi.fn();
    Element.prototype.scrollIntoView = gulir;
    fetchMock.mockResolvedValue(balas(200, { nomor_tiket: 'PK7M2N9XQ', jalur: 'integritas', status: 'selesai', dibuat_pada: '2026-11-01T17:30:00Z' }));
    render(<LacakPengaduanPage />);
    fireEvent.change(screen.getByLabelText(/^nomor/i), { target: { value: 'PK7M2N9XQ' } });
    fireEvent.click(screen.getByRole('button', { name: /lacak status/i }));
    const hasil = await screen.findByRole('status');
    expect(hasil).toHaveTextContent('Selesai');
    await waitFor(() => expect(document.activeElement).toBe(hasil));
    expect(gulir).toHaveBeenCalled();
  });

  it('tanggal ditampilkan dalam WIB (17:30 UTC = 00:30 keesokan harinya)', async () => {
    fetchMock.mockResolvedValue(balas(200, {
      nomor_tiket: 'PK7M2N9XQ', jalur: 'layanan', status: 'baru', dibuat_pada: '2026-11-01T17:30:00Z',
      tanggapan: [{ id: 't1', isi: 'Sudah kami terima', created_at: '2026-11-01T17:30:00Z', lampiran: [] }],
    }));
    render(<LacakPengaduanPage />);
    fireEvent.change(screen.getByLabelText(/^nomor/i), { target: { value: 'PK7M2N9XQ' } });
    fireEvent.click(screen.getByRole('button', { name: /lacak status/i }));
    await screen.findByRole('status');
    // 2 November (WIB), bukan 1 November (UTC)
    expect(screen.getAllByText(/2 November 2026/).length).toBe(2);
    expect(screen.queryByText(/1 November 2026/)).toBeNull();
  });
});

describe('Lacak pengaduan: waktu dibuat (kiriman anonim dibulatkan ke 00:00 WIB)', () => {
  const lacak = async (dibuat: string) => {
    fetchMock.mockResolvedValue(balas(200, {
      nomor_tiket: 'PK7M2N9XQ', jalur: 'layanan', status: 'baru', dibuat_pada: dibuat,
      tanggapan: [{ id: 't1', isi: 'Sudah kami terima.', created_at: '2026-11-02T05:30:00Z', lampiran: [] }],
    }));
    render(<LacakPengaduanPage />);
    fireEvent.change(screen.getByLabelText(/^nomor/i), { target: { value: 'PK7M2N9XQ' } });
    fireEvent.click(screen.getByRole('button', { name: /lacak status/i }));
    await screen.findByRole('heading', { name: 'Status Pengaduan' });
  };

  it('tepat 00:00 WIB: Dibuat hanya tanggal; tanggapan petugas tetap dengan jam', async () => {
    await lacak('2026-11-01T17:00:00Z');
    const dibuat = screen.getByText('Dibuat').nextElementSibling as HTMLElement;
    expect(dibuat.textContent).toBe('2 November 2026');
    expect(screen.getByText(/2 November 2026.*12[.:]30/)).toBeTruthy();
  });

  it('bukan tengah malam: Dibuat tetap dengan jam WIB', async () => {
    await lacak('2026-11-01T17:30:00Z');
    const dibuat = screen.getByText('Dibuat').nextElementSibling as HTMLElement;
    expect(dibuat.textContent).toMatch(/2 November 2026.*00[.:]30/);
  });
});

