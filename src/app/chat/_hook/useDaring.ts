'use client';

// Status daring browser (rencana refaktor 2026-11-11 tugas 6.3). Pesan TIDAK boleh disimpan ke sesi palsu saat offline:
// halaman menampilkan banner jujur dan menonaktifkan input.
//
// useSyncExternalStore: snapshot server = true (deterministik). Node >=21 punya `navigator` global tanpa `onLine`;
// membacanya saat render membuat SSR merender banner offline dan memicu hydration mismatch.
import { useSyncExternalStore } from 'react';

function langganDaring(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
// navigator.onLine bisa undefined di Node; anggap online kecuali eksplisit false.
const bacaDaring = () => navigator.onLine !== false;

export function useDaring(): boolean {
  return useSyncExternalStore(langganDaring, bacaDaring, () => true);
}
