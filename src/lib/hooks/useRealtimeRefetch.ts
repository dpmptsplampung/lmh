'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

// Pola bersama Fase 3: refetch dipicu event realtime (jalur utama) dengan
// debounce, polling cadangan (jalur aman bila realtime terhenti), dan
// AbortController agar fetch lama tidak menimpa data baru.
export function useRealtimeRefetch(
  refetch: () => Promise<void>,
  opts: {
    topic?: string;           // topik broadcast_changes (mis. 'antrean:publik')
    table?: string;           // tabel postgres_changes (staf authenticated)
    tables?: string[];        // beberapa tabel postgres_changes dalam SATU channel (mis. tiket_antrean + penanganan)
    pollMs?: number;          // default 30000; jeda saat channel belum SUBSCRIBED
    pollSaatTersambungMs?: number; // default 120000; jeda saat semua channel SUBSCRIBED
  } = {},
): void {
  const { topic, table, tables, pollMs = 30_000, pollSaatTersambungMs = 120_000 } = opts;
  // Kunci string stabil agar effect tidak berlangganan ulang tiap render (array baru dari pemanggil).
  const kunciTabel = Array.from(new Set([...(table ? [table] : []), ...(tables ?? [])])).join(',');
  const refetchRef = useRef(refetch);

  // Simpan di effect (bukan saat render) — aturan react-hooks/refs.
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    // Realtime bersifat opsional: lingkungan test / klien tanpa channel
    // tidak boleh mematahkan halaman — polling tetap menjadi jalur aman.
    let supabase: ReturnType<typeof createClient> | null = null;
    try {
      supabase = createClient();
    } catch {
      supabase = null;
    }
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { void refetchRef.current(); }, 500);
    };

    let aktif = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Status per channel; tersambung = ada channel dan semuanya SUBSCRIBED.
    const status: boolean[] = [];
    const tersambung = () => status.length > 0 && status.every(Boolean);
    const terlihat = () => typeof document === 'undefined' || !document.hidden;

    const hentikanJadwal = () => {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    const jadwalkan = () => {
      hentikanJadwal();
      if (!aktif || !terlihat()) return;
      timer = setTimeout(() => {
        timer = null;
        if (!aktif) return;
        void refetchRef.current();
        jadwalkan();
      }, tersambung() ? pollSaatTersambungMs : pollMs);
    };
    const catatStatus = (idx: number) => (s: string) => {
      if (!aktif) return;
      const baru = s === 'SUBSCRIBED';
      if (status[idx] === baru) return;
      status[idx] = baru;
      jadwalkan(); // jeda berubah sesuai status terbaru
    };
    const saatVisibilitas = () => {
      if (!aktif) return;
      if (terlihat()) {
        void refetchRef.current();
        jadwalkan();
      } else {
        hentikanJadwal();
      }
    };

    const hasClient = supabase !== null && typeof supabase.channel === 'function';
    const channels: Array<ReturnType<NonNullable<typeof supabase>['channel']>> = [];
    if (hasClient) {
      try {
        if (topic) {
          const idx = status.push(false) - 1;
          channels.push(
            (supabase as NonNullable<typeof supabase>)
              .channel(`realtime-refetch-${topic}`)
              .on('broadcast', { event: '*' }, trigger)
              .subscribe(catatStatus(idx)),
          );
        }
        if (kunciTabel) {
          let ch = (supabase as NonNullable<typeof supabase>).channel(
            `realtime-refetch-table-${kunciTabel.split(',').join('+')}`,
          );
          for (const nama of kunciTabel.split(',')) {
            ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: nama }, trigger);
          }
          const idx = status.push(false) - 1;
          channels.push(ch.subscribe(catatStatus(idx)));
        }
      } catch {
        // Tanpa realtime: polling tetap berjalan di bawah.
      }
    }

    jadwalkan();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', saatVisibilitas);
    }
    return () => {
      aktif = false;
      hentikanJadwal();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', saatVisibilitas);
      }
      if (debounce) clearTimeout(debounce);
      if (supabase && typeof supabase.removeChannel === 'function') {
        for (const ch of channels) void supabase.removeChannel(ch);
      }
    };
  }, [topic, kunciTabel, pollMs, pollSaatTersambungMs]);
}
