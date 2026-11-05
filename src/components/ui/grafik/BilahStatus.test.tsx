// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import BilahStatus from './BilahStatus';

afterEach(cleanup);

describe('BilahStatus', () => {
  it('daftar bernama; makna dalam teks, titik dekoratif', () => {
    const { container } = render(
      <BilahStatus
        item={[
          { kunci: 'a', nada: 'info', label: 'Hari libur' },
          { kunci: 'b', nada: 'sukses', label: '3 dari 8 layanan buka' },
        ]}
      />,
    );
    expect(screen.getByRole('list', { name: 'Status hari ini' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('3 dari 8 layanan buka')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });
  it('tanpa item tidak dirender', () => {
    const { container } = render(<BilahStatus item={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
