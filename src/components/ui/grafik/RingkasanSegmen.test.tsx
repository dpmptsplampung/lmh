// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import RingkasanSegmen from './RingkasanSegmen';

afterEach(cleanup);

describe('RingkasanSegmen', () => {
  it('angka besar, label, dan bagian dari total untuk pembaca layar', () => {
    render(
      <RingkasanSegmen
        judul="Kunjungan per jalur"
        item={[
          { label: 'Walk-in', nilai: 3000 },
          { label: 'Reservasi', nilai: 1000 },
        ]}
      />,
    );
    expect(screen.getByRole('region', { name: 'Kunjungan per jalur' })).toBeInTheDocument();
    expect(screen.getByText('3.000')).toBeInTheDocument();
    expect(screen.getByText(/Walk-in/)).toHaveTextContent('75 persen dari total');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
  it('total nol tidak menghasilkan NaN', () => {
    const { container } = render(<RingkasanSegmen judul="x" item={[{ label: 'A', nilai: 0 }]} />);
    expect(container.innerHTML).not.toContain('NaN');
  });
  it('memuat dan kosong', () => {
    const { rerender } = render(<RingkasanSegmen judul="Segmen" item={[]} memuat />);
    expect(screen.getByText('Memuat Segmen')).toBeInTheDocument();
    rerender(<RingkasanSegmen judul="Segmen" item={[]} kosong={<p>Belum ada data</p>} />);
    expect(screen.getByText('Belum ada data')).toBeInTheDocument();
  });
});
