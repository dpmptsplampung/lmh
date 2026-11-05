// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Tabel, { type KolomTabel } from './Tabel';

afterEach(cleanup);

interface Baris {
  id: string;
  nomor: string;
  nama: string;
  tunggu: number;
}
const DATA: Baris[] = [
  { id: '1', nomor: 'OS-014', nama: 'Budi', tunggu: 12 },
  { id: '2', nomor: 'OS-015', nama: 'Sari', tunggu: 7 },
];
const KOLOM: KolomTabel<Baris>[] = [
  { kunci: 'nomor', judul: 'Nomor', judulBaris: true, peran: 'utama' },
  { kunci: 'nama', judul: 'Nama' },
  { kunci: 'tunggu', judul: 'Tunggu (mnt)', angka: true },
  { kunci: 'aksi', judul: 'Aksi', peran: 'aksi', render: (b) => <button type="button">Panggil {b.nomor}</button> },
];

describe('Tabel', () => {
  it('tabel asli dengan caption, th scope col/row, dan wilayah gulir yang bisa difokus', () => {
    render(<Tabel kolom={KOLOM} baris={DATA} kunciBaris="id" caption="Antrean menunggu" />);
    const table = screen.getByRole('table', { name: 'Antrean menunggu' });
    expect(table).toBeInTheDocument();
    const kepala = screen.getAllByRole('columnheader');
    expect(kepala).toHaveLength(4);
    kepala.forEach((th) => expect(th).toHaveAttribute('scope', 'col'));
    expect(screen.getByRole('rowheader', { name: 'OS-014' })).toHaveAttribute('scope', 'row');
    const wilayah = screen.getByRole('region', { name: 'Antrean menunggu' });
    expect(wilayah).toHaveAttribute('tabindex', '0');
  });

  it('kolom angka diberi kelas rata kanan dan kunciBaris bisa berupa fungsi', () => {
    render(<Tabel kolom={KOLOM} baris={DATA} kunciBaris={(b) => b.id} caption="x" />);
    const sel = screen.getByRole('cell', { name: '12' });
    expect(sel.className).toMatch(/angka/);
  });

  it('kartuDiHp: markup sama (satu daftar aksi), label per sel lewat data-label', () => {
    const { container } = render(<Tabel kolom={KOLOM} baris={DATA} kunciBaris="id" caption="Antrean" kartuDiHp />);
    expect(screen.getAllByRole('button', { name: /Panggil/ })).toHaveLength(2);
    const baris1 = screen.getAllByRole('row')[1];
    expect(within(baris1).getByRole('cell', { name: '12' })).toHaveAttribute('data-label', 'Tunggu (mnt)');
    // peran utama/aksi tidak diberi label berulang di kartu
    expect(container.querySelectorAll('[data-label="Aksi"]')).toHaveLength(0);
  });

  it('memuat: aria-busy dengan kerangka, tanpa tabel', () => {
    const { container } = render(<Tabel kolom={KOLOM} baris={[]} kunciBaris="id" caption="Antrean" memuat />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Memuat Antrean')).toBeInTheDocument();
  });

  it('kosong: menampilkan node kosong, bukan tabel', () => {
    render(<Tabel kolom={KOLOM} baris={[]} kunciBaris="id" caption="Antrean" kosong={<p>Belum ada antrean</p>} />);
    expect(screen.getByText('Belum ada antrean')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
