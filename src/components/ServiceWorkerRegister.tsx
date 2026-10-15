'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      // ?v=<build id>: URL skrip berubah tiap rilis -> SW baru terpasang & cache lama dibuang.
      const build = encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev');
      navigator.serviceWorker.register(`/sw.js?v=${build}`).catch(() => {
        // non-fatal — offline support unavailable
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register);
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
