'use client';

// Panel detail satu pesan: memuat detail (PII hanya di sini) dan mengubah status dengan `versi` (kunci optimis).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { minatById, type MinatDetail } from '@/lib/data/investasi';
import { bacaGalatUbahStatus, type StatusMinat } from '../KotakMasukLogika';

export type HasilUbahStatus = { status: string; versi: number };

export function useDetailMinat(id: string | null, saatBerubah: (id: string, hasil: HasilUbahStatus) => void) {
  const [detail, setDetail] = useState<MinatDetail | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [galatMuat, setGalatMuat] = useState('');
  const [menyimpan, setMenyimpan] = useState(false);
  const [galatSimpan, setGalatSimpan] = useState('');
  const [konflik, setKonflik] = useState(false);
  const [berhasil, setBerhasil] = useState('');
  const urutan = useRef(0);

  const muat = useCallback(async () => {
    const saya = ++urutan.current;
    if (!id) return;
    setMemuat(true);
    setGalatMuat('');
    setGalatSimpan('');
    setKonflik(false);
    setBerhasil('');
    try {
      const { data, error } = await minatById(createClient(), id);
      if (saya !== urutan.current) return;
      if (error) throw new Error(error.message);
      if (!data) { setDetail(null); setGalatMuat('Pesan tidak ditemukan atau bukan lagi wewenang Anda.'); return; }
      setDetail(data);
    } catch {
      if (saya !== urutan.current) return;
      setDetail(null);
      setGalatMuat('Detail pesan belum dapat dimuat.');
    } finally {
      if (saya === urutan.current) setMemuat(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    void muat();
  }, [muat]);

  const simpanStatus = useCallback(async (status: StatusMinat) => {
    if (!detail) return;
    setMenyimpan(true);
    setGalatSimpan('');
    setKonflik(false);
    setBerhasil('');
    try {
      const res = await fetch(`/api/investasi/lead/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, versi: detail.versi }),
      });
      const badan: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const galat = bacaGalatUbahStatus(badan, res.status);
        setGalatSimpan(galat.pesan);
        setKonflik(galat.konflik);
        return;
      }
      const hasil = (badan as { data?: { status?: unknown; versi?: unknown } } | null)?.data;
      if (typeof hasil?.status !== 'string' || typeof hasil.versi !== 'number') {
        setGalatSimpan('Status belum dapat diperbarui. Silakan coba kembali.');
        return;
      }
      setDetail((lama) => (lama ? { ...lama, status: hasil.status as string, versi: hasil.versi as number } : lama));
      setBerhasil('Status diperbarui.');
      saatBerubah(detail.id, { status: hasil.status, versi: hasil.versi });
    } catch {
      setGalatSimpan('Status belum dapat diperbarui. Periksa sambungan, lalu coba kembali.');
    } finally {
      setMenyimpan(false);
    }
  }, [detail, saatBerubah]);

  return { detail, memuat, galatMuat, menyimpan, galatSimpan, konflik, berhasil, simpanStatus, muatUlang: muat };
}
