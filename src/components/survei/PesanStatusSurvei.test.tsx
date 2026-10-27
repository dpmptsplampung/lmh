import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import PesanStatusSurvei from './PesanStatusSurvei';

afterEach(() => cleanup());

describe('PesanStatusSurvei', () => {
  it.each([
    ['kedaluwarsa', 'Waktu pengisian sudah berakhir'],
    ['sudah_diisi', 'Terima kasih, survei ini sudah Anda isi'],
    ['tidak_valid', 'Tautan survei tidak dikenali'],
  ] as const)('status %s memuat pesan ramah dan tanpa kata "token"', (status, judul) => {
    const { container } = render(<PesanStatusSurvei status={status} />);

    expect(screen.getByRole('heading', { level: 2, name: judul })).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/token/i);
    // Setiap pesan memberi jalan keluar, bukan jalan buntu.
    expect(screen.getByRole('link', { name: 'Ke beranda' })).toHaveAttribute('href', '/');
  });

  it('memindahkan fokus ke judul agar pembaca layar langsung membacakannya', () => {
    render(<PesanStatusSurvei status="kedaluwarsa" />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
  });
});
