// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import RingkasanDilayani from './RingkasanDilayani';

afterEach(cleanup);

describe('RingkasanDilayani', () => {
  it('menampilkan "saya / total (persen)" dengan label', () => {
    render(<RingkasanDilayani dilayani={{ saya: 45, total: 120, persen: 37.5 }} />);
    expect(screen.getByText('Dilayani saya / total')).toBeInTheDocument();
    expect(screen.getByText('45 / 120 (37,5%)')).toBeInTheDocument();
  });

  it('memuat: tampil keterangan memuat, bukan angka', () => {
    render(<RingkasanDilayani dilayani={null} memuat />);
    expect(screen.getByText(/memuat ringkasan/i)).toBeInTheDocument();
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it('galat: pesan jelas, tanpa angka nol palsu', () => {
    render(<RingkasanDilayani dilayani={null} galat="Gagal memuat rekap" />);
    expect(screen.getByRole('status')).toHaveTextContent(/ringkasan dilayani tidak dapat dimuat/i);
    expect(screen.queryByText(/0 \/ 0/)).not.toBeInTheDocument();
  });

  it('tidak ada data (migrasi belum diterapkan): tidak merender apa pun', () => {
    const { container } = render(<RingkasanDilayani dilayani={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('total nol: tetap menulis 0 / 0 (0%) karena angka datang dari server', () => {
    render(<RingkasanDilayani dilayani={{ saya: 0, total: 0, persen: 0 }} />);
    expect(screen.getByText('0 / 0 (0%)')).toBeInTheDocument();
  });
});
