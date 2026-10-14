// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';

// Halaman /checkin hanya informasi: tidak boleh memakai Supabase sama sekali.
const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => {
    throw new Error('Supabase tidak boleh dipakai di /checkin');
  }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: createClientMock }));

import CheckinPage from './page';

describe('/checkin (halaman informasi, K3)', () => {
  afterEach(cleanup);

  it('mengarahkan pengunjung walk-in ke meja Front Office', () => {
    render(<CheckinPage />);
    expect(screen.getByRole('heading', { level: 1, name: /check-in kunjungan/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /datang langsung/i })).toBeInTheDocument();
    expect(screen.getByText(/silakan menuju meja front office/i)).toBeInTheDocument();
  });

  it('pengunjung ber-reservasi diarahkan ke QR di /me/reservasi', () => {
    render(<CheckinPage />);
    expect(screen.getByRole('heading', { name: /sudah punya reservasi/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /lihat qr reservasi/i })).toHaveAttribute('href', '/me/reservasi');
  });

  it('tidak ada formulir/isian dan tidak menyentuh Supabase', () => {
    render(<CheckinPage />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /kirim check-in/i })).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('sumber statis: tidak menulis visit/kunjungan/consent_log dan tidak memanggil /api/checkin', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/checkin/page.tsx'), 'utf8');
    expect(src).not.toMatch(/\.from\(/);
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/api\/checkin/);
    expect(src).not.toMatch(/signInAnonymously/);
    expect(src).not.toMatch(/['"]use client['"]/);
  });
});
