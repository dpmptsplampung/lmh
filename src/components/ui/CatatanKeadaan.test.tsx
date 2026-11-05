// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import CatatanKeadaan, { type JenisKeadaan } from './CatatanKeadaan';

afterEach(cleanup);

describe('CatatanKeadaan', () => {
  it('libur: role note dan label jenis untuk pembaca layar', () => {
    render(<CatatanKeadaan jenis="libur">Hari ini libur; antrean tidak dibuka.</CatatanKeadaan>);
    const n = screen.getByRole('note');
    expect(n).toHaveTextContent('Hari libur: Hari ini libur; antrean tidak dibuka.');
    expect(n).toHaveAttribute('data-jenis', 'libur');
  });

  it('galat memakai role alert, jenis lain tidak', () => {
    render(<CatatanKeadaan jenis="galat">Gagal memuat.</CatatanKeadaan>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    cleanup();
    render(<CatatanKeadaan jenis="menunggu-migrasi">Migrasi belum diterapkan.</CatatanKeadaan>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('kosong, libur, dan galat dibedakan lewat label teks', () => {
    const jenis: JenisKeadaan[] = ['kosong', 'libur', 'galat'];
    const label = jenis.map((j) => {
      const { container, unmount } = render(<CatatanKeadaan jenis={j}>x</CatatanKeadaan>);
      const teks = container.querySelector('.sr-only')?.textContent ?? '';
      unmount();
      return teks;
    });
    expect(new Set(label).size).toBe(3);
  });

  it('judul dan aksi opsional', () => {
    render(
      <CatatanKeadaan jenis="lingkup" judul="Menampilkan Perizinan saja" aksi={<button type="button">Ubah</button>}>
        Sesuai lingkup akunmu.
      </CatatanKeadaan>,
    );
    expect(screen.getByText('Menampilkan Perizinan saja')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
  });
});
