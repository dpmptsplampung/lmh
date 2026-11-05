// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Kartu from './Kartu';

afterEach(cleanup);

describe('Kartu', () => {
  it('dengan judul menjadi region bernama dan judulnya h2', () => {
    render(
      <Kartu judul="Kunjungan" aksi={<button type="button">Menu</button>}>
        isi
      </Kartu>,
    );
    expect(screen.getByRole('region', { name: 'Kunjungan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Kunjungan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByText('isi')).toBeInTheDocument();
  });
  it('tanpa judul tidak menjadi landmark bernama', () => {
    render(<Kartu>polos</Kartu>);
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });
  it('mendukung elemen pembungkus lain', () => {
    const { container } = render(<Kartu as="article">x</Kartu>);
    expect(container.querySelector('article')).not.toBeNull();
  });
});
