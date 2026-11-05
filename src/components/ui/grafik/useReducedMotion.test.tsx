// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubGerakDikurangi } from './stubUkuran';
import { useReducedMotion } from './useReducedMotion';

function Tampil() {
  return <p>{useReducedMotion() ? 'kurangi' : 'normal'}</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useReducedMotion', () => {
  it('false bila matchMedia tidak tersedia atau tidak cocok', () => {
    render(<Tampil />);
    expect(screen.getByText('normal')).toBeInTheDocument();
    cleanup();
    stubGerakDikurangi(false);
    render(<Tampil />);
    expect(screen.getByText('normal')).toBeInTheDocument();
  });
  it('true bila pengguna meminta gerak dikurangi', () => {
    stubGerakDikurangi(true);
    render(<Tampil />);
    expect(screen.getByText('kurangi')).toBeInTheDocument();
  });
});
