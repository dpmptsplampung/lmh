// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import KartuStatistik, { nadaTren } from './KartuStatistik';

afterEach(cleanup);

describe('KartuStatistik', () => {
  it('menampilkan label, nilai berformat id-ID, dan pembanding', () => {
    render(<KartuStatistik label="Kunjungan hari ini" nilai={14653} ikon={Users} pembanding="vs 12.000 minggu lalu" />);
    expect(screen.getByText('Kunjungan hari ini')).toBeInTheDocument();
    expect(screen.getByText('14.653')).toBeInTheDocument();
    expect(screen.getByText('vs 12.000 minggu lalu')).toBeInTheDocument();
  });

  it('arah tren diucapkan dalam teks, bukan hanya warna', () => {
    render(<KartuStatistik label="Kunjungan" nilai={10} tren={{ persen: 15.5, arah: 'naik' }} />);
    expect(screen.getByText('naik 15,5 persen')).toHaveClass('sr-only');
  });

  it('tren datar diucapkan "tidak berubah"', () => {
    render(<KartuStatistik label="Chat" nilai={3} tren={{ persen: 0, arah: 'datar' }} />);
    expect(screen.getByText('tidak berubah')).toBeInTheDocument();
  });

  it('nada mengikuti arahBaik: waktu tunggu turun = baik, naik = buruk', () => {
    expect(nadaTren({ persen: 10, arah: 'turun', arahBaik: 'turun' })).toBe('sukses');
    expect(nadaTren({ persen: 10, arah: 'naik', arahBaik: 'turun' })).toBe('bahaya');
    expect(nadaTren({ persen: 10, arah: 'naik' })).toBe('sukses');
    expect(nadaTren({ persen: 0, arah: 'datar' })).toBe('netral');
  });

  it('memuat: aria-busy dan nilai diganti kerangka', () => {
    const { container } = render(<KartuStatistik label="Antrean" nilai={5} memuat />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('5')).toBeNull();
    expect(screen.getByText('Memuat Antrean')).toBeInTheDocument();
  });

  it('dengan href seluruh kartu menjadi tautan', () => {
    render(<KartuStatistik label="Antrean" nilai={5} href="/admin/antrian" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/admin/antrian');
  });
});
