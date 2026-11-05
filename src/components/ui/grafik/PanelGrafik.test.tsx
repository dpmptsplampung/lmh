// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PanelGrafik from './PanelGrafik';

const unduh = vi.fn();
vi.mock('./unduhCsv', () => ({ unduhCsv: (...a: unknown[]) => unduh(...a), csvDariTabel: () => '' }));

afterEach(() => {
  cleanup();
  unduh.mockClear();
});

const TABEL = {
  kolom: [
    { kunci: 'hari', label: 'Hari' },
    { kunci: 'jumlah', label: 'Jumlah' },
  ],
  baris: [{ hari: 'Senin', jumlah: 10 }],
};

function Panel(props: Partial<React.ComponentProps<typeof PanelGrafik>> = {}) {
  return (
    <PanelGrafik
      judul="Kunjungan 30 hari"
      meta="target 15 menit"
      nilaiUtama="14.653"
      legenda={[
        { label: 'Periode ini', warna: 'var(--chart-1)' },
        { label: 'Periode lalu', warna: 'var(--chart-compare)', putus: true },
      ]}
      tabel={TABEL}
      laporanHref="/admin/rekap"
      {...props}
    >
      <div data-testid="grafik">grafik</div>
    </PanelGrafik>
  );
}

describe('PanelGrafik', () => {
  it('judul, meta, nilai utama, legenda, dan isi grafik tampil', () => {
    render(<Panel />);
    expect(screen.getByRole('region', { name: 'Kunjungan 30 hari' })).toBeInTheDocument();
    expect(screen.getByText('target 15 menit')).toBeInTheDocument();
    expect(screen.getByText('14.653')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Legenda Kunjungan 30 hari' })).toHaveTextContent('Periode lalu');
    expect(screen.getByTestId('grafik')).toBeInTheDocument();
  });

  it('menu: Lihat sebagai tabel menampilkan tabel cadangan lalu kembali ke grafik', () => {
    render(<Panel />);
    fireEvent.click(screen.getByRole('button', { name: 'Opsi grafik Kunjungan 30 hari' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Lihat sebagai tabel' }));
    expect(screen.queryByTestId('grafik')).toBeNull();
    expect(screen.getByRole('table', { name: 'Data Kunjungan 30 hari' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Opsi grafik Kunjungan 30 hari' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Lihat sebagai grafik' }));
    expect(screen.getByTestId('grafik')).toBeInTheDocument();
  });

  it('menu: Unduh CSV memanggil unduhCsv dengan tabel dan nama berkas', () => {
    render(<Panel namaBerkas="kunjungan-30-hari" />);
    fireEvent.click(screen.getByRole('button', { name: 'Opsi grafik Kunjungan 30 hari' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unduh CSV' }));
    expect(unduh).toHaveBeenCalledWith('kunjungan-30-hari', TABEL);
  });

  it('menu: Buka laporan berupa tautan', () => {
    render(<Panel />);
    fireEvent.click(screen.getByRole('button', { name: 'Opsi grafik Kunjungan 30 hari' }));
    expect(screen.getByRole('menuitem', { name: 'Buka laporan' })).toHaveAttribute('href', '/admin/rekap');
  });

  it('tanpa tabel dan tanpa laporan tidak ada menu', () => {
    render(<Panel tabel={undefined} laporanHref={undefined} />);
    expect(screen.queryByRole('button', { name: /Opsi grafik/ })).toBeNull();
  });

  it('memuat menampilkan kerangka; kosong menggantikan grafik', () => {
    const { rerender } = render(<Panel memuat />);
    expect(screen.queryByTestId('grafik')).toBeNull();
    expect(screen.getByText('Memuat Kunjungan 30 hari')).toBeInTheDocument();
    rerender(<Panel kosong={<p>Hari ini libur</p>} />);
    expect(screen.getByText('Hari ini libur')).toBeInTheDocument();
    expect(screen.queryByTestId('grafik')).toBeNull();
  });
});
