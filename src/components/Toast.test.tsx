// @vitest-environment jsdom
import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
