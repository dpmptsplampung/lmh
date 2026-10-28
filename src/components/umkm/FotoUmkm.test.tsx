import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import FotoUmkm from './FotoUmkm';

afterEach(cleanup);

describe('FotoUmkm', () => {
  it('merender img lazy tanpa Referer', () => {
    render(<FotoUmkm src="https://x.id/a.jpg" alt="Produk" width={80} height={80} />);
    const img = screen.getByAltText('Produk');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('loading', 'lazy');
  });
  it('gagal muat -> placeholder "Foto tidak tersedia"', () => {
    render(<FotoUmkm src="https://mati.id/a.jpg" alt="Produk" fill />);
    fireEvent.error(screen.getByAltText('Produk'));
    expect(screen.getByRole('img', { name: 'Foto tidak tersedia' })).toBeInTheDocument();
  });
});
