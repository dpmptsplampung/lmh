// @vitest-environment jsdom
// FilterAntrian (tab saringan status).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FilterAntrian from './FilterAntrian';

afterEach(cleanup);

describe('FilterAntrian', () => {
  it('tiga tab dengan satu terpilih; memilih tab memanggil onGanti dengan kuncinya', () => {
    const onGanti = vi.fn();
    render(<FilterAntrian aktif="aktif" onGanti={onGanti} />);
    expect(screen.getByRole('tablist', { name: 'Saringan status antrean' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aktif' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Selesai' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('tab', { name: 'Semua' }));
    expect(onGanti).toHaveBeenCalledWith('semua');
  });
});
