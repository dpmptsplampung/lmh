// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import Pagination from './Pagination';

describe('Pagination', () => {
  afterEach(() => cleanup());

  it('renders page info with total data', () => {
    render(<Pagination page={0} pageSize={25} total={60} onPageChange={() => {}} />);
    expect(screen.getByText(/Halaman 1 dari 3/)).toBeInTheDocument();
    expect(screen.getByText(/total 60 data/)).toBeInTheDocument();
  });

  it('renders nothing when total is 0', () => {
    const { container } = render(<Pagination page={0} pageSize={25} total={0} onPageChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('disables prev on first page and next on last page', () => {
    render(<Pagination page={0} pageSize={25} total={60} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /sebelumnya/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /berikutnya/i })).not.toBeDisabled();

    cleanup();
    render(<Pagination page={2} pageSize={25} total={60} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /berikutnya/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /sebelumnya/i })).not.toBeDisabled();
  });

  it('calls onPageChange when navigating', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} pageSize={25} total={60} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole('button', { name: /berikutnya/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: /sebelumnya/i }));
    expect(onPageChange).toHaveBeenCalledWith(0);
  });
});
