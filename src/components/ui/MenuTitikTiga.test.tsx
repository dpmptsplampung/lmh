// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MenuTitikTiga from './MenuTitikTiga';

afterEach(cleanup);

function siapkan() {
  const a = vi.fn();
  const b = vi.fn();
  render(
    <>
      <MenuTitikTiga
        label="Aksi untuk OS-014"
        item={[
          { label: 'Panggil', onPilih: a },
          { label: 'Alihkan', onPilih: b },
          { label: 'Lihat detail', href: '/admin/kunjungan' },
          { label: 'Hapus', bahaya: true, nonaktif: true },
        ]}
      />
      <p>di luar</p>
    </>,
  );
  return { a, b, tombol: screen.getByRole('button', { name: 'Aksi untuk OS-014' }) };
}

describe('MenuTitikTiga', () => {
  it('tombol punya aria-haspopup=menu dan aria-expanded', () => {
    const { tombol } = siapkan();
    expect(tombol).toHaveAttribute('aria-haspopup', 'menu');
    expect(tombol).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(tombol);
    expect(tombol).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  it('fokus ke item pertama saat dibuka; panah menelusuri dan berputar, melewati item nonaktif', () => {
    const { tombol } = siapkan();
    fireEvent.click(tombol);
    const menu = screen.getByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Panggil' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Alihkan' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Lihat detail' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Panggil' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Lihat detail' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'Panggil' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Lihat detail' })).toHaveFocus();
  });

  it('Esc menutup dan mengembalikan fokus ke tombol', () => {
    const { tombol } = siapkan();
    fireEvent.click(tombol);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(tombol).toHaveFocus();
  });

  it('panah bawah pada tombol membuka menu', () => {
    const { tombol } = siapkan();
    fireEvent.keyDown(tombol, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('memilih item memanggil aksi, menutup menu, dan fokus kembali', () => {
    const { a, tombol } = siapkan();
    fireEvent.click(tombol);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Panggil' }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(tombol).toHaveFocus();
  });

  it('item nonaktif tidak memanggil aksi; item href berupa tautan', () => {
    const { tombol } = siapkan();
    fireEvent.click(tombol);
    const hapus = screen.getByRole('menuitem', { name: 'Hapus' });
    expect(hapus).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(hapus);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Lihat detail' })).toHaveAttribute('href', '/admin/kunjungan');
  });

  it('klik di luar menutup menu', () => {
    const { tombol } = siapkan();
    fireEvent.click(tombol);
    fireEvent.mouseDown(screen.getByText('di luar'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
