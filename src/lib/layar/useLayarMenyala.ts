'use client';

import { useEffect, useState } from 'react';

/** Wake Lock bersifat upaya terbaik; layar tetap berjalan saat API tidak tersedia/ditolak. */
export function useLayarMenyala() {
  const [kursorTersembunyi, setKursorTersembunyi] = useState(false);
  useEffect(() => {
    let dilepas = false;
    let meminta = false;
    let kunci: WakeLockSentinel | null = null;
    const lepas = (lock: WakeLockSentinel | null) => {
      if (lock && !lock.released) void lock.release().catch(() => {});
    };
    const minta = async () => {
      if (dilepas || meminta || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
      if (kunci && !kunci.released) return;
      meminta = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (dilepas || document.visibilityState !== 'visible') lepas(lock);
        else kunci = lock;
      } catch {
        // Peramban dapat menolak pada mode hemat daya atau konteks tanpa izin.
      } finally {
        meminta = false;
      }
    };
    const terlihat = () => {
      if (document.visibilityState === 'visible') void minta();
      else { lepas(kunci); kunci = null; }
    };
    void minta();
    document.addEventListener('visibilitychange', terlihat);
    let timer = setTimeout(() => setKursorTersembunyi(true), 5000);
    const gerak = () => {
      setKursorTersembunyi(false);
      clearTimeout(timer);
      timer = setTimeout(() => setKursorTersembunyi(true), 5000);
    };
    window.addEventListener('mousemove', gerak, { passive: true });
    return () => {
      dilepas = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', terlihat);
      window.removeEventListener('mousemove', gerak);
      lepas(kunci);
    };
  }, []);
  return { kursorTersembunyi };
}
