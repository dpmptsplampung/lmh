// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TabelRingkas from './TabelRingkas';

afterEach(cleanup);

const BARIS = Array.from({ length: 8 }, (_, i) => ({ id: String(i), layanan: `Layanan ${i + 1}`, antre: i }));
const KOLOM = [
  { kunci: 'layanan', judul: 'Layanan', judulBaris: true },
  { kunci: 'antre', judul: 'Antre', angka: true },
];

describe('TabelRingkas', () => {
  it('membatasi 5 baris dan menampilkan tautan Lihat semua', () => {
    render(<TabelRingkas judul="Layanan tersibuk" kolom={KOLOM} baris={BARIS} kunciBaris="id" lihatSemua={{ href: '/admin/rekap' }} />);
    expect(screen.getByRole('region', { name: 'Layanan tersibuk' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(6); // 1 kepala + 5 baris
    expect(screen.getByRole('link', { name: /Lihat semua/ })).toHaveAttribute('href', '/admin/rekap');
  });
  it('maks bisa diubah; tanpa tautan bila tidak diminta', () => {
    render(<TabelRingkas judul="T" kolom={KOLOM} baris={BARIS} kunciBaris="id" maks={2} />);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('link')).toBeNull();
  });
  it('kosong dan memuat', () => {
    const { rerender } = render(<TabelRingkas judul="T" kolom={KOLOM} baris={[]} kunciBaris="id" kosong={<p>Belum ada layanan</p>} />);
    expect(screen.getByText('Belum ada layanan')).toBeInTheDocument();
    rerender(<TabelRingkas judul="T" kolom={KOLOM} baris={[]} kunciBaris="id" memuat />);
    expect(screen.getByText('Memuat Rincian T')).toBeInTheDocument();
  });
});
