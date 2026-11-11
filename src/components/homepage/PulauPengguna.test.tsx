// @vitest-environment jsdom
// Pulau klien bilah navigasi beranda: satu-satunya bagian beranda yang bergantung pada sesi (getUser + role)
// dan pada keadaan menu seluler. Keluaran server selalu keadaan "belum masuk"; data pengguna hanya muncul
// setelah hidrasi.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  pathname: '/',
  user: null as null | { user_metadata?: { full_name?: string; avatar_url?: string }; id: string },
  role: null as string | null,
  getUser: vi.fn(),
  from: vi.fn(),
  keluar: vi.fn(),
  klien: {} as Record<string, unknown>,
}));

vi.mock('next/navigation', () => ({ usePathname: () => h.pathname }));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => h.klien }));
vi.mock('@/lib/sesi-staf', () => ({ keluarDariSesi: h.keluar }));

import PulauPengguna from './PulauPengguna';

beforeEach(() => {
  h.pathname = '/';
  h.user = null;
  h.role = null;
  h.getUser.mockReset();
  h.getUser.mockImplementation(async () => ({ data: { user: h.user } }));
  h.from.mockReset();
  h.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: h.role ? { role: h.role } : null }) }) }),
  }));
  h.keluar.mockReset();
  h.keluar.mockResolvedValue(undefined);
  h.klien = { auth: { getUser: h.getUser }, from: h.from };
});
afterEach(cleanup);

const masuk = (nama = 'Budi') => {
  h.user = { id: 'u-1', user_metadata: { full_name: nama } };
};

describe('PulauPengguna: tautan navigasi', () => {
  it('menampilkan merek dan tautan tetap; "Layanan" hanya bila ada blok layanan', () => {
    const { rerender } = render(<PulauPengguna adaBlokLayanan />);
    expect(screen.getByRole('link', { name: 'Layanan' })).toHaveAttribute('href', '#layanan');
    expect(screen.getByRole('link', { name: 'UMKM' })).toHaveAttribute('href', '/umkm/katalog');
    expect(screen.getByRole('link', { name: 'Investasi' })).toHaveAttribute('href', '/gallery');
    expect(screen.getByRole('link', { name: 'Live Chat' })).toHaveAttribute('href', '/chat');
    expect(screen.getByRole('link', { name: 'Transparansi' })).toHaveAttribute('href', '/transparansi');
    expect(screen.getByAltText('Lampung Maju Hub Logo')).toBeInTheDocument();
    rerender(<PulauPengguna adaBlokLayanan={false} />);
    expect(screen.queryByRole('link', { name: 'Layanan' })).toBeNull();
    expect(screen.getByRole('link', { name: 'UMKM' })).toBeInTheDocument();
  });
});

describe('PulauPengguna: sesi', () => {
  it('belum masuk: hanya tombol Masuk (tanpa Panel Admin/Dashboard/Keluar)', async () => {
    render(<PulauPengguna adaBlokLayanan />);
    await waitFor(() => expect(h.getUser).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Masuk' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: 'Panel Admin' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Dashboard Saya' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keluar' })).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });

  it.each(['admin', 'petugas', 'front_office'])('peran %s: tautan Panel Admin ke /admin + tombol Keluar', async (peran) => {
    masuk();
    h.role = peran;
    render(<PulauPengguna adaBlokLayanan />);
    expect(await screen.findByRole('link', { name: 'Panel Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('button', { name: 'Keluar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Masuk' })).toBeNull();
    expect(h.from).toHaveBeenCalledWith('petugas');
  });

  it('pengguna biasa (bukan petugas): Dashboard Saya ke /me', async () => {
    masuk();
    h.role = null;
    render(<PulauPengguna adaBlokLayanan />);
    expect(await screen.findByRole('link', { name: 'Dashboard Saya' })).toHaveAttribute('href', '/me');
    expect(screen.queryByRole('link', { name: 'Panel Admin' })).toBeNull();
  });

  it('Keluar memanggil keluarDariSesi lalu kembali ke tampilan belum masuk', async () => {
    masuk();
    h.role = 'admin';
    render(<PulauPengguna adaBlokLayanan />);
    fireEvent.click(await screen.findByRole('button', { name: 'Keluar' }));
    await waitFor(() => expect(h.keluar).toHaveBeenCalledWith(h.klien));
    expect(await screen.findByRole('link', { name: 'Masuk' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Panel Admin' })).toBeNull();
  });

  it('getUser menolak: tetap tampil sebagai belum masuk (tanpa crash)', async () => {
    h.getUser.mockRejectedValue(new Error('jaringan'));
    render(<PulauPengguna adaBlokLayanan />);
    await waitFor(() => expect(h.getUser).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: 'Masuk' })).toBeInTheDocument();
  });
});

describe('PulauPengguna: menu seluler', () => {
  const tombol = () => screen.getByRole('button', { name: 'Buka menu navigasi' });

  it('tertutup di awal; tombol membuka dan menutup panel dengan aria-expanded', () => {
    render(<PulauPengguna adaBlokLayanan />);
    expect(tombol()).toHaveAttribute('aria-expanded', 'false');
    expect(tombol()).toHaveAttribute('aria-controls', 'mobile-nav-menu');
    expect(document.getElementById('mobile-nav-menu')).toBeNull();
    fireEvent.click(tombol());
    const panel = document.getElementById('mobile-nav-menu')!;
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tutup menu navigasi' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(panel).getByRole('link', { name: 'Layanan' })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Masuk' })).toHaveAttribute('href', '/login');
    fireEvent.click(screen.getByRole('button', { name: 'Tutup menu navigasi' }));
    expect(document.getElementById('mobile-nav-menu')).toBeNull();
  });

  it('Escape menutup menu dan mengembalikan fokus ke tombol', () => {
    render(<PulauPengguna adaBlokLayanan />);
    fireEvent.click(tombol());
    expect(document.getElementById('mobile-nav-menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.getElementById('mobile-nav-menu')).toBeNull();
    expect(tombol()).toHaveFocus();
  });

  it('klik tautan Layanan di panel menutup menu', () => {
    render(<PulauPengguna adaBlokLayanan />);
    fireEvent.click(tombol());
    fireEvent.click(within(document.getElementById('mobile-nav-menu')!).getByRole('link', { name: 'Layanan' }));
    expect(document.getElementById('mobile-nav-menu')).toBeNull();
  });

  it('pindah halaman (pathname berubah) menutup menu', () => {
    const { rerender } = render(<PulauPengguna adaBlokLayanan />);
    fireEvent.click(tombol());
    expect(document.getElementById('mobile-nav-menu')).toBeInTheDocument();
    h.pathname = '/chat';
    rerender(<PulauPengguna adaBlokLayanan />);
    expect(document.getElementById('mobile-nav-menu')).toBeNull();
  });

  it('panel tanpa blok layanan tidak punya tautan Layanan; admin melihat Panel Admin di panel', async () => {
    masuk();
    h.role = 'admin';
    render(<PulauPengguna adaBlokLayanan={false} />);
    await screen.findByRole('link', { name: 'Panel Admin' });
    fireEvent.click(tombol());
    const panel = document.getElementById('mobile-nav-menu')!;
    expect(within(panel).queryByRole('link', { name: 'Layanan' })).toBeNull();
    expect(within(panel).getByRole('link', { name: 'Panel Admin' })).toHaveAttribute('href', '/admin');
    await act(async () => {});
  });
});
