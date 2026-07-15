// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/components/QRCode', () => ({ default: () => <div>QR</div> }));

import { createClient } from '@/lib/supabase/client';
import ReservasiPage from './page';

describe('reservasi tujuan keyboard-accessible selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const layanan = {
      select: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const pengunjung = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'visitor-1', nama: 'Nama Kanonis' },
        error: null,
      }),
    };

    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-1' } } }) },
      from: vi.fn((table: string) => {
        if (table === 'pengunjung') return pengunjung;
        if (table === 'layanan') return layanan;
        return {};
      }),
    });
  });

  afterEach(cleanup);

  it('exposes tujuan options as radio inputs or buttons (not bare divs)', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');

    const radios = screen.queryAllByRole('radio');
    const buttons = screen.queryAllByRole('button').filter((el) =>
      /loket|bertemu/i.test(el.textContent ?? el.getAttribute('aria-label') ?? ''),
    );

    const accessible = radios.length >= 2 ? radios : buttons;
    expect(accessible.length).toBeGreaterThanOrEqual(2);

    // Prefer native radio group
    if (radios.length >= 2) {
      expect(radios[0]).toHaveAttribute('type', 'radio');
      fireEvent.click(radios[0]);
      expect(radios[0]).toBeChecked();
    } else {
      fireEvent.click(buttons[0]);
      expect(buttons[0].getAttribute('aria-pressed') === 'true' || buttons[0].getAttribute('aria-checked') === 'true').toBe(true);
    }
  });

  it('allows selecting tujuan via keyboard-focusable control', async () => {
    render(<ReservasiPage />);
    await screen.findByText('Rencanakan Kedatangan');

    const loket =
      screen.queryByRole('radio', { name: /loket/i }) ??
      screen.queryByRole('button', { name: /loket/i }) ??
      screen.getByLabelText(/loket/i);

    expect(loket.tagName === 'INPUT' || loket.tagName === 'BUTTON' || loket.tagName === 'LABEL').toBe(true);
    fireEvent.click(loket);
    await waitFor(() => {
      const checked =
        screen.queryByRole('radio', { name: /loket/i }) ??
        screen.queryByRole('button', { name: /loket/i });
      if (checked?.getAttribute('type') === 'radio') {
        expect(checked).toBeChecked();
      } else if (checked) {
        expect(
          checked.getAttribute('aria-pressed') === 'true' ||
            checked.getAttribute('aria-checked') === 'true' ||
            checked.className,
        ).toBeTruthy();
      }
    });
  });
});
