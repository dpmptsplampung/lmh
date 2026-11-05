'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function berlangganan(panggil: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener?.('change', panggil);
  return () => mq.removeEventListener?.('change', panggil);
}

function ambil(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

/** true bila pengguna meminta gerak dikurangi; dipakai untuk mematikan animasi grafik. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(berlangganan, ambil, () => false);
}
