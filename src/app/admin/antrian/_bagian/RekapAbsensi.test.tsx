// @vitest-environment jsdom
// RekapAbsensi (lipatan rekap absen petugas).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import RekapAbsensi from './RekapAbsensi';
import type { BarisAbsensi } from '@/lib/data/antrean';

afterEach(cleanup);

const absen = (over: Partial<BarisAbsensi> = {}): BarisAbsensi => ({
  id: 'a-1',
  petugas_id: 'p-1',
  tanggal: '2026-11-11',
  jam_masuk: '2026-11-11T01:00:00Z',
  jam_pulang: null,
  status: 'approved',
  petugas: { nama: 'Dewi' },
  ...over,
});

function pasangRekap(over: Partial<React.ComponentProps<typeof RekapAbsensi>> = {}) {
  const props = {
    tanggal: '2026-11-11',
    terbuka: false,
    baris: [] as BarisAbsensi[],
    memuat: false,
    onAlihkan: vi.fn(),
    onUnduh: vi.fn(),
    ...over,
  };
  render(<RekapAbsensi {...props} />);
  return props;
}

describe('RekapAbsensi', () => {
  it('tertutup: hanya tombol lipatan (aria-expanded=false), isi tidak dirender', () => {
    const p = pasangRekap();
    const toggle = screen.getByRole('button', { name: /Rekapitulasi Absen — 11 November 2026/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Unduh CSV/ })).toBeNull();
    fireEvent.click(toggle);
    expect(p.onAlihkan).toHaveBeenCalledTimes(1);
  });

  it('lencana jumlah petugas hanya bila ada baris', () => {
    pasangRekap({ baris: [absen(), absen({ id: 'a-2' })] });
    expect(screen.getByText('2 petugas')).toBeInTheDocument();
  });

  it('terbuka tanpa baris: catatan kosong dan Unduh CSV nonaktif', () => {
    pasangRekap({ terbuka: true });
    expect(screen.getByText('Belum ada catatan absensi untuk tanggal ini.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unduh CSV/ })).toBeDisabled();
  });

  it('terbuka dan memuat: skeleton, bukan catatan kosong', () => {
    pasangRekap({ terbuka: true, memuat: true });
    expect(screen.getByText('Memuat rekapitulasi absen…')).toBeInTheDocument();
    expect(screen.queryByText('Belum ada catatan absensi untuk tanggal ini.')).toBeNull();
  });

  it('terbuka dengan baris: tabel berisi nama, jam, dan lencana status; Unduh CSV aktif', () => {
    const p = pasangRekap({
      terbuka: true,
      baris: [absen(), absen({ id: 'a-2', petugas: { nama: 'Eko' }, status: 'pending' }), absen({ id: 'a-3', status: 'alpa' })],
    });
    expect(screen.getByRole('table', { name: 'Rekapitulasi absen petugas' })).toBeInTheDocument();
    expect(screen.getByText('Eko')).toBeInTheDocument();
    expect(screen.getByText('Disetujui')).toBeInTheDocument();
    expect(screen.getByText('Menunggu')).toBeInTheDocument();
    expect(screen.getByText('Alpa')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Unduh CSV/ }));
    expect(p.onUnduh).toHaveBeenCalledTimes(1);
  });
});
