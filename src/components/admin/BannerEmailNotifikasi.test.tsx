// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import BannerEmailNotifikasi from './BannerEmailNotifikasi';

const balas = (profil: unknown, ok = true) => {
  const f = vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(ok ? { profil } : { error: 'x' }) }));
  vi.stubGlobal('fetch', f);
  return f;
};

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe('BannerEmailNotifikasi', () => {
  it('email belum terverifikasi: pengingat halus dengan tautan ke Profil Saya', async () => {
    balas({ email_notifikasi: 'a@b.go.id', email_notifikasi_terverifikasi: false });
    render(<BannerEmailNotifikasi />);
    expect(await screen.findByText(/belum terverifikasi/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Profil Saya/ }).getAttribute('href')).toBe('/admin/profil');
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('email belum diisi: pengingat untuk mengisi', async () => {
    balas({ email_notifikasi: null, email_notifikasi_terverifikasi: false });
    render(<BannerEmailNotifikasi />);
    expect(await screen.findByText(/belum diisi/)).toBeTruthy();
  });

  it('email terverifikasi: tidak tampil', async () => {
    const f = balas({ email_notifikasi: 'a@b.go.id', email_notifikasi_terverifikasi: true });
    render(<BannerEmailNotifikasi />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('galat memuat profil: diam, tidak memblokir dashboard', async () => {
    const f = balas(null, false);
    render(<BannerEmailNotifikasi />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Tutup menyembunyikan banner untuk sesi ini dan tidak muncul lagi saat dipasang ulang', async () => {
    balas({ email_notifikasi: 'a@b.go.id', email_notifikasi_terverifikasi: false });
    const { unmount } = render(<BannerEmailNotifikasi />);
    fireEvent.click(await screen.findByRole('button', { name: /Tutup pengingat/ }));
    expect(screen.queryByRole('status')).toBeNull();
    unmount();
    const f = balas({ email_notifikasi: 'a@b.go.id', email_notifikasi_terverifikasi: false });
    render(<BannerEmailNotifikasi />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole('status')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('teks tanpa em dash', async () => {
    balas({ email_notifikasi: null, email_notifikasi_terverifikasi: false });
    const { container } = render(<BannerEmailNotifikasi />);
    await screen.findByRole('status');
    expect(container.textContent).not.toMatch(/—/);
  });
});
