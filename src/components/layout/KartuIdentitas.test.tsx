// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <a href={href} {...rest} onClick={(e) => { onClick?.(); e.preventDefault(); }}>{children}</a>
  ),
}));

import KartuIdentitas, { inisialDari } from './KartuIdentitas';

afterEach(cleanup);

describe('inisialDari', () => {
  it('dua kata = huruf pertama keduanya; satu kata = dua huruf; kosong = ?', () => {
    expect(inisialDari('Dewi Anggraini')).toBe('DA');
    expect(inisialDari('  budi   santoso  wijaya ')).toBe('BS');
    expect(inisialDari('Budi')).toBe('BU');
    expect(inisialDari('   ')).toBe('?');
    expect(inisialDari('')).toBe('?');
  });
});

describe('KartuIdentitas', () => {
  const pasang = (props: Partial<React.ComponentProps<typeof KartuIdentitas>> = {}) => {
    const onKeluar = vi.fn();
    const onNavigasi = vi.fn();
    render(<KartuIdentitas nama="Dewi Anggraini" peran="Petugas" layanan="Perizinan" onKeluar={onKeluar} onNavigasi={onNavigasi} {...props} />);
    return { onKeluar, onNavigasi, kartu: screen.getByRole('button', { name: /Dewi Anggraini/ }) };
  };

  it('menampilkan nama dan "peran · Layanan"; tombol menu tertutup bawaan', () => {
    const { kartu } = pasang();
    expect(kartu).toHaveTextContent('Dewi Anggraini');
    expect(kartu).toHaveTextContent('Petugas · Perizinan');
    expect(kartu).toHaveAttribute('aria-haspopup', 'menu');
    expect(kartu).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('tanpa Layanan hanya peran; tanpa nama memakai "Pengguna"', () => {
    render(<KartuIdentitas nama="" peran="Petugas" layanan={null} onKeluar={() => {}} />);
    const kartu = screen.getByRole('button', { name: 'Pengguna Petugas' });
    expect(kartu).toHaveTextContent('Pengguna');
    expect(kartu.textContent).not.toContain('·');
  });

  it('klik membuka menu berisi Profil Saya dan Keluar; fokus ke item pertama', () => {
    const { kartu } = pasang();
    fireEvent.click(kartu);
    expect(kartu).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(kartu.getAttribute('aria-controls')).toBe(screen.getByRole('menu').id);
    const [profil, keluar] = screen.getAllByRole('menuitem');
    expect(profil).toHaveTextContent('Profil Saya');
    expect(profil).toHaveAttribute('href', '/admin/profil');
    expect(keluar).toHaveTextContent('Keluar');
    expect(profil).toHaveFocus();
  });

  it('panah, Home, End berpindah antar item; Esc menutup dan fokus kembali ke kartu', () => {
    const { kartu } = pasang();
    fireEvent.click(kartu);
    const menu = screen.getByRole('menu');
    const [profil, keluar] = screen.getAllByRole('menuitem');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(keluar).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // berputar
    expect(profil).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(keluar).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(profil).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(keluar).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(kartu).toHaveFocus();
  });

  it('ArrowDown pada kartu membuka menu', () => {
    const { kartu } = pasang();
    kartu.focus();
    fireEvent.keyDown(kartu, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('Keluar memanggil onKeluar dan menutup menu; Profil Saya memanggil onNavigasi', () => {
    const { kartu, onKeluar, onNavigasi } = pasang();
    fireEvent.click(kartu);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Profil Saya' }));
    expect(onNavigasi).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(kartu);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keluar' }));
    expect(onKeluar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('klik di luar menutup menu', () => {
    const { kartu } = pasang();
    fireEvent.click(kartu);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
