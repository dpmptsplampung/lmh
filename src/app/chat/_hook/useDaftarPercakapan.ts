'use client';

// Daftar percakapan pengunjung (rencana refaktor 2026-11-11 tugas 6.3): satu per Layanan, diturunkan dari chat_sesi lewat
// lib/data/chat-pengunjung.ts, beserta penanda "belum dibaca" per perangkat. Dimuat setelah login dan daftar Layanan siap,
// dimuat ulang lewat `muatUlang` (kembali dari percakapan, Coba lagi). Hasil muat PERTAMA diteruskan ke `onPertama`
// (keputusan tampilan awal); null = gagal.
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { bacaDibaca, type PercakapanRingkas } from '@/lib/chat/percakapan';
import { muatDaftarPercakapan, type LayananChat } from '@/lib/data/chat-pengunjung';

interface Opsi {
  aktif: boolean;
  pengunjungId: string | null;
  layanan: readonly LayananChat[];
  onPertama: (items: PercakapanRingkas[] | null) => void;
}

export function useDaftarPercakapan({ aktif, pengunjungId, layanan, onPertama }: Opsi) {
  const [daftar, setDaftar] = useState<PercakapanRingkas[]>([]);
  const [dibaca, setDibaca] = useState<Record<string, string | null>>({});
  const [memuat, setMemuat] = useState(false);
  const [siap, setSiap] = useState(false);
  const [galat, setGalat] = useState(false);
  const [muatKe, setMuatKe] = useState(0);
  const pertamaRef = useRef(false);
  // Pemanggil boleh memberi fungsi baru tiap render; efek muat tidak bergantung padanya.
  const onPertamaRef = useRef(onPertama);
  useEffect(() => {
    onPertamaRef.current = onPertama;
  });

  useEffect(() => {
    if (!aktif) return;
    let batal = false;
    const pertama = () => {
      if (pertamaRef.current) return false;
      pertamaRef.current = true;
      return true;
    };
    (async () => {
      setMemuat(true);
      setGalat(false);
      try {
        const h = await muatDaftarPercakapan(createClient(), { pengunjungId, layanan });
        if (batal) return;
        if (h.error) {
          setGalat(true);
          setSiap(true);
          if (pertama()) onPertamaRef.current(null);
          return;
        }
        const items = h.data;
        setDaftar(items);
        setDibaca(Object.fromEntries(items.map((i) => [i.layananId, bacaDibaca(i.layananId)])));
        setSiap(true);
        if (pertama()) onPertamaRef.current(items);
      } catch {
        if (batal) return;
        setGalat(true);
        setSiap(true);
        if (pertama()) onPertamaRef.current(null);
      } finally {
        if (!batal) setMemuat(false);
      }
    })();
    return () => {
      batal = true;
    };
  }, [aktif, muatKe, pengunjungId, layanan]);

  const muatUlang = () => setMuatKe((n) => n + 1);

  return { daftar, dibaca, memuat, siap, galat, muatUlang };
}
