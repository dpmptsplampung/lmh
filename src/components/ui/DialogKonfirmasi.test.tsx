import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import DialogKonfirmasi from './DialogKonfirmasi';

function pasang(props: Partial<React.ComponentProps<typeof DialogKonfirmasi>> = {}) {
  const onSetuju = vi.fn();
  const onBatal = vi.fn();
  render(
    <DialogKonfirmasi terbuka judul="Hapus data?" deskripsi="Tidak bisa dibatalkan." labelSetuju="Ya, hapus" onSetuju={onSetuju} onBatal={onBatal} {...props} />,
  );
  return { onSetuju, onBatal };
}

afterEach(cleanup);

describe('DialogKonfirmasi', () => {
  it('tidak dirender saat tertutup', () => {
    pasang({ terbuka: false });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('role alertdialog bernama judul, dengan deskripsi', () => {
    pasang();
    const d = screen.getByRole('alertdialog', { name: 'Hapus data?' });
    expect(d.getAttribute('aria-describedby')).toBeTruthy();
    expect(d.textContent).toContain('Tidak bisa dibatalkan.');
  });

  it('fokus awal di tombol Batal', () => {
    pasang();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Batal' }));
  });

  it('Escape memanggil onBatal', () => {
    const { onBatal, onSetuju } = pasang();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onBatal).toHaveBeenCalledTimes(1);
    expect(onSetuju).not.toHaveBeenCalled();
  });

  it('Tab berputar di dalam dialog (jebak fokus)', () => {
    pasang();
    const setuju = screen.getByRole('button', { name: 'Ya, hapus' });
    setuju.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    // Tombol terakhir -> kembali ke yang pertama (tombol Tutup di kepala), tetap di dalam dialog.
    expect(screen.getByRole('alertdialog').contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(setuju);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(setuju);
  });

  it('Batal dan Setuju memanggil handler masing-masing', () => {
    const { onBatal, onSetuju } = pasang();
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(onBatal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ya, hapus' }));
    expect(onSetuju).toHaveBeenCalledTimes(1);
  });

  it('memuat mengunci: Esc, tutup, Batal, dan Setuju tidak memanggil apa pun', () => {
    const { onBatal, onSetuju } = pasang({ memuat: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tutup dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ya, hapus' }));
    expect(onBatal).not.toHaveBeenCalled();
    expect(onSetuju).not.toHaveBeenCalled();
  });
});
