// @vitest-environment jsdom
import { cleanup, render, screen, act, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function Trigger({ message, type }: { message: string; type?: 'success' | 'error' | 'warning' | 'info' }) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(message, type)}>
      show
    </button>
  );
}

describe('Toast live region a11y', () => {
  afterEach(cleanup);

  it('announces success/info with polite live region', () => {
    render(
      <ToastProvider>
        <Trigger message="Berhasil disimpan" type="success" />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'show' }).click();
    });

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.textContent).toContain('Berhasil disimpan');
  });

  it('announces error with assertive live region', () => {
    render(
      <ToastProvider>
        <Trigger message="Gagal menyimpan" type="error" />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'show' }).click();
    });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert.textContent).toContain('Gagal menyimpan');
  });

  it('close control has Indonesian label and min 44px touch target', () => {
    render(
      <ToastProvider>
        <Trigger message="Info" type="info" />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'show' }).click();
    });

    const closeBtn = screen.getByRole('button', { name: /tutup/i });
    expect(closeBtn.getAttribute('aria-label')).toMatch(/tutup/i);
    const style = closeBtn.getAttribute('style') ?? '';
    expect(style).toMatch(/min-width:\s*44px/i);
    expect(style).toMatch(/min-height:\s*44px/i);
  });
});

describe('Toast durasi dan penutupan (A8)', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const pasang = (type: 'success' | 'error' | 'warning' | 'info', message = 'Pesan') => {
    render(
      <ToastProvider>
        <Trigger message={message} type={type} />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: 'show' }).click();
    });
  };

  it.each(['success', 'info', 'warning'] as const)('toast %s hilang sendiri setelah 4 detik', (type) => {
    vi.useFakeTimers();
    pasang(type);
    expect(screen.getByText('Pesan')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(screen.getByText('Pesan')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.queryByText('Pesan')).toBeNull();
  });

  it('toast galat TIDAK hilang otomatis', () => {
    vi.useFakeTimers();
    pasang('error', 'Gagal memanggil OS-014');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Gagal memanggil OS-014');
  });

  it('galat ditutup lewat tombol tutup yang bisa difokus', () => {
    pasang('error', 'Gagal');
    const tutup = screen.getByRole('button', { name: 'Tutup notifikasi' });
    tutup.focus();
    expect(tutup).toHaveFocus();
    expect(tutup.tabIndex).toBe(0);
    fireEvent.click(tutup);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Esc pada tombol tutup menutup toast', () => {
    pasang('error', 'Gagal');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Tutup notifikasi' }), { key: 'Escape' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('galat identik tidak ditumpuk, galat berbeda tetap tampil bersama', () => {
    render(
      <ToastProvider>
        <Trigger message="Gagal A" type="error" />
        <Trigger message="Gagal B" type="error" />
      </ToastProvider>,
    );
    const [a, b] = screen.getAllByRole('button', { name: 'show' });
    act(() => {
      a.click();
      a.click();
      b.click();
    });
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });

  it('timer ditunda saat disorot dan berjalan lagi setelah dilepas', () => {
    vi.useFakeTimers();
    pasang('success');
    const kartu = screen.getByRole('status');
    act(() => {
      kartu.dispatchEvent(new MouseEvent('mouseenter'));
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('Pesan')).toBeInTheDocument();
    act(() => {
      kartu.dispatchEvent(new MouseEvent('mouseleave'));
    });
    act(() => {
      vi.advanceTimersByTime(4001);
    });
    expect(screen.queryByText('Pesan')).toBeNull();
  });

  it('memberi kait gaya data-toast pada wadah dan kartu (untuk tema)', () => {
    pasang('warning');
    expect(screen.getByRole('status').getAttribute('data-toast')).toBe('kartu');
    expect(screen.getByRole('status').getAttribute('data-varian')).toBe('warning');
    expect(document.querySelector('[data-toast="wadah"]')).not.toBeNull();
  });

  it('toast baru tidak mengulang timer toast lama', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger message="Pertama" type="success" />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole('button', { name: 'show' }).click();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => {
      screen.getByRole('button', { name: 'show' }).click();
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // toast pertama (3000+1500 > 4000) sudah hilang, yang kedua (1500) masih ada
    expect(screen.getAllByText('Pertama')).toHaveLength(1);
  });
});
