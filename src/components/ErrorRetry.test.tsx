// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ErrorRetry from './ErrorRetry';

describe('ErrorRetry', () => {
  afterEach(() => {
    cleanup();
  });

  it('menampilkan pesan sebagai alert', () => {
    render(<ErrorRetry pesan="Layanan belum dapat dimuat" onRetry={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Layanan belum dapat dimuat');
  });

  it('menampilkan tombol "Coba lagi" yang memanggil onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorRetry pesan="Gagal" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /coba lagi/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('memakai label tombol kustom', () => {
    render(<ErrorRetry pesan="Gagal" onRetry={() => {}} labelTombol="Muat ulang" />);
    expect(screen.getByRole('button', { name: 'Muat ulang' })).toBeTruthy();
  });

  describe('saat memuat ulang (memuat)', () => {
    it('tombol nonaktif + aria-busy, label "Memuat…", klik tidak memanggil onRetry', () => {
      const onRetry = vi.fn();
      render(<ErrorRetry pesan="Gagal" onRetry={onRetry} memuat />);
      const tombol = screen.getByRole('button', { name: /memuat/i }) as HTMLButtonElement;
      expect(tombol.disabled).toBe(true);
      expect(tombol.getAttribute('aria-busy')).toBe('true');
      fireEvent.click(tombol);
      expect(onRetry).not.toHaveBeenCalled();
    });

    it('alert tidak atomik: perubahan label tombol tidak membacakan ulang seluruh pesan galat', () => {
      render(<ErrorRetry pesan="Gagal" onRetry={() => {}} memuat />);
      expect(screen.getByRole('alert').getAttribute('aria-atomic')).toBe('false');
    });

    it('tidak memuat: tombol aktif tanpa aria-busy', () => {
      render(<ErrorRetry pesan="Gagal" onRetry={() => {}} />);
      const tombol = screen.getByRole('button', { name: 'Coba lagi' }) as HTMLButtonElement;
      expect(tombol.disabled).toBe(false);
      expect(tombol.getAttribute('aria-busy')).toBeNull();
    });
  });

  it('tanpa onRetry tidak menampilkan tombol', () => {
    render(<ErrorRetry pesan="Gagal" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('menampilkan judul bila diberikan', () => {
    render(<ErrorRetry judul="Terjadi gangguan" pesan="Coba beberapa saat lagi" />);
    expect(screen.getByText('Terjadi gangguan')).toBeTruthy();
  });
});
