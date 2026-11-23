import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import GambarLampiran from './GambarLampiran';

describe('GambarLampiran', () => {
  afterEach(cleanup);

  it('membungkus gambar di kotak berasio tetap dan memuatnya lazy lewat route berizin', () => {
    render(<GambarLampiran pesanId="p1" nama="ktp.jpg" />);
    const gambar = screen.getByRole('img', { name: 'Foto: ktp.jpg' });
    expect(gambar).toHaveAttribute('src', '/api/chat/lampiran/p1');
    expect(gambar).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('link').className).toMatch(/kotak/);
  });

  it('gagal muat: teks pengganti tetap memakai kotak yang sama', () => {
    render(<GambarLampiran pesanId="p2" />);
    fireEvent.error(screen.getByRole('img', { name: 'Foto lampiran' }));
    const teks = screen.getByText('Foto tidak tersedia');
    expect(teks.className).toMatch(/kotak/);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
