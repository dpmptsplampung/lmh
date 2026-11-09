'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Tombol from '@/components/ui/Tombol';
import { kirimTugas, TugasError } from './api';

// Nomor mentah hanya ada pada node ini, bukan state React atau penyimpanan browser.
export default function NomorTugas({ id }: { id: string }) {
  const node = useRef<HTMLSpanElement>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [error, setError] = useState('');

  useLayoutEffect(() => {
    mounted.current = true;
    const target = node.current;
    const clear = () => {
      request.current?.abort();
      if (target) target.textContent = '';
      setShown(false);
      setBusy(false);
    };
    const hidden = () => { if (document.visibilityState === 'hidden') clear(); };
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false;
      request.current?.abort();
      if (target) target.textContent = '';
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [id]);

  const reveal = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await kirimTugas<{ nomor: string | null }>(`/${id}/kontak`, {}, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (node.current) node.current.textContent = result.nomor ?? 'Nomor belum tersedia';
      setShown(true);
    } catch (e) {
      if (mounted.current && !controller.signal.aborted) setError(e instanceof TugasError ? e.message : 'Nomor belum berhasil dimuat. Coba lagi.');
    } finally {
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  };

  return <div>
    <span ref={node} aria-live="polite" />
    {shown
      ? <Tombol varian="hantu" onClick={() => { if (node.current) node.current.textContent = ''; setShown(false); }}>Tutup nomor</Tombol>
      : <Tombol varian="sekunder" memuat={busy} onClick={reveal}>Lihat nomor</Tombol>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
