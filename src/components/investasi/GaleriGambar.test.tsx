// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import GaleriGambar from './GaleriGambar';

afterEach(cleanup);
const g = (n: number) => ({
  id: `g${n}`, url: `https://r2.example/${n}.webp`, url_mini: `https://r2.example/${n}-640.webp`,
  alt: `Foto nomor ${n}`, lebar: 1200, tinggi: 800, keterangan: n === 2 ? 'Dermaga lama' : null,
});

describe('GaleriGambar', () => {
  it('tanpa gambar tidak merender apa pun', () => {
    const { container } = render(<GaleriGambar gambar={[]} judul="Proyek" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tiap foto adalah tombol bernama dari alt; membuka dialog dengan foto besar beralt dan keterangan', () => {
    render(<GaleriGambar gambar={[g(1), g(2), g(3)]} judul="Proyek Pesisir" />);
    const tombol = screen.getAllByRole('button', { name: /Perbesar foto/ });
    expect(tombol).toHaveLength(3);
    expect(tombol[1]).toHaveAccessibleName('Perbesar foto 2 dari 3: Foto nomor 2');
    tombol[1].focus();
    fireEvent.click(tombol[1]);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Foto Proyek Pesisir');
    expect(within(dialog).getByRole('img', { name: 'Foto nomor 2' })).toHaveAttribute('src', expect.stringContaining('/2.webp'));
    expect(within(dialog).getByText('Dermaga lama')).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription('Foto 2 dari 3');
  });

  it('navigasi papan ketik (panah) dan tombol berputar; Escape menutup dan fokus kembali ke pemicu', () => {
    render(<GaleriGambar gambar={[g(1), g(2), g(3)]} judul="Proyek" />);
    const pemicu = screen.getAllByRole('button', { name: /Perbesar foto/ })[0];
    pemicu.focus();
    fireEvent.click(pemicu);
    const dialog = screen.getByRole('dialog');
    const lanjut = within(dialog).getByRole('button', { name: /Berikutnya/ });
    lanjut.focus();
    fireEvent.keyDown(lanjut, { key: 'ArrowRight' });
    expect(within(dialog).getByRole('img', { name: 'Foto nomor 2' })).toBeInTheDocument();
    fireEvent.keyDown(lanjut, { key: 'ArrowLeft' });
    fireEvent.keyDown(lanjut, { key: 'ArrowLeft' });
    expect(within(dialog).getByRole('img', { name: 'Foto nomor 3' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Berikutnya/ }));
    expect(within(dialog).getByRole('img', { name: 'Foto nomor 1' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pemicu).toHaveFocus();
  });
});
