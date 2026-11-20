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
    const gambar = within(dialog).getByAltText('Halaman 1 dari 3');
    expect(gambar).toHaveAttribute('src', `/api/investment-docs/page-image?doc_id=${DOK}&page=1`);
    expect(within(dialog).getByRole('button', { name: /Sebelumnya/ })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    expect(within(dialog).getByText('Halaman 2 dari 3')).toBeInTheDocument();
    expect(within(dialog).getByAltText('Halaman 2 dari 3')).toHaveAttribute('src', expect.stringContaining('page=2'));
    // fireEvent mengembalikan false bila preventDefault dipanggil.
    expect(fireEvent.contextMenu(within(dialog).getByAltText('Halaman 2 dari 3'))).toBe(false);
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
    fireEvent.error(within(dialog).getByAltText('Halaman 1 dari 2'));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/belum dapat dimuat/);
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    expect(within(dialog).getByAltText('Halaman 2 dari 2')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('Escape memanggil onTutup', () => {
    const onTutup = vi.fn();
    render(<PenampilDokumen dokumenId={DOK} judul="Kajian" jumlahHalaman={1} onTutup={onTutup} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onTutup).toHaveBeenCalledTimes(1);
  });
});
