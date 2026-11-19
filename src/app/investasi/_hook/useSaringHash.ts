'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { adaSaringan, SARINGAN_KOSONG, susunHash, uraiHash, type Saringan } from '../_logika/saring';

const langgan = (panggil: () => void) => {
  window.addEventListener('hashchange', panggil);
  return () => window.removeEventListener('hashchange', panggil);
};
const hashSekarang = () => window.location.hash;
const hashServer = () => '';

/**
 * Saringan hub yang disinkronkan ke hash URL (`#sektor=energi`), jadi halaman tetap statis (ISR) dan tautan bisa dibagikan.
 * Perubahan lewat tautan `<a href="#sektor=...">` (Peta Potensi) ikut tertangkap lewat `hashchange`.
 */
export function useSaringHash(): { saringan: Saringan; ubah: (berikutnya: Saringan) => void; atur: (kunci: keyof Saringan, nilai: string) => void; reset: () => void } {
  const hash = useSyncExternalStore(langgan, hashSekarang, hashServer);
  const saringan = useMemo(() => (hash ? uraiHash(hash) : SARINGAN_KOSONG), [hash]);

  const ubah = useCallback((berikutnya: Saringan) => {
    const url = `${window.location.pathname}${window.location.search}${adaSaringan(berikutnya) ? susunHash(berikutnya) : ''}`;
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);
  const atur = useCallback((kunci: keyof Saringan, nilai: string) => ubah({ ...uraiHash(window.location.hash), [kunci]: nilai }), [ubah]);
  const reset = useCallback(() => ubah(SARINGAN_KOSONG), [ubah]);
  return { saringan, ubah, atur, reset };
}
