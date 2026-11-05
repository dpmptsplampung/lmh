// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import GrafikDonat from './GrafikDonat';
import { stubUkuranGrafik } from './stubUkuran';

beforeAll(() => stubUkuranGrafik(180, 180));
afterEach(cleanup);

describe('GrafikDonat', () => {
  it('menyediakan legenda bernilai berupa daftar teks dengan persen', () => {
    render(
      <GrafikDonat
        label="Kunjungan per jalur"
        data={[
          { nama: 'Walk-in', nilai: 750 },
          { nama: 'Reservasi', nilai: 250 },
        ]}
        tengah={{ nilai: '1.000', label: 'kunjungan' }}
      />,
    );
    const grup = screen.getByRole('group', { name: 'Kunjungan per jalur' });
    const daftar = within(grup).getByRole('list');
    const butir = within(daftar).getAllByRole('listitem');
    expect(butir).toHaveLength(2);
    expect(butir[0]).toHaveTextContent('Walk-in');
    expect(butir[0]).toHaveTextContent('750 (75%)');
    expect(screen.getByText('1.000')).toBeInTheDocument();
  });

  it('total nol tidak membagi dengan nol', () => {
    render(<GrafikDonat label="x" data={[{ nama: 'A', nilai: 0 }]} />);
    expect(screen.getByRole('listitem')).toHaveTextContent('A');
    expect(screen.getByRole('listitem').textContent).not.toMatch(/NaN|%/);
  });
});
