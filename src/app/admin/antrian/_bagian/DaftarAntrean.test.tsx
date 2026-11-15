// @vitest-environment jsdom
// DaftarAntrean: kartu daftar (tab saringan, galat muat, tabel + keadaan kosong, paginasi) dan kolom menurut peran.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

vi.mock('@/components/Pagination', () => ({
  default: ({ page, pageSize, total, onPageChange }: {
    page: number; pageSize: number; total: number; onPageChange: (p: number) => void;
  }) => (
    <button type="button" data-testid="paginasi" data-page={page} data-ukuran={pageSize} data-total={total} onClick={() => onPageChange(3)}>
      paginasi
    </button>
  ),
}));

import DaftarAntrean from './DaftarAntrean';
import type { AksiTiket } from './SelAksi';
import { ADMIN, PETUGAS, buatTiket } from '../_uji/tiketUji';

afterEach(cleanup);

const aksi: AksiTiket = {
  sedangProses: new Set(),
  sedangPanggil: new Set(),
  panggil: vi.fn(),
  mulai: vi.fn(),
  selesaikan: vi.fn(),
  buka: vi.fn(),
};

function pasang(over: Partial<React.ComponentProps<typeof DaftarAntrean>> = {}) {
  const props: React.ComponentProps<typeof DaftarAntrean> = {
    baris: [],
    pengguna: ADMIN,
    aksesFo: false,
    catatanEskalasi: {},
    statusSurvei: new Map(),
    aksi,
    tanggal: '2026-11-11',
    filterStatus: 'semua',
    onGantiStatus: vi.fn(),
    halaman: 0,
    ukuranHalaman: 25,
    total: 0,
    onGantiHalaman: vi.fn(),
    memuat: false,
    menyegarkan: false,
    galatMuat: null,
    onMuatUlang: vi.fn(),
    ...over,
  };
  const hasil = render(<DaftarAntrean {...props} />);
  return { props, ...hasil };
}

const judulKolom = () => screen.getAllByRole('columnheader').map((th) => th.textContent);

describe('DaftarAntrean: kolom', () => {
  const baris = [buatTiket({ fo_nama: 'Sari', kunjungan: { nama: 'Rina', asal: 'reservasi', waktu_masuk: '2026-11-11T01:00:00Z' } })];

  it('Admin: kolom Layanan ada; Front Office hanya bila akses FO', () => {
    pasang({ baris, total: 1 });
    expect(judulKolom()).toEqual(['No. Tiket', 'Layanan', 'Nama', 'Asal', 'Waktu Masuk', 'Status', 'Aksi / Durasi']);
    cleanup();
    pasang({ baris, total: 1, aksesFo: true });
    expect(judulKolom()).toEqual(['No. Tiket', 'Layanan', 'Nama', 'Asal', 'Front Office', 'Waktu Masuk', 'Status', 'Aksi / Durasi']);
  });

  it('Petugas: tanpa kolom Layanan', () => {
    pasang({ baris, total: 1, pengguna: PETUGAS });
    expect(judulKolom()).not.toContain('Layanan');
  });

  it('isi baris: nomor, layanan, nama, asal, FO, status, dan aksi', () => {
    pasang({ baris, total: 1, aksesFo: true });
    const tr = screen.getAllByRole('row')[1];
    const sel = within(tr);
    expect(sel.getByText('OS-001')).toBeInTheDocument();
    expect(sel.getByText('Helpdesk OSS')).toBeInTheDocument();
    expect(sel.getByText('Rina')).toBeInTheDocument();
    expect(sel.getByText('Reservasi')).toBeInTheDocument();
    expect(sel.getByText('Sari')).toBeInTheDocument();
    expect(sel.getByText('Menunggu')).toBeInTheDocument();
    expect(sel.getByRole('button', { name: 'Panggil' })).toBeInTheDocument();
  });

  it('catatan eskalasi dicari lewat penanganan_asal_id dan statusSurvei lewat kunjungan_id', () => {
    const t = buatTiket({ status: 'selesai', penanganan_asal_id: 'tahap-1', kunjungan_id: 'k-7', waktu_selesai: '2026-11-11T02:00:00Z' });
    pasang({
      baris: [t],
      total: 1,
      catatanEskalasi: { 'tahap-1': { topik: 'NIB', catatan: 'Lupa sandi', foNama: 'Sari' } },
      statusSurvei: new Map([['k-7', 'belum_diisi' as const]]),
    });
    expect(screen.getByText('Topik: NIB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tampilkan QR Pesan Perilaku tiket OS-001/ })).toBeInTheDocument();
  });
});

describe('DaftarAntrean: kartu', () => {
  it('caption memuat tanggal dan tab; tab saringan memanggil onGantiStatus', () => {
    const { props } = pasang({ filterStatus: 'aktif', baris: [buatTiket()], total: 1 });
    expect(screen.getByRole('table', { name: 'Daftar antrean 11 November 2026, tab Aktif' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Selesai' }));
    expect(props.onGantiStatus).toHaveBeenCalledWith('selesai');
  });

  it('kosong menurut tab: semua, aktif, selesai', () => {
    pasang({ filterStatus: 'semua' });
    expect(screen.getByText('Belum Ada Antrean')).toBeInTheDocument();
    cleanup();
    pasang({ filterStatus: 'aktif' });
    expect(screen.getByText('Tidak ada antrean aktif')).toBeInTheDocument();
    cleanup();
    pasang({ filterStatus: 'selesai' });
    expect(screen.getByText('Belum ada tiket selesai')).toBeInTheDocument();
  });

  it('galat muat: pesan + Coba lagi memanggil onMuatUlang, tanpa tabel dan paginasi', () => {
    const { props } = pasang({ galatMuat: 'Antrean tidak dapat dimuat.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Antrean tidak dapat dimuat.');
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(props.onMuatUlang).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('paginasi')).toBeNull();
  });

  it('paginasi: halaman, ukuran, total; tersembunyi saat memuat', () => {
    const { props, rerender } = pasang({ halaman: 2, total: 60 });
    const p = screen.getByTestId('paginasi');
    expect(p).toHaveAttribute('data-page', '2');
    expect(p).toHaveAttribute('data-ukuran', '25');
    expect(p).toHaveAttribute('data-total', '60');
    fireEvent.click(p);
    expect(props.onGantiHalaman).toHaveBeenCalledWith(3);
    rerender(<DaftarAntrean {...props} memuat />);
    expect(screen.queryByTestId('paginasi')).toBeNull();
  });

  it('menyegarkan senyap menandai pembungkus aria-busy tanpa menghapus tabel', () => {
    const { container } = pasang({ menyegarkan: true, baris: [buatTiket()], total: 1 });
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
