// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import FotoKatalog from './FotoKatalog';

afterEach(cleanup);
it('foto gagal punya pesan jelas dan percobaan ulang memuat gambar baru', () => {
  render(<FotoKatalog src="https://example.test/foto.jpg" alt="Foto kopi" />);
  fireEvent.error(screen.getByRole('img', { name: 'Foto kopi' }));
  expect(screen.getByRole('img', { name: 'Foto tidak tersedia' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Coba lagi memuat foto kopi' }));
  expect(screen.getByRole('img', { name: 'Foto kopi' })).toHaveAttribute('referrerPolicy', 'no-referrer');
});
