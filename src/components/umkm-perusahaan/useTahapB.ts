'use client';

import { useCallback, useEffect, useState } from 'react';
import { ambil } from './api';
import type { Perusahaan, SesiPerusahaan } from './types';

export type KeadaanTahapB = { fase: 'memuat' | 'tidak' | 'ya' } & SesiPerusahaan;

// Tahap B aktif bila route perusahaan menjawab dengan bentuk yang benar. Galat apa pun (503, jaringan,
// bentuk tak dikenal) dianggap belum aktif, sehingga profil tampil seperti tahap A.
export function useTahapB() {
  const [keadaan, setKeadaan] = useState<KeadaanTahapB>({ fase: 'memuat', masuk: false, perusahaan: null });
  useEffect(() => {
    const controller = new AbortController();
    void ambil<SesiPerusahaan>('/perusahaan', controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      if (data && typeof data.masuk === 'boolean') {
        setKeadaan({ fase: 'ya', masuk: data.masuk, perusahaan: data.perusahaan ?? null });
      } else setKeadaan({ fase: 'tidak', masuk: false, perusahaan: null });
    }).catch(() => {
      if (!controller.signal.aborted) setKeadaan({ fase: 'tidak', masuk: false, perusahaan: null });
    });
    return () => controller.abort();
  }, []);
  const setPerusahaan = useCallback((perusahaan: Perusahaan) => {
    setKeadaan((sebelumnya) => ({ ...sebelumnya, masuk: true, perusahaan }));
  }, []);
  return { ...keadaan, setPerusahaan };
}
