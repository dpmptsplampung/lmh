// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import InvestasiNotFound from './not-found';

afterEach(cleanup);

describe('404 rute /investasi', () => {
  it('tetap memakai kepala dan kaki investasi, satu h1, dan dua jalan keluar', () => {
    render(<InvestasiNotFound />);
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Proyek Tidak Ditemukan' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lihat semua proyek' })).toHaveAttribute('href', '/investasi');
    expect(screen.getByRole('link', { name: 'Kembali ke Beranda' })).toHaveAttribute('href', '/');
  });
});
