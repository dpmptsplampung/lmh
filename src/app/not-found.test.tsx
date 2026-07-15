// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import NotFound from './not-found';

describe('not-found page', () => {
  afterEach(cleanup);

  it('shows Indonesian not-found message and home link', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /tidak ditemukan|halaman tidak|404/i,
    );
    const home = screen.getByRole('link', { name: /beranda|halaman utama|kembali/i });
    expect(home.getAttribute('href')).toBe('/');
    expect(document.body.textContent).toMatch(/tidak ditemukan|tidak tersedia/i);
  });
});
