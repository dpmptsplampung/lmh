'use client';

import { useEffect, useState } from 'react';
import { isChunkError, pulihkanDariErrorChunk } from '@/lib/chunk-recovery';

/** Menangkap error chunk/modul akibat version skew: reload otomatis bila aman, selain itu banner. */
export default function ChunkErrorRecovery() {
  const [banner, setBanner] = useState(false);

  useEffect(() => {
    const tangani = (sumber: unknown) => {
      if (!isChunkError(sumber)) return;
      if (pulihkanDariErrorChunk() === 'banner') setBanner(true);
    };
    const onError = (e: ErrorEvent) => tangani(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => tangani(e.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (!banner) return null;
  return (
    <div
      role="alert"
      style={{
        position: 'fixed', bottom: 16, left: 16, right: 16, zIndex: 9999, display: 'flex', gap: 12,
        alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 8,
        background: '#1f2937', color: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,.3)',
      }}
    >
      <span>Versi baru tersedia. Muat ulang agar halaman berjalan normal.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ padding: '6px 14px', borderRadius: 6, border: 0, background: '#fff', color: '#1f2937', fontWeight: 600, cursor: 'pointer' }}
      >
        Muat ulang
      </button>
    </div>
  );
}
