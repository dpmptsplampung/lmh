'use client';

// Penghitung antrean offline Front Office (A10): jumlah item milik akun yang masuk di antrean IndexedDB
// (lib/offline/queue.ts, hanya dibaca) dan penanda "Terkirim" sesudah replay (OfflineReplayer menyiarkan
// EVENT_REPLAY_OFFLINE). Tidak ada kueri jaringan; pembacaan lokal tiap beberapa detik karena pendaftaran
// offline ditulis oleh komponen lain tanpa siaran.
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getPending } from '@/lib/offline/queue';

export const EVENT_REPLAY_OFFLINE = 'lmh:replay-offline';

export interface DetailReplayOffline {
  synced: number;
  failed: number;
}

/** Dipanggil OfflineReplayer sesudah tiap putaran replay. */
export function siarkanReplayOffline(detail: DetailReplayOffline): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT_REPLAY_OFFLINE, { detail }));
}

const POLL_MS = 5_000;
const TERKIRIM_MS = 6_000;

/** "1 pendaftaran menunggu dikirim"; null bila tidak ada. */
export function teksAntreanOffline(jumlah: number): string | null {
  return jumlah > 0 ? `${jumlah} pendaftaran menunggu dikirim` : null;
}

export interface AntreanOffline {
  jumlah: number;
  /** true sesaat sesudah replay mengirim semua yang menunggu. */
  terkirim: boolean;
}

export function useAntreanOffline(aktif = true): AntreanOffline {
  const [jumlah, setJumlah] = useState(0);
  const [terkirim, setTerkirim] = useState(false);
  const uid = useRef<string | null>(null);

  useEffect(() => {
    if (!aktif) return;
    let batal = false;
    let timerTerkirim: ReturnType<typeof setTimeout> | undefined;

    async function bacaUid(): Promise<string | null> {
      if (uid.current) return uid.current;
      try {
        const { data } = await createClient().auth.getSession();
        uid.current = data.session?.user.id ?? null;
      } catch {
        uid.current = null;
      }
      return uid.current;
    }

    async function segarkan(): Promise<number> {
      const id = await bacaUid();
      if (!id) return 0;
      try {
        const n = (await getPending(id)).length;
        if (!batal) setJumlah(n);
        return n;
      } catch {
        return 0;
      }
    }

    void segarkan();
    const poll = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void segarkan();
    }, POLL_MS);

    const saatReplay = (e: Event) => {
      const detail = (e as CustomEvent<DetailReplayOffline>).detail;
      void segarkan().then((sisa) => {
        if (batal || !detail || detail.synced <= 0 || sisa > 0) return;
        setTerkirim(true);
        clearTimeout(timerTerkirim);
        timerTerkirim = setTimeout(() => setTerkirim(false), TERKIRIM_MS);
      });
    };
    const saatJaringan = () => void segarkan();
    window.addEventListener(EVENT_REPLAY_OFFLINE, saatReplay);
    window.addEventListener('online', saatJaringan);
    window.addEventListener('offline', saatJaringan);

    return () => {
      batal = true;
      clearInterval(poll);
      clearTimeout(timerTerkirim);
      window.removeEventListener(EVENT_REPLAY_OFFLINE, saatReplay);
      window.removeEventListener('online', saatJaringan);
      window.removeEventListener('offline', saatJaringan);
    };
  }, [aktif]);

  // Antrean baru muncul lagi sesudah "Terkirim": penanda terkirim tidak boleh menutupi hitungan.
  return { jumlah, terkirim: terkirim && jumlah === 0 };
}
