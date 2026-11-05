// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TabelCadangan from './TabelCadangan';

afterEach(cleanup);

describe('TabelCadangan', () => {
  it('tabel dengan caption, th scope, kolom pertama sebagai kepala baris, angka id-ID', () => {
    render(
      <TabelCadangan
        caption="Data Kunjungan"
        tabel={{
          kolom: [
            { kunci: 'hari', label: 'Hari' },
            { kunci: 'jumlah', label: 'Jumlah' },
          ],
          baris: [
            { hari: 'Senin', jumlah: 12345 },
            { hari: 'Selasa', jumlah: null },
          ],
        }}
      />,
    );
    expect(screen.getByRole('table', { name: 'Data Kunjungan' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').every((th) => th.getAttribute('scope') === 'col')).toBe(true);
    expect(screen.getByRole('rowheader', { name: 'Senin' })).toHaveAttribute('scope', 'row');
    expect(screen.getByRole('cell', { name: '12.345' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '-' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data Kunjungan' })).toHaveAttribute('tabindex', '0');
  });
});
