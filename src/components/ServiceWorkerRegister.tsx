'use client';

import { useEffect } from 'react';
import { daftarkanServiceWorker } from '@/lib/offline/registrasi';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      void daftarkanServiceWorker().catch(() => {
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
