'use client';

// Daftar Layanan chat dan FAQ cepat (rencana refaktor 2026-11-11 tugas 6.3 dan 6.5). Keduanya data publik yang datang dari
// server sebagai data awal (page.tsx); klien memuatnya sendiri lewat lib/data/chat-pengunjung.ts HANYA bila data awal tidak
// ada atau tidak lengkap (`null`: gagal dimuat di server), sehingga muat awal tidak membuat query dari browser.
//
// T7: gagal memuat Layanan = galat yang jelas + Coba lagi, BUKAN daftar cadangan palsu (id palsu pasti gagal saat sesi
// dibuat dan membuat pengunjung menyalahkan koneksi internetnya). S14: gagal memuat FAQ tidak boleh tampil sebagai daftar
// kosong senyap.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { muatFaqChat, muatLayananChat, type FaqChat, type LayananChat } from '@/lib/data/chat-pengunjung';
import { faqUntukLayanan, type DataAwalChat } from '../_logika/dataAwal';
import { urutkanFaq } from '../_logika/turunan';

export function useReferensiChat(awal?: Partial<DataAwalChat>) {
  // Data awal dibaca sekali saat mount: berubahnya props kemudian tidak mengganti data yang sudah dipegang.
  const awalRef = useRef(awal);
  const layananAwal = awal?.layanan ?? null;
  const [layanan, setLayanan] = useState<LayananChat[]>(layananAwal ?? []);
  const [memuatLayanan, setMemuatLayanan] = useState(layananAwal === null);
  const [galatLayanan, setGalatLayanan] = useState(false);
  // Dinaikkan tombol Coba lagi untuk memuat ulang.
  const [muatLayananKe, setMuatLayananKe] = useState(0);

  const [faq, setFaq] = useState<FaqChat[]>([]);
  const [memuatFaq, setMemuatFaq] = useState(false);
  const [galatFaq, setGalatFaq] = useState(false);

  useEffect(() => {
    // Data awal dari server lengkap: tidak perlu query; muat ulang hanya lewat Coba lagi (muatLayananKe > 0).
    if (muatLayananKe === 0 && awalRef.current?.layanan) return;
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
    // FAQ aktif seluruh layanan sudah dari server: pilih yang berlaku untuk Layanan ini tanpa query.
    const faqAwal = awalRef.current?.faq;
    if (faqAwal) {
      setFaq(urutkanFaq(faqUntukLayanan(faqAwal, layananId), layananId));
      setGalatFaq(false);
      return;
    }
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
