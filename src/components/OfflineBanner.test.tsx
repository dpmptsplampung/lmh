// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const antrean = vi.hoisted(() => ({ jumlah: 0, terkirim: false }));
vi.mock('@/lib/hooks/useAntreanOffline', async () => {
  const asli = await vi.importActual<typeof import('@/lib/hooks/useAntreanOffline')>('@/lib/hooks/useAntreanOffline');
  return { ...asli, useAntreanOffline: () => antrean };
});

import OfflineBanner from './OfflineBanner';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
}

function bannerIsPresent(): boolean {
  return screen.queryAllByText(/Anda sedang offline/i).length > 0;
}

describe('I9.4 OfflineBanner component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    antrean.jumlah = 0;
    antrean.terkirim = false;
    setOnline(true);
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    cleanup();
  });

  it('does not render when online', () => {
    setOnline(true);
    render(<OfflineBanner />);
    expect(bannerIsPresent()).toBe(false);
  });

  it('renders banner when offline', () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(bannerIsPresent()).toBe(true);
  });

  it('hides when dismissed (via X button)', () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(bannerIsPresent()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /tutup pemberitahuan offline/i }));
    expect(bannerIsPresent()).toBe(false);
  });

  it('stays dismissed within the same session', () => {
    setOnline(false);
    sessionStorage.setItem('lmh-offline-banner-dismissed', '1');
    render(<OfflineBanner />);
    expect(bannerIsPresent()).toBe(false);
  });

  it('shows banner when going offline via event', async () => {
    setOnline(true);
    render(<OfflineBanner />);
    expect(bannerIsPresent()).toBe(false);

    setOnline(false);
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => {
      expect(bannerIsPresent()).toBe(true);
    });
  });

  it('hides banner when going back online via event', async () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(bannerIsPresent()).toBe(true);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => {
      expect(bannerIsPresent()).toBe(false);
    });
  });
});

describe('A10 penghitung offline di banner', () => {
  beforeEach(() => {
    antrean.jumlah = 0;
    antrean.terkirim = false;
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  });
  afterEach(() => {
    cleanup();
  });

  it('offline dengan antrean: jumlah pendaftaran menunggu ikut tampil', () => {
    setOnline(false);
    antrean.jumlah = 2;
    render(<OfflineBanner />);
    expect(screen.getByText(/2 pendaftaran menunggu dikirim/)).toBeInTheDocument();
    expect(bannerIsPresent()).toBe(true);
  });

  it('offline tanpa antrean: tidak ada teks jumlah', () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(screen.queryByText(/menunggu dikirim/)).toBeNull();
  });

  it('online tetapi masih ada antrean: tetap diberi tahu (status, bukan peringatan offline)', () => {
    setOnline(true);
    antrean.jumlah = 1;
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('1 pendaftaran menunggu dikirim');
    expect(bannerIsPresent()).toBe(false);
  });

  it('banner offline yang ditutup tidak menyembunyikan antrean yang menunggu setelah online', () => {
    setOnline(false);
    antrean.jumlah = 3;
    render(<OfflineBanner />);
    fireEvent.click(screen.getByRole('button', { name: /Tutup pemberitahuan offline/ }));
    expect(bannerIsPresent()).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('3 pendaftaran menunggu dikirim');
  });

  it('sesudah replay: Terkirim', () => {
    setOnline(true);
    antrean.terkirim = true;
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Terkirim/);
  });

  it('menulis tinggi banner ke variabel CSS (agar AppBar/sidebar fixed bergeser) dan membersihkannya', () => {
    setOnline(false);
    const { unmount } = render(<OfflineBanner />);
    expect(document.documentElement.style.getPropertyValue('--tinggi-banner-offline')).toBe('0px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--tinggi-banner-offline')).toBe('');
  });
});
