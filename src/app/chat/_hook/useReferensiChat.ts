'use client';

// Daftar Layanan chat dan FAQ cepat (rencana refaktor 2026-11-11 tugas 6.3). Keduanya data publik yang kelak datang dari
// server sebagai props (tugas 6.5); sampai saat itu dimuat di sini lewat lib/data/chat-pengunjung.ts.
//
// T7: gagal memuat Layanan = galat yang jelas + Coba lagi, BUKAN daftar cadangan palsu (id palsu pasti gagal saat sesi
// dibuat dan membuat pengunjung menyalahkan koneksi internetnya). S14: gagal memuat FAQ tidak boleh tampil sebagai daftar
// kosong senyap.
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { muatFaqChat, muatLayananChat, type FaqChat, type LayananChat } from '@/lib/data/chat-pengunjung';
import { urutkanFaq } from '../_logika/turunan';

export function useReferensiChat() {
  const [layanan, setLayanan] = useState<LayananChat[]>([]);
  const [memuatLayanan, setMemuatLayanan] = useState(true);
  const [galatLayanan, setGalatLayanan] = useState(false);
  // Dinaikkan tombol Coba lagi untuk memuat ulang.
  const [muatLayananKe, setMuatLayananKe] = useState(0);

  const [faq, setFaq] = useState<FaqChat[]>([]);
  const [memuatFaq, setMemuatFaq] = useState(false);
  const [galatFaq, setGalatFaq] = useState(false);

  useEffect(() => {
    let batal = false;
    async function muat() {
      try {
        const hasil = await muatLayananChat(createClient());
        if (batal) return;
        if (hasil.error) {
          setLayanan([]);
          setGalatLayanan(true);
        } else {
          setLayanan(hasil.data);
          setGalatLayanan(false);
        }
      } catch {
        if (batal) return;
        setLayanan([]);
        setGalatLayanan(true);
      } finally {
        if (!batal) setMemuatLayanan(false);
      }
    }
    void muat();
    return () => {
      batal = true;
    };
  }, [muatLayananKe]);

  const cobaLagiLayanan = () => {
    setMemuatLayanan(true);
    setMuatLayananKe((n) => n + 1);
  };

  // FAQ untuk chip "FAQ Cepat": FAQ layanan percakapan + FAQ umum. Gagal -> galatFaq (pesan + Coba lagi), tanpa cadangan.
  const muatFaq = useCallback(async (layananId: string) => {
    setMemuatFaq(true);
    try {
      const hasil = await muatFaqChat(createClient(), layananId);
      if (hasil.error) {
        setFaq([]);
        setGalatFaq(true);
      } else {
        setFaq(urutkanFaq(hasil.data, layananId));
        setGalatFaq(false);
      }
    } catch {
      setFaq([]);
      setGalatFaq(true);
    } finally {
      setMemuatFaq(false);
    }
  }, []);

  return { layanan, memuatLayanan, galatLayanan, cobaLagiLayanan, faq, memuatFaq, galatFaq, muatFaq };
}
