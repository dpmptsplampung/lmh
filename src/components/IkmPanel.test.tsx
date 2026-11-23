import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IkmPanel from './IkmPanel';

vi.mock('recharts', () => {
  const Kosong = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Kosong, Bar: Kosong, XAxis: Kosong, YAxis: Kosong, CartesianGrid: Kosong, Tooltip: Kosong,
    ResponsiveContainer: Kosong, Cell: Kosong,
  };
});

describe('IkmPanel: tabel per layanan', () => {
  it('punya caption, header kolom ber-scope, dan wilayah gulir yang bisa difokus', () => {
    render(<IkmPanel mode="public" periodLabel="Kuartal 1" rows={[]} />);
    const tabel = screen.getByRole('table', { name: 'Tabel IKM per Layanan' });
    expect(tabel).toBeInTheDocument();
    for (const kolom of screen.getAllByRole('columnheader')) expect(kolom).toHaveAttribute('scope', 'col');
    const wilayah = screen.getByRole('region', { name: 'Tabel IKM per Layanan' });
    expect(wilayah).toHaveAttribute('tabindex', '0');
  });
});
