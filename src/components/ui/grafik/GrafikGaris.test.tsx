// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { stubUkuranGrafik } from './stubUkuran';
import GrafikGaris from './GrafikGaris';

beforeAll(() => stubUkuranGrafik());
afterEach(cleanup);

const DATA = [
  { hari: '1 Nov', ini: 120, lalu: 100 },
  { hari: '2 Nov', ini: 150, lalu: 110 },
  { hari: '3 Nov', ini: 90, lalu: 130 },
];

describe('GrafikGaris', () => {
  it('dirender sebagai grup bernama dengan accessibilityLayer dan label sumbu', () => {
    const { container } = render(
      <GrafikGaris
        label="Kunjungan 30 hari"
        data={DATA}
        sumbuX="hari"
        seri={[
          { kunci: 'ini', label: 'Periode ini', area: true },
          { kunci: 'lalu', label: 'Periode lalu', putus: true },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Kunjungan 30 hari' })).toBeInTheDocument();
    expect(container.querySelector('svg.recharts-surface')).not.toBeNull();
    // accessibilityLayer: surface dapat difokus papan ketik
    expect(container.querySelector('.recharts-wrapper')?.getAttribute('tabindex') ?? container.querySelector('svg')?.getAttribute('tabindex')).toBe('0');
  });

  it('warna seri berasal dari token, bukan heksadesimal; seri pembanding memakai --chart-compare dan putus-putus', () => {
    const { container } = render(
      <GrafikGaris
        label="x"
        data={DATA}
        sumbuX="hari"
        seri={[
          { kunci: 'ini', label: 'Ini' },
          { kunci: 'lalu', label: 'Lalu', putus: true },
        ]}
      />,
    );
    const jalur = Array.from(container.querySelectorAll('path.recharts-area-curve'));
    expect(jalur.length).toBe(2);
    expect(jalur[0].getAttribute('stroke')).toBe('var(--chart-1)');
    expect(jalur[1].getAttribute('stroke')).toBe('var(--chart-compare)');
    expect(jalur[1].getAttribute('stroke-dasharray')).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it('tanpa data tetap tidak melempar galat', () => {
    expect(() => render(<GrafikGaris label="kosong" data={[]} sumbuX="hari" seri={[{ kunci: 'ini', label: 'Ini' }]} />)).not.toThrow();
  });
});
