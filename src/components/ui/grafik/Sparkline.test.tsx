// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Sparkline from './Sparkline';

afterEach(cleanup);

describe('Sparkline', () => {
  it('dekoratif (aria-hidden) bila tanpa label', () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5]} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });
  it('dengan label menjadi gambar bernama', () => {
    render(<Sparkline data={[1, 3, 2, 5]} label="Tren 4 hari" />);
    expect(screen.getByRole('img', { name: 'Tren 4 hari' })).toBeInTheDocument();
  });
  it('kurang dari dua titik tidak digambar; data datar tidak menghasilkan NaN', () => {
    const a = render(<Sparkline data={[5]} />);
    expect(a.container.querySelector('svg')).toBeNull();
    const b = render(<Sparkline data={[2, 2, 2]} />);
    expect(b.container.innerHTML).not.toContain('NaN');
  });
});
