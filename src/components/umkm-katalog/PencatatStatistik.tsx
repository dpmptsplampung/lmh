'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProfilPublik } from '@/lib/umkm-katalog/types';
import { katalogRequest } from './api';

export default function PencatatStatistik({ id, aktif, jenis }: {
  id: string; aktif: boolean; jenis: 'dilihat' | 'klik_formulir';
}) {
  const sent = useRef(false);
  useEffect(() => {
    if (!aktif) return;
    const send = () => {
      if (sent.current || document.visibilityState !== 'visible') return;
      sent.current = true;
      const body = JSON.stringify({ jenis, profil_id: id });
      try {
        if (typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon('/api/umkm-katalog/statistik', new Blob([body], { type: 'application/json' }));
        } else {
          void fetch('/api/umkm-katalog/statistik', {
            method: 'POST', credentials: 'same-origin', keepalive: true,
            headers: { 'Content-Type': 'application/json' }, body,
          }).catch(() => {});
        }
      } catch { /* Statistik tidak boleh mengganggu layar. */ }
    };
    send();
    document.addEventListener('visibilitychange', send);
    return () => document.removeEventListener('visibilitychange', send);
  }, [id, aktif, jenis]);
  return null;
}

export function PencatatFormulir({ id, aktif }: { id: string; aktif?: boolean }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (aktif !== undefined) return;
    const controller = new AbortController();
    void katalogRequest<ProfilPublik>(`/${id}`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setEnabled(value.telemetri_opsional_aktif); })
      .catch(() => {});
    return () => controller.abort();
  }, [id, aktif]);
  return <PencatatStatistik id={id} aktif={aktif ?? enabled} jenis="klik_formulir" />;
}
