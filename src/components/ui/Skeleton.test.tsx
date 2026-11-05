// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Skeleton from './Skeleton';

afterEach(cleanup);

describe('Skeleton', () => {
  it('wadah aria-busy, blok aria-hidden, jumlah sesuai', () => {
    const { container } = render(<Skeleton bentuk="baris" jumlah={3} />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    const blok = container.querySelectorAll('[aria-hidden="true"]');
    expect(blok).toHaveLength(3);
    expect(screen.getByText('Memuat…')).toHaveClass('sr-only');
  });
  it('label bisa diubah atau dimatikan', () => {
    const { rerender } = render(<Skeleton label="Memuat kunjungan" />);
    expect(screen.getByText('Memuat kunjungan')).toBeInTheDocument();
    rerender(<Skeleton label={false} />);
    expect(screen.queryByText(/Memuat/)).toBeNull();
  });
  it('mendukung bentuk kartu dan angka', () => {
    const a = render(<Skeleton bentuk="kartu" />);
    expect(a.container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    const b = render(<Skeleton bentuk="angka" jumlah={2} />);
    expect(b.container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });
});
