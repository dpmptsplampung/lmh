// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import BilahAtas from './BilahAtas';

afterEach(cleanup);

describe('BilahAtas', () => {
  it('logo ke beranda, judul Live Chat, dan tautan keluar chat', () => {
    render(<BilahAtas />);
    expect(screen.getByRole('link', { name: /Lampung Maju Hub Logo/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('heading', { level: 1, name: 'Live Chat' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Navigasi chat' });
    expect(nav.querySelector('a[href="/me"]')).toHaveTextContent('Beranda saya');
    expect(nav.querySelector('a[href="/"]')).toHaveTextContent('Kembali ke Web');
  });
});
