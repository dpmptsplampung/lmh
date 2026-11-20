'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { kirimMinat, MinatError } from './api';
import { ISIAN_KOSONG, periksaIsian, susunBadan, type GalatIsian, type Isian, type KanalMinat } from './formulir-logika';

/**
 * State dan pengiriman formulir minat. Dipasang per pembukaan formulir (komponen induknya hanya dirender saat terbuka),
 * jadi satu `operasi_id` untuk seluruh pembukaan, termasuk setelah galat atau perubahan isian.
 */
export function useFormulirMinat(kanal: KanalMinat, refId: string) {
  const [isian, setIsian] = useState<Isian>(ISIAN_KOSONG);
  const [galatIsian, setGalatIsian] = useState<GalatIsian>({});
  const [galatUmum, setGalatUmum] = useState('');
  const [sedang, setSedang] = useState(false);
  const [berhasil, setBerhasil] = useState(false);
  /** Naik tiap submit yang ditolak pemeriksaan klien; komponen memakainya untuk memindahkan fokus ke bidang pertama yang salah. */
  const [gagalKe, setGagalKe] = useState(0);
  const [operasiId] = useState(() => crypto.randomUUID());
  const terpasang = useRef(true);
  useEffect(() => {
    terpasang.current = true;
    return () => { terpasang.current = false; };
  }, []);

  const ubah = useCallback(<K extends keyof Isian>(kunci: K, nilai: Isian[K]) => {
    setIsian(sebelumnya => ({ ...sebelumnya, [kunci]: nilai }));
    setGalatUmum('');
    setGalatIsian(sebelumnya => (sebelumnya[kunci as keyof GalatIsian] ? { ...sebelumnya, [kunci]: undefined } : sebelumnya));
  }, []);

  const kirim = useCallback(async () => {
    if (sedang) return;
    const galat = periksaIsian(isian, kanal);
    if (Object.values(galat).some(Boolean)) {
      setGalatIsian(galat);
      setGagalKe(n => n + 1);
      return;
    }
    setGalatIsian({});
    setGalatUmum('');
    setSedang(true);
    const badan = susunBadan(isian, kanal, refId);
    try {
      await kirimMinat(kanal, { ...badan, operasi_id: operasiId });
      if (terpasang.current) setBerhasil(true);
    } catch (e) {
      const galatKirim = e instanceof MinatError ? e : new MinatError('GAGAL_INTERNAL', 500);
      if (terpasang.current) setGalatUmum(galatKirim.message);
    } finally {
      if (terpasang.current) setSedang(false);
    }
  }, [sedang, isian, kanal, refId, operasiId]);

  return { isian, ubah, galatIsian, galatUmum, sedang, berhasil, gagalKe, kirim };
}
