// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Galat from './Galat';

afterEach(cleanup);

describe('Galat', () => {
  it('membungkus ErrorRetry: role alert, pesan, dan tombol Coba lagi', () => {
    const onRetry = vi.fn();
    render(<Galat pesan="Gagal memuat antrean." judul="Antrean" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Gagal memuat antrean.');
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it('memuat menonaktifkan tombol dan mengganti label', () => {
    render(<Galat pesan="x" onRetry={() => {}} memuat />);
    expect(screen.getByRole('button', { name: 'Memuat…' })).toBeDisabled();
  });
  it('tanpa onRetry tidak ada tombol', () => {
    render(<Galat pesan="Tidak ada izin." />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
