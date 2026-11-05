// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import TeksBerjalan, { JEDA_PENGUMUMAN_MS } from './TeksBerjalan';

// Per langkah 500 ms dalam act terpisah: pergantian fase butuh render di antara dua timer.
const maju = async (ms: number) => {
  for (let t = 0; t < ms; t += 500) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(500, ms - t)); });
};

describe('TeksBerjalan: pengumuman bergantian satu per satu dengan jeda 5 detik', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('jeda antar pengumuman = 5 detik', () => {
    expect(JEDA_PENGUMUMAN_MS).toBe(5000);
  });

  it('kosong: tidak merender apa pun', () => {
    const { container } = render(<TeksBerjalan pengumuman={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('menampilkan pengumuman pertama, kosong saat jeda, lalu yang kedua, lalu kembali ke pertama', async () => {
    render(<TeksBerjalan pengumuman={['Satu', 'Dua', 'Tiga']} />);
    expect(screen.getByText('Satu')).toBeInTheDocument();
    expect(screen.queryByText('Dua')).not.toBeInTheDocument();

    // Tanpa tata letak (jsdom), durasi cadangan: max(5000, panjang*90).
    await maju(5_000);
    expect(screen.queryByText('Satu')).not.toBeInTheDocument(); // jeda: bilah kosong
    expect(screen.queryByText('Dua')).not.toBeInTheDocument();
    await maju(4_999);
    expect(screen.queryByText('Dua')).not.toBeInTheDocument(); // jeda belum 5 dtk
    await maju(1);
    expect(screen.getByText('Dua')).toBeInTheDocument();

    await maju(5_000 + 5_000);
    expect(screen.getByText('Tiga')).toBeInTheDocument();
    await maju(5_000 + 5_000);
    expect(screen.getByText('Satu')).toBeInTheDocument();
  });

  it('satu pengumuman: berulang sendiri setelah jeda', async () => {
    render(<TeksBerjalan pengumuman={['Sendiri']} />);
    expect(screen.getByText('Sendiri')).toBeInTheDocument();
    await maju(5_000);
    expect(screen.queryByText('Sendiri')).not.toBeInTheDocument();
    await maju(5_000);
    expect(screen.getByText('Sendiri')).toBeInTheDocument();
  });

  it('daftar menyusut: indeks tidak melewati batas', async () => {
    const { rerender } = render(<TeksBerjalan pengumuman={['A', 'B', 'C']} />);
    await maju(10_000); // A selesai + jeda -> B
    await maju(10_000); // B selesai + jeda -> C
    expect(screen.getByText('C')).toBeInTheDocument();
    rerender(<TeksBerjalan pengumuman={['A']} />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});
