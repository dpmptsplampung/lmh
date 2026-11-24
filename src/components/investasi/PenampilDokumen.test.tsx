// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PenampilDokumen from './PenampilDokumen';

afterEach(cleanup);
const DOK = '50000000-0000-4000-8000-000000000001';

describe('PenampilDokumen', () => {
  it('dialog bernama judul dokumen, peringatan view-only, halaman pertama beralt, navigasi halaman, klik kanan dicegah', () => {
    render(<PenampilDokumen dokumenId={DOK} judul="Kajian Pelabuhan" jumlahHalaman={3} onTutup={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Kajian Pelabuhan');
    expect(dialog).toHaveAccessibleDescription(/Hanya lihat/);
    const gambar = within(dialog).getByAltText('Kajian Pelabuhan, halaman 1 dari 3');
    expect(gambar).toHaveAttribute('src', `/api/investment-docs/page-image?doc_id=${DOK}&page=1`);
    expect(within(dialog).getByRole('button', { name: /Sebelumnya/ })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    expect(within(dialog).getByText('Halaman 2 dari 3')).toHaveAttribute('role', 'status'); // pengumuman halaman; nav tampak = isian angka
    expect(within(dialog).getByRole('spinbutton', { name: 'Ke halaman' })).toHaveValue(2);
    expect(within(dialog).getByAltText('Kajian Pelabuhan, halaman 2 dari 3')).toHaveAttribute('src', expect.stringContaining('page=2'));
    // fireEvent mengembalikan false bila preventDefault dipanggil.
    expect(fireEvent.contextMenu(within(dialog).getByAltText('Kajian Pelabuhan, halaman 2 dari 3'))).toBe(false);
  });

  it('dokumen belum dirender: pesan diproses dan tautan email lembaga', () => {
    render(<PenampilDokumen dokumenId={DOK} judul="Kajian" jumlahHalaman={0} kontakEmail="info@contoh.go.id" onTutup={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Dokumen ini sedang diproses.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link')).toHaveAttribute('href', 'mailto:info@contoh.go.id');
    expect(within(dialog).queryByRole('img')).toBeNull();
  });

  it('halaman gagal dimuat menampilkan galat role=alert, halaman lain tetap bisa dibuka', () => {
    render(<PenampilDokumen dokumenId={DOK} judul="Kajian" jumlahHalaman={2} onTutup={() => {}} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.error(within(dialog).getByAltText('Kajian, halaman 1 dari 2'));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/belum dapat dimuat/);
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    expect(within(dialog).getByAltText('Kajian, halaman 2 dari 2')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('halaman gagal bisa dicoba ulang di dialog yang sama, juga untuk dokumen satu halaman', () => {
    render(<PenampilDokumen dokumenId={DOK} judul="Kajian" jumlahHalaman={1} onTutup={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /Berikutnya/ })).toBeDisabled();
    fireEvent.error(within(dialog).getByAltText('Kajian, halaman 1 dari 1'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Coba lagi' }));
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByAltText('Kajian, halaman 1 dari 1')).toBeInTheDocument();
  });

  it('status memuat tampil sampai gambar selesai; pindah halaman diumumkan lewat role=status', () => {
    render(<PenampilDokumen dokumenId={DOK} judul="Kajian" jumlahHalaman={2} onTutup={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Memuat halaman 1…')).toBeInTheDocument();
    fireEvent.load(within(dialog).getByAltText('Kajian, halaman 1 dari 2'));
    expect(within(dialog).queryByText('Memuat halaman 1…')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    expect(within(dialog).getByText('Memuat halaman 2…')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('status').some(el => el.textContent === 'Halaman 2 dari 2')).toBe(true);
  });

  it('tombol "Ajukan minat" hanya ada bila onMinat diberikan', () => {
    const onMinat = vi.fn();
    const { rerender } = render(<PenampilDokumen dokumenId={DOK} judul="Kajian" jumlahHalaman={2} onTutup={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Ajukan minat' })).toBeNull();
    rerender(<PenampilDokumen dokumenId={DOK} judul="Kajian" jumlahHalaman={2} onMinat={onMinat} onTutup={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan minat' }));
    expect(onMinat).toHaveBeenCalledTimes(1);
  });

  it('Peta Potensi: satuan slide di semua teks, isian "Ke slide" melompat dengan Enter dan dijepit ke rentang', () => {
    render(<PenampilDokumen dokumenId={DOK} judul="Peta" kategori="Peta Potensi" jumlahHalaman={164} onTutup={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByAltText('Peta, slide 1 dari 164')).toBeInTheDocument();
    const isian = within(dialog).getByRole('spinbutton', { name: 'Ke slide' });
    expect(isian).toHaveAttribute('min', '1');
    expect(isian).toHaveAttribute('max', '164');
    fireEvent.change(isian, { target: { value: '120' } });
    fireEvent.submit(isian.closest('form') as HTMLFormElement);
    expect(within(dialog).getByAltText('Peta, slide 120 dari 164')).toHaveAttribute('src', expect.stringContaining('page=120'));
    expect(isian).toHaveValue(120);
    fireEvent.change(isian, { target: { value: '999' } });
    fireEvent.submit(isian.closest('form') as HTMLFormElement);
    expect(within(dialog).getByAltText('Peta, slide 164 dari 164')).toBeInTheDocument();
    fireEvent.change(isian, { target: { value: '' } });
    fireEvent.blur(isian);
    expect(within(dialog).getByAltText('Peta, slide 164 dari 164')).toBeInTheDocument();
  });

  it('panah kiri/kanan, Home, End membalik halaman; panah di isian angka tidak membalik', () => {
    render(<PenampilDokumen dokumenId={DOK} judul="Peta" kategori="Peta Potensi" jumlahHalaman={10} onTutup={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const alt = (n: number) => `Peta, slide ${n} dari 10`;
    const berikutnya = within(dialog).getByRole('button', { name: /Berikutnya/ });
    fireEvent.keyDown(berikutnya, { key: 'ArrowRight' });
    expect(within(dialog).getByAltText(alt(2))).toBeInTheDocument();
    fireEvent.keyDown(berikutnya, { key: 'ArrowRight' });
    fireEvent.keyDown(berikutnya, { key: 'ArrowLeft' });
    expect(within(dialog).getByAltText(alt(2))).toBeInTheDocument();
    fireEvent.keyDown(berikutnya, { key: 'End' });
    expect(within(dialog).getByAltText(alt(10))).toBeInTheDocument();
    fireEvent.keyDown(berikutnya, { key: 'ArrowRight' });
    expect(within(dialog).getByAltText(alt(10))).toBeInTheDocument();
    fireEvent.keyDown(berikutnya, { key: 'Home' });
    expect(within(dialog).getByAltText(alt(1))).toBeInTheDocument();
    fireEvent.keyDown(within(dialog).getByRole('spinbutton'), { key: 'ArrowRight' });
    expect(within(dialog).getByAltText(alt(1))).toBeInTheDocument();
  });

  it('Escape memanggil onTutup', () => {
    const onTutup = vi.fn();
    render(<PenampilDokumen dokumenId={DOK} judul="Kajian" jumlahHalaman={1} onTutup={onTutup} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onTutup).toHaveBeenCalledTimes(1);
  });
});
