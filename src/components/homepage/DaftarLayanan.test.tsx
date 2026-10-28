// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DaftarLayanan from './DaftarLayanan';
import type { LayananEtalase, StatusHariIni } from '@/lib/homepage/data';

const layanan = (id: string, nama: string, o: Partial<LayananEtalase> = {}): LayananEtalase => ({
  id,
  nama,
  slug: nama.toLowerCase().replace(/\s+/g, '-'),
  deskripsi: `Deskripsi ${nama}`,
  urutan: 1,
  instansi: 'DPMPTSP',
  instansiSingkatan: null,
  websiteTerkait: [],
  statusTampilan: 'aktif',
  punyaAntrean: true,
  punyaChat: true,
  tampilDiHomepage: true,
  ...o,
});

const teks = { label: 'Layanan Kami', title: '{jumlah} Layanan dalam Satu Atap', description: 'Penjelasan layanan.' };
const semua = [
  layanan('1', 'Helpdesk OSS', { instansi: 'DPMPTSP' }),
  layanan('2', 'Bank Lampung', { instansi: 'Bank Daerah', deskripsi: 'Perbankan daerah' }),
  layanan('3', 'Balai Monitor', { statusTampilan: 'coming_soon' }),
];
const status = new Map<string, StatusHariIni>([
  ['1', { buka: true, liburKeterangan: null, jadwal: [] }],
  ['2', { buka: false, liburKeterangan: null, jadwal: [{ hari: 4, jamMulai: '08:00', jamSelesai: '15:30' }] }],
]);

afterEach(cleanup);

describe('DaftarLayanan', () => {
  it('judul dihitung dari jumlah kartu, bukan teks tetap', () => {
    render(<DaftarLayanan layanan={semua} status={status} teks={teks} onBuka={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: '3 Layanan dalam Satu Atap' })).toBeInTheDocument();
    cleanup();
    render(<DaftarLayanan layanan={semua.slice(0, 1)} status={status} teks={teks} onBuka={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: '1 Layanan dalam Satu Atap' })).toBeInTheDocument();
  });

  it('satu kartu per layanan, nama sebagai tombol yang membuka popup dengan slug', () => {
    const onBuka = vi.fn();
    render(<DaftarLayanan layanan={semua} status={status} teks={teks} onBuka={onBuka} />);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /Bank Lampung/ }));
    expect(onBuka).toHaveBeenCalledWith('bank-lampung');
  });

  it('kartu menampilkan instansi dan status; tutup menyebut hari buka', () => {
    render(<DaftarLayanan layanan={semua} status={status} teks={teks} onBuka={vi.fn()} />);
    expect(screen.getByText('Buka sekarang')).toBeInTheDocument();
    expect(screen.getByText('Tutup saat ini · Buka setiap Kamis')).toBeInTheDocument();
  });

  it('layanan segera hadir diberi label dan tanpa status buka/tutup', () => {
    render(<DaftarLayanan layanan={semua} status={status} teks={teks} onBuka={vi.fn()} />);
    expect(screen.getByText('Segera hadir')).toBeInTheDocument();
  });

  it('status null (RPC belum ada): kartu tanpa baris status', () => {
    render(<DaftarLayanan layanan={semua} status={null} teks={teks} onBuka={vi.fn()} />);
    expect(screen.queryByText(/Buka sekarang|Tutup saat ini/)).toBeNull();
  });

  it('pencarian berlabel menyaring nama, instansi, dan deskripsi', () => {
    render(<DaftarLayanan layanan={semua} status={status} teks={teks} onBuka={vi.fn()} />);
    const cari = screen.getByLabelText('Cari layanan');
    fireEvent.change(cari, { target: { value: 'perbankan' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Bank Lampung/ })).toBeInTheDocument();
    fireEvent.change(cari, { target: { value: 'dpmptsp' } });
    expect(screen.getByRole('button', { name: /Helpdesk OSS/ })).toBeInTheDocument();
  });

  it('tidak ada yang cocok: pesan kosong', () => {
    render(<DaftarLayanan layanan={semua} status={status} teks={teks} onBuka={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cari layanan'), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText(/Tidak ada layanan yang cocok/)).toBeInTheDocument();
  });

  it('daftar kosong: tidak ada kartu cadangan, hanya keterangan', () => {
    render(<DaftarLayanan layanan={[]} status={null} teks={teks} onBuka={vi.fn()} />);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(screen.getByText(/sedang disiapkan/i)).toBeInTheDocument();
    expect(screen.queryByText('Helpdesk OSS')).toBeNull();
  });

  it('section berjangkar #layanan', () => {
    const { container } = render(<DaftarLayanan layanan={semua} status={status} teks={teks} onBuka={vi.fn()} />);
    expect(container.querySelector('section#layanan')).not.toBeNull();
  });
});
