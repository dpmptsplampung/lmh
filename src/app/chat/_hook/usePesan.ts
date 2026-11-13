'use client';

// Pesan percakapan aktif (rencana refaktor 2026-11-11 tugas 6.3): daftar pesan, riwayat lintas sesi (awal + halaman lebih
// lama), dan sinkronisasi sesi berjalan lewat satu channel Realtime `chat-sesi-<id>` (INSERT chat_pesan + UPDATE status
// chat_sesi) dengan catch-up saat SUBSCRIBED dan polling cadangan (merge.ts). Channel tetap per sesi dengan payload:
// pusat Realtime staf (lib/realtime/pusat.ts) hanya untuk tabel tanpa filter baris.
//
// Penjaga respons basi:
// - Riwayat (C2-07): tiap muat riwayat awal memegang nomor + AbortController sendiri; respons yang bukan milik percakapan
//   aktif dibuang. "Muat pesan sebelumnya" memakai nomor yang sedang aktif (tidak menaikkannya).
// - Sinkronisasi (R4): respons hanya berlaku bila nomor sinkron, generasi percakapan, dan sesi masih sama.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { PercakapanRingkas } from '@/lib/chat/percakapan';
import { muatRiwayatChat, sinkronPesanChat } from '@/lib/data/chat-pengunjung';
import { mergeMessages, rtFromStatus, useFallbackPoll, useOnSubscribed, type ChatMsg, type RtState } from '../merge';
import type { StatusSesi } from '../_logika/mesinChat';
import type { MesinChat } from './useMesinChat';

export type GalatRiwayat = 'awal' | 'lama' | null;

export function usePesan({ keadaan, ref: mesinRef, kirim }: MesinChat) {
  const { sesiId, status, tampilan } = keadaan;
  const [pesan, setPesan] = useState<ChatMsg[]>([]);
  const [adaLebih, setAdaLebih] = useState(false);
  const [memuatRiwayat, setMemuatRiwayat] = useState(false);
  // C2-02: gagal memuat riwayat awal / pesan sebelumnya tampil sebagai galat + Coba lagi (bukan senyap).
  const [galatRiwayat, setGalatRiwayat] = useState<GalatRiwayat>(null);
  const tokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const awalRef = useRef<PercakapanRingkas | null>(null);
  const seqRef = useRef(0);
  const [rt, setRt] = useState<RtState>('connecting');

  // ----- Operasi daftar pesan (dipakai useSesiChat dan useKirim) -----
  const gabung = useCallback((masuk: ChatMsg[]) => setPesan((prev) => mergeMessages(prev, masuk)), []);
  const tambah = useCallback((m: ChatMsg) => setPesan((prev) => [...prev, m]), []);
  const tandai = useCallback(
    (id: string, local: ChatMsg['local']) => setPesan((prev) => prev.map((m) => (m.id === id ? { ...m, local } : m))),
    [],
  );
  const buangSementara = useCallback(() => setPesan((prev) => prev.filter((m) => !m.transient)), []);
  /** Mengganti seluruh utas (percakapan dibuka: kosong; sesi baru: sambutan). */
  const ganti = useCallback((awal: ChatMsg[]) => {
    setPesan(awal);
    setAdaLebih(false);
  }, []);

  // ----- Riwayat -----
  const muatRiwayatAwal = useCallback(
    async (p: PercakapanRingkas) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const token = ++tokenRef.current;
      awalRef.current = p;
      setGalatRiwayat(null);
      setMemuatRiwayat(true);
      try {
        const h = await muatRiwayatChat({ sesiId: p.sesiTerakhirId, signal: ac.signal });
        if (token !== tokenRef.current) return;
        if (h.error) {
          setGalatRiwayat('awal');
          return;
        }
        gabung(h.data.messages);
        setAdaLebih(h.data.adaLebih);
        if (h.data.status && p.sesiTerbukaId) kirim({ jenis: 'status', status: h.data.status });
      } finally {
        if (token === tokenRef.current) setMemuatRiwayat(false);
      }
    },
    [gabung, kirim],
  );

  /** `cadangan` = sesi terakhir percakapan dari daftar, dipakai bila tidak ada sesi terbuka. */
  const muatLebihLama = async (cadangan?: string) => {
    const anchor = mesinRef.current.sesiId ?? cadangan;
    const tertua = pesan.find((m) => !m.local)?.created_at;
    if (!anchor || !tertua || memuatRiwayat) return;
    const token = tokenRef.current;
    setGalatRiwayat(null);
    setMemuatRiwayat(true);
    try {
      const h = await muatRiwayatChat({ sesiId: anchor, sebelum: tertua, signal: abortRef.current?.signal });
      if (token !== tokenRef.current) return;
      if (h.error) {
        setGalatRiwayat('lama');
        return;
      }
      gabung(h.data.messages);
      setAdaLebih(h.data.adaLebih);
    } finally {
      if (token === tokenRef.current) setMemuatRiwayat(false);
    }
  };

  const cobaLagiRiwayat = (cadangan?: string) => {
    if (galatRiwayat === 'awal') {
      if (awalRef.current) void muatRiwayatAwal(awalRef.current);
    } else {
      void muatLebihLama(cadangan);
    }
  };

  /** Percakapan ditinggalkan: batalkan riwayat yang masih berjalan dan buang responsnya. */
  const tinggalkan = () => {
    tokenRef.current++;
    abortRef.current?.abort();
    setMemuatRiwayat(false);
    setGalatRiwayat(null);
  };

  // ----- Sinkronisasi sesi berjalan -----
  const sinkron = useCallback(async () => {
    if (!sesiId) return;
    const seq = ++seqRef.current;
    const generasi = mesinRef.current.generasi;
    const h = await sinkronPesanChat(sesiId);
    const masihAktif =
      seq === seqRef.current && generasi === mesinRef.current.generasi && mesinRef.current.sesiId === sesiId;
    if (!masihAktif || h.error) return; // respons usang / jaringan putus: sinkron berikutnya mencoba lagi
    if (h.data.messages) gabung(h.data.messages);
    if (h.data.status) kirim({ jenis: 'status', status: h.data.status, sesiId });
  }, [sesiId, gabung, kirim, mesinRef]);

  useEffect(() => {
    if (!sesiId) return;
    const sb = createClient();
    let aktif = true;
    const channel = sb
      .channel(`chat-sesi-${sesiId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_pesan', filter: `sesi_id=eq.${sesiId}` },
        (payload) => {
          const baru = payload.new as ChatMsg & { sesi_id?: string };
          if (baru.sesi_id && baru.sesi_id !== mesinRef.current.sesiId) return; // R4: bukan percakapan aktif
          gabung([baru]);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_sesi', filter: `id=eq.${sesiId}` },
        (payload) => {
          const baru = payload.new as { id?: string; status: StatusSesi };
          if (baru.id && baru.id !== mesinRef.current.sesiId) return; // R4: bukan percakapan aktif
          kirim({ jenis: 'status', status: baru.status });
        },
      )
      .subscribe((s) => {
        if (aktif) setRt(rtFromStatus(s));
      });
    return () => {
      aktif = false;
      sb.removeChannel(channel);
    };
  }, [sesiId, gabung, kirim, mesinRef]);

  const live = !!sesiId && status !== 'selesai' && tampilan === 'percakapan';
  // Catch-up saat channel SUBSCRIBED (awal & reconnect); poll hanya cadangan.
  useOnSubscribed(rt, sinkron, live);
  useFallbackPoll(sinkron, rt, { fastMs: 5000, slowMs: 30000, enabled: live });
  useEffect(() => {
    if (sesiId && rt !== 'ok') {
      const t = setTimeout(sinkron, 0); // muat awal bila realtime belum tersambung
      return () => clearTimeout(t);
    }
  }, [sesiId, rt, sinkron]);

  return {
    pesan,
    adaLebih,
    memuatRiwayat,
    galatRiwayat,
    gabung,
    tambah,
    tandai,
    buangSementara,
    ganti,
    muatRiwayatAwal,
    muatLebihLama,
    cobaLagiRiwayat,
    tinggalkan,
    sinkron,
  };
}

export type PesanChat = ReturnType<typeof usePesan>;
