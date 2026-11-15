// @vitest-environment jsdom
// FormReservasi (tugas 9.2): tampilan murni menurut props; aksi hanya lewat callback.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ISIAN_RESERVASI_KOSONG } from '../_logika/validasiReservasi';
import FormReservasi, { type FormReservasiProps } from './FormReservasi';

afterEach(cleanup);

const props = (o: Partial<FormReservasiProps> = {}): FormReservasiProps => ({
  form: ISIAN_RESERVASI_KOSONG,
  onUbah: vi.fn(),
  onPilihTujuan: vi.fn(),
  layanan: { daftar: [{ id: 'l-1', nama: 'Helpdesk OSS' }], galat: false, memuat: false, onMuat: vi.fn() },
  estimasi: null,
  minDate: '2026-11-13',
  maxDate: '2026-11-20',
  error: '',
  consentGagal: false,
  consentGiven: false,
  onConsent: vi.fn(),
  loading: false,
  onKirim: vi.fn((e?: { preventDefault: () => void }) => e?.preventDefault()),
  ...o,
});

describe('FormReservasi', () => {
  it('tujuan kosong: hanya pilihan tujuan, tanggal, jam, keperluan; tombol kirim nonaktif tanpa persetujuan', () => {
    render(<FormReservasi {...props()} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByLabelText(/^Layanan Tujuan/)).toBeNull();
    expect(screen.queryByLabelText(/^Nama yang Ingin Ditemui/)).toBeNull();
    expect(screen.getByText(/mengikuti tujuan kunjungan/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buat Reservasi' })).toBeDisabled();
  });

  it('memilih tujuan memanggil onPilihTujuan', () => {
    const p = props();
    render(<FormReservasi {...p} />);
    fireEvent.click(screen.getByLabelText(/Bertemu Seseorang/));
    expect(p.onPilihTujuan).toHaveBeenCalledWith('bertemu_seseorang');
  });

  it('loket: pilihan layanan memanggil onUbah; estimasi hanya untuk hari ini', () => {
    const p = props({
      form: { ...ISIAN_RESERVASI_KOSONG, tujuan: 'loket', layanan_id: 'l-1' },
      estimasi: { antre_count: 4, estimasi_tunggu_total_menit: 20 },
    });
    const { rerender } = render(<FormReservasi {...p} />);
    expect(screen.getByText(/Antrean hari ini: ~20 menit/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Layanan Tujuan/), { target: { value: '' } });
    expect(p.onUbah).toHaveBeenCalledWith({ layanan_id: '' });
    rerender(<FormReservasi {...p} form={{ ...p.form, tanggal_rencana: '2026-11-14' }} />);
    expect(screen.queryByText(/Antrean hari ini/)).toBeNull();
  });

  it('loket: galat memuat = ErrorRetry dengan Coba lagi; kosong = pesan biasa dan tombol kirim nonaktif', () => {
    const p = props({
      form: { ...ISIAN_RESERVASI_KOSONG, tujuan: 'loket' },
      layanan: { daftar: [], galat: true, memuat: false, onMuat: vi.fn() },
      consentGiven: true,
    });
    const { rerender } = render(<FormReservasi {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(p.layanan.onMuat).toHaveBeenCalled();
    rerender(<FormReservasi {...p} layanan={{ ...p.layanan, galat: false }} />);
    expect(screen.getByText(/Belum ada layanan yang dapat direservasi/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buat Reservasi' })).toBeDisabled();
  });

  it('galat tampil sebagai alert; consentGagal menggantikannya dengan Coba lagi yang memanggil onKirim tanpa event', () => {
    const p = props({ error: 'Pilih tujuan kunjungan' });
    const { rerender } = render(<FormReservasi {...p} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Pilih tujuan kunjungan');
    rerender(<FormReservasi {...p} consentGagal />);
    expect(screen.queryByText('Pilih tujuan kunjungan')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(p.onKirim).toHaveBeenCalledWith();
  });

  it('persetujuan memanggil onConsent; kirim formulir memanggil onKirim; loading menampilkan "Memproses..."', () => {
    const p = props({ form: { ...ISIAN_RESERVASI_KOSONG, tujuan: 'bertemu_seseorang', nama_yang_ditemui: 'A' }, consentGiven: true });
    const { container, rerender } = render(<FormReservasi {...p} />);
    fireEvent.click(screen.getByLabelText(/saya setuju data saya diproses/i));
    expect(p.onConsent).toHaveBeenCalledWith(false);
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    expect(p.onKirim).toHaveBeenCalledTimes(1);
    rerender(<FormReservasi {...p} loading />);
    expect(screen.getByRole('button', { name: /Memproses/ })).toBeInTheDocument();
  });
});
