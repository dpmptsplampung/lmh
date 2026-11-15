// @vitest-environment jsdom
// DaftarReservasi + KartuReservasi (tugas 9.2): tampilan menurut props, aksi lewat callback.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReservasiKunjungan } from '@/lib/reservasi';

vi.mock('@/components/QRCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));

import DaftarReservasi from './DaftarReservasi';

afterEach(cleanup);

const baris = (o: Partial<ReservasiKunjungan> = {}): ReservasiKunjungan => ({
  id: 'k-9', tanggal: '2099-03-02', status: 'terjadwal', qr_token: 'b'.repeat(32), tujuan: 'loket',
  layanan_saran_id: 'l-1', jam_rencana: '10:15:00', nama_yang_ditemui: null, ...o,
});

const props = (o: Partial<React.ComponentProps<typeof DaftarReservasi>> = {}) => ({
  daftar: [baris()],
  gagal: false,
  layanan: [{ id: 'l-1', nama: 'Helpdesk OSS' }],
  infoBatal: '',
  galatBatal: '',
  konfirmasiBatal: null,
  membatalkan: null,
  onMuatUlang: vi.fn(),
  onMintaBatal: vi.fn(),
  onBatalkan: vi.fn(),
  onTutupKonfirmasi: vi.fn(),
  ...o,
});

describe('DaftarReservasi', () => {
  it('kosong: pesan kosong; gagal: ErrorRetry yang memanggil onMuatUlang', () => {
    const p = props({ daftar: [] });
    const { rerender } = render(<DaftarReservasi {...p} />);
    expect(screen.getByText('Belum ada reservasi.')).toBeInTheDocument();
    rerender(<DaftarReservasi {...p} gagal />);
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(p.onMuatUlang).toHaveBeenCalled();
    expect(screen.queryByText('Belum ada reservasi.')).toBeNull();
  });

  it('terjadwal: QR, nama layanan, lencana, jam; reservasi selesai tanpa QR dan tanpa tombol batal', () => {
    render(<DaftarReservasi {...props({ daftar: [baris(), baris({ id: 'k-8', status: 'selesai' })] })} />);
    expect(screen.getAllByText('Helpdesk OSS')).toHaveLength(2);
    expect(screen.getAllByTestId('qr')).toHaveLength(1);
    expect(screen.getByText('Terjadwal')).toBeInTheDocument();
    expect(screen.getByText('Selesai')).toBeInTheDocument();
    expect(screen.getAllByText('10:15 WIB')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /batalkan reservasi/i })).toHaveLength(1);
  });

  it('judul baris: bertemu memakai nama ("-" bila kosong); layanan tak dikenal = Loket Layanan', () => {
    render(
      <DaftarReservasi
        {...props({
          daftar: [
            baris({ id: 'a', tujuan: 'bertemu_seseorang', nama_yang_ditemui: 'Kepala Bidang', layanan_saran_id: null }),
            baris({ id: 'b', tujuan: 'bertemu_seseorang', nama_yang_ditemui: null, layanan_saran_id: null }),
            baris({ id: 'c', layanan_saran_id: 'l-x' }),
          ],
        })}
      />,
    );
    expect(screen.getByText('Bertemu: Kepala Bidang')).toBeInTheDocument();
    expect(screen.getByText('Bertemu: -')).toBeInTheDocument();
    expect(screen.getByText('Loket Layanan')).toBeInTheDocument();
  });

  it('Batalkan reservasi memanggil onMintaBatal; konfirmasi menampilkan Ya/Tidak dan memanggil callback masing-masing', () => {
    const p = props();
    const { rerender } = render(<DaftarReservasi {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /batalkan reservasi/i }));
    expect(p.onMintaBatal).toHaveBeenCalledWith('k-9');
    rerender(<DaftarReservasi {...p} konfirmasiBatal="k-9" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ya, batalkan' }));
    expect(p.onBatalkan).toHaveBeenCalledWith('k-9');
    fireEvent.click(screen.getByRole('button', { name: 'Tidak' }));
    expect(p.onTutupKonfirmasi).toHaveBeenCalled();
  });

  it('sedang membatalkan: Ya/Tidak nonaktif dan berlabel "Membatalkan…"; tombol batal reservasi lain nonaktif', () => {
    const p = props({ daftar: [baris(), baris({ id: 'k-10' })], konfirmasiBatal: 'k-9', membatalkan: 'k-9' });
    render(<DaftarReservasi {...p} />);
    expect(screen.getByRole('button', { name: 'Membatalkan…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tidak' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /batalkan reservasi/i })).toBeDisabled();
  });

  it('info dan galat pembatalan tampil di wilayah masing-masing', () => {
    render(<DaftarReservasi {...props({ infoBatal: 'Reservasi dibatalkan.', galatBatal: 'Gagal membatalkan.' })} />);
    expect(within(screen.getByRole('status')).getByText('Reservasi dibatalkan.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Gagal membatalkan.');
  });
});
