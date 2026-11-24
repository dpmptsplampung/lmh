'use client';

import { useEffect, useMemo, useState } from 'react';
import { kelompokkanTautan, uraiBerkasTautan, type TautanTampil } from './dokumen-logika';
import type { TautanHalaman } from '@/lib/investasi/tautan';

const TANPA_TAUTAN = new Map<number, TautanTampil[]>();

/**
 * Ambil tautan dokumen sekali per dokumen. Gagal (jaringan, 404, 500, bentuk salah) = tanpa tautan:
 * pembacaan tidak pernah terganggu. Permintaan dibatalkan saat penampil ditutup.
 */
export function useTautanDokumen(dokumenId: string, jumlahHalaman: number): Map<number, TautanTampil[]> {
  const [mentah, setMentah] = useState<TautanHalaman[]>([]);
  const siap = jumlahHalaman > 0;

  useEffect(() => {
    if (!siap || typeof fetch !== 'function') return;
    const pembatal = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/investment-docs/links?doc_id=${encodeURIComponent(dokumenId)}`, { signal: pembatal.signal });
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (!pembatal.signal.aborted) setMentah(uraiBerkasTautan(data));
      } catch {
        // tanpa tautan
      }
    })();
    return () => pembatal.abort();
  }, [dokumenId, siap]);

  return useMemo(() => (mentah.length === 0 ? TANPA_TAUTAN : kelompokkanTautan(mentah, jumlahHalaman)), [mentah, jumlahHalaman]);
}
