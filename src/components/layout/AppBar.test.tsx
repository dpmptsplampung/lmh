// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';

const off = vi.hoisted(() => ({ jumlah: 0, terkirim: false }));
vi.mock('@/lib/hooks/useAntreanOffline', async () => {
  const asli = await vi.importActual<typeof import('@/lib/hooks/useAntreanOffline')>('@/lib/hooks/useAntreanOffline');
  return { ...asli, useAntreanOffline: () => off };
});
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void } & Record<string, unknown>) => (
    <a href={href} {...rest} onClick={(e) => { onClick?.(); e.preventDefault(); }}>{children}</a>
  ),
}));

import AppBar from './AppBar';

beforeEach(() => {
  off.jumlah = 0;
  off.terkirim = false;
});
afterEach(cleanup);

function pasang(props: Partial<React.ComponentProps<typeof AppBar>> = {}) {
  const onToggleLaci = vi.fn();
  const toggleRef = createRef<HTMLButtonElement>();
  render(<AppBar role="front_office" judul="Antrian" total={0} laciTerbuka={false} onToggleLaci={onToggleLaci} toggleRef={toggleRef} {...props} />);
  return { onToggleLaci, toggleRef };
}

describe('AppBar', () => {
  it('tombol menu: aria-label, aria-expanded, aria-controls ke sidebar; klik memanggil onToggleLaci', () => {
    const { onToggleLaci, toggleRef } = pasang({ laciTerbuka: true });
    const tombol = screen.getByRole('button', { name: 'Buka menu' });
    expect(tombol).toHaveAttribute('aria-expanded', 'true');
    expect(tombol).toHaveAttribute('aria-controls', 'sidebar');
    expect(toggleRef.current).toBe(tombol);
    fireEvent.click(tombol);
    expect(onToggleLaci).toHaveBeenCalledTimes(1);
  });

  it('menampilkan judul halaman aktif dan ditandai untuk disembunyikan saat cetak', () => {
    pasang({ judul: 'Kelola FAQ' });
    const bilah = document.querySelector('header')!;
    expect(bilah).toHaveTextContent('Kelola FAQ');
    expect(bilah).toHaveAttribute('data-cetak', 'sembunyi');
  });

  it('lencana total: tersembunyi bila 0; angka aria-hidden dengan teks untuk pembaca layar; 99+', () => {
    pasang({ total: 0 });
    expect(screen.queryByText(/pemberitahuan menunggu/)).toBeNull();
    cleanup();
    pasang({ total: 150 });
    expect(screen.getByText('99+')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('150 pemberitahuan menunggu')).toBeInTheDocument();
  });

  it('tombol perintah: "Buka menu atau tindakan" dengan petunjuk Ctrl K; membuka dialog dan fokus kembali saat ditutup', () => {
    pasang();
    const tombol = screen.getByRole('button', { name: /Buka menu atau tindakan/ });
    expect(tombol).toHaveTextContent('Ctrl K');
    expect(tombol).toHaveAttribute('aria-keyshortcuts', 'Control+K');
    fireEvent.click(tombol);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(tombol).toHaveFocus();
  });

  it('Ctrl K dari mana saja membuka perintah cepat', () => {
    pasang();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('peran belum diketahui: tombol menu ada, tombol perintah tidak', () => {
    pasang({ role: null });
    expect(screen.getByRole('button', { name: 'Buka menu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Buka menu atau tindakan/ })).toBeNull();
  });

  it('A10: jumlah pendaftaran offline tampil sebagai status; Terkirim sesudah replay', () => {
    off.jumlah = 2;
    pasang();
    expect(screen.getByRole('status')).toHaveTextContent('2 pendaftaran menunggu dikirim');
    cleanup();
    off.jumlah = 0;
    off.terkirim = true;
    pasang();
    expect(screen.getByRole('status')).toHaveTextContent('Terkirim');
    cleanup();
    off.terkirim = false;
    pasang();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('tidak ada tautan di bilah atas (tidak menggandakan href menu)', () => {
    pasang();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
