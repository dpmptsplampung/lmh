// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
