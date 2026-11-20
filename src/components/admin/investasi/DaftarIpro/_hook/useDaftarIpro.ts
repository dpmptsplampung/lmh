'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { daftarIproKelola, type IproAdmin } from '@/lib/data/investasi';
import { SARINGAN_AWAL, bangunOpsi, type SaringanIpro } from '../_logika/daftar';

type Hasil = { kunci: string; baris: IproAdmin[]; total: number; galat: boolean };

// Daftar IPRO untuk pengelola: saringan, pencarian tertunda 300 ms, dan penomoran halaman. Tanpa JSX.
export function useDaftarIpro() {
  const sb = useMemo(() => createClient(), []);
  const [saringan, setSaringan] = useState<SaringanIpro>(SARINGAN_AWAL);
  const [cariTerapan, setCariTerapan] = useState('');
  const [halaman, setHalaman] = useState(1);
  const [ulang, setUlang] = useState(0);
  const [hasil, setHasil] = useState<Hasil | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => { setCariTerapan(saringan.cari); setHalaman(1); }, 300);
    return () => window.clearTimeout(t);
  }, [saringan.cari]);

  const { status, sumber } = saringan;
  const opsi = useMemo(() => bangunOpsi({ status, sumber, cari: cariTerapan }, halaman), [status, sumber, cariTerapan, halaman]);
  const kunci = `${JSON.stringify(opsi)}#${ulang}`;

  useEffect(() => {
    let batal = false;
    void daftarIproKelola(sb, opsi).then((r) => {
      if (batal) return;
      setHasil({ kunci, baris: r.data ?? [], total: r.count ?? r.data?.length ?? 0, galat: !!r.error });
    });
    return () => { batal = true; };
  }, [sb, opsi, kunci]);

  const ubah = useCallback((bagian: Partial<SaringanIpro>) => {
    setSaringan((s) => ({ ...s, ...bagian }));
    if (!('cari' in bagian)) setHalaman(1);
  }, []);

  return {
    saringan, ubah, halaman, setHalaman, coba: () => setUlang((n) => n + 1),
    memuat: hasil?.kunci !== kunci, baris: hasil?.baris ?? [], total: hasil?.total ?? 0, galat: !!hasil?.galat && hasil.kunci === kunci,
  };
}
