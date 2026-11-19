// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { KartuPublik } from '@/lib/data/publik-server';
import AngkaKunci from './AngkaKunci';
import KartuFoila from './KartuFoila';
import KartuIpro from './KartuIpro';

afterEach(cleanup);

const dasar: KartuPublik = {
  id: 'p1', sumber: 'ptsp', slug: 'wisata-pesisir', judul: 'Kawasan Wisata Pesisir', judul_en: null,
  ringkasan: 'Pengembangan kawasan wisata bahari terpadu.', ringkasan_en: null, sektor: 'pariwisata', kab_kota: 'Pesawaran',
  nilai_investasi: 1_200_000_000_000, mata_uang: 'IDR', nilai_teks: null, irr_persen: 14.5, tahap_kajian: 'fs',
  sumber_url: null, urutan: 0, diterbitkan_pada: '2026-11-01T00:00:00Z',
  gambar: { url: 'https://r2.example/ipro-gambar/a.webp', url_mini: 'https://r2.example/ipro-gambar/a-640.webp', alt: 'Pantai berpasir putih', lebar: 1600, tinggi: 1000 },
};

describe('KartuIpro', () => {
  it('menaut ke halaman detail lewat judul (h3), foto beralt dari data, nilai dalam mata uang proyek, IRR, sektor dan tahap', () => {
    render(<KartuIpro kartu={dasar} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Kawasan Wisata Pesisir' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kawasan Wisata Pesisir' })).toHaveAttribute('href', '/investasi/ipro/wisata-pesisir');
    expect(screen.getByRole('img', { name: 'Pantai berpasir putih' })).toHaveAttribute('src', expect.stringContaining('a-640.webp'));
    expect(screen.getByText('Rp 1,2 T')).toBeInTheDocument();
    expect(screen.getByText('14,5%')).toBeInTheDocument();
    expect(screen.getByText('Pariwisata')).toBeInTheDocument();
    expect(screen.getByText('Studi kelayakan')).toBeInTheDocument();
    expect(screen.getByText('Pesawaran')).toBeInTheDocument();
  });

  it('nilai USD tampil USD tanpa konversi; nilai dan IRR kosong tidak ditampilkan; tanpa foto memakai pengganti dekoratif', () => {
    render(<KartuIpro kartu={{ ...dasar, mata_uang: 'USD', nilai_investasi: 5_000_000, irr_persen: null, gambar: null }} />);
    expect(screen.getByText('USD 5 jt')).toBeInTheDocument();
    expect(screen.queryByText('IRR')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    cleanup();
    render(<KartuIpro kartu={{ ...dasar, nilai_investasi: null, irr_persen: null, tahap_kajian: null }} />);
    expect(screen.queryByText('Nilai')).toBeNull();
    expect(screen.queryByText('Studi kelayakan')).toBeNull();
  });
});

describe('KartuFoila', () => {
  const foila: KartuPublik = { ...dasar, id: 'f1', sumber: 'foila', slug: 'foila-1', nilai_investasi: null, nilai_teks: 'IDR 53.18 trillion',
    sumber_url: 'https://invest.lampungprov.go.id/proyek/pelabuhan' };

  it('satu tautan keluar ke FOILA: tab baru, noopener noreferrer, nama menyebut tab baru, lencana sumber, nilai_teks apa adanya', () => {
    render(<KartuFoila kartu={foila} />);
    const tautan = screen.getByRole('link', { name: /Kawasan Wisata Pesisir/ });
    expect(tautan).toHaveAttribute('href', 'https://invest.lampungprov.go.id/proyek/pelabuhan');
    expect(tautan).toHaveAttribute('target', '_blank');
    expect(tautan.getAttribute('rel')).toMatch(/noopener/);
    expect(tautan.getAttribute('rel')).toMatch(/noreferrer/);
    expect(tautan).toHaveAccessibleName(/membuka situs FOILA di tab baru/);
    expect(within(tautan).getByText('Sumber: FOILA')).toBeInTheDocument();
    expect(within(tautan).getByText('IDR 53.18 trillion')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(document.querySelector('a[href^="/investasi"]')).toBeNull();
  });

  it('tanpa sumber_url tidak merender apa pun (tidak pernah menjadi halaman detail)', () => {
    const { container } = render(<KartuFoila kartu={{ ...foila, sumber_url: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('AngkaKunci', () => {
  const lengkap = { nilai_investasi: 2_500_000_000, mata_uang: 'IDR' as const, irr_persen: 12, npv_nilai: -300_000_000, payback_bulan: 66, luas_ha: 120.5 };
  it('menampilkan angka yang ada saja, dengan label', () => {
    render(<AngkaKunci data={lengkap} />);
    expect(screen.getByText('Rp 2,5 M')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('5 tahun 6 bulan')).toBeInTheDocument();
    expect(screen.getByText('120,5 ha')).toBeInTheDocument();
    expect(screen.getByText('NPV')).toBeInTheDocument();
    cleanup();
    render(<AngkaKunci data={{ ...lengkap, npv_nilai: null, payback_bulan: null, luas_ha: null, irr_persen: null }} />);
    expect(screen.queryByText('NPV')).toBeNull();
    expect(screen.queryByText('IRR')).toBeNull();
    expect(screen.queryByText('Luas lahan')).toBeNull();
  });
  it('tanpa angka sama sekali tidak merender apa pun', () => {
    const { container } = render(<AngkaKunci data={{ nilai_investasi: null, mata_uang: 'IDR', irr_persen: null, npv_nilai: null, payback_bulan: null, luas_ha: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
