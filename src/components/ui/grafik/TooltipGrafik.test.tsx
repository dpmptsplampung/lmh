// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TooltipGrafik from './TooltipGrafik';

afterEach(cleanup);

describe('TooltipGrafik', () => {
  it('tidak dirender saat tidak aktif', () => {
    const { container } = render(<TooltipGrafik active={false} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('menampilkan label, nama seri, dan angka id-ID', () => {
    render(
      <TooltipGrafik
        active
        label="3 Nov"
        payload={[{ dataKey: 'ini', value: 12345, color: 'red' }]}
        seri={{ ini: { label: 'Periode ini', warna: 'var(--chart-1)' } }}
      />,
    );
    expect(screen.getByText('3 Nov')).toBeInTheDocument();
    expect(screen.getByText('Periode ini')).toBeInTheDocument();
    expect(screen.getByText('12.345')).toBeInTheDocument();
  });
});
