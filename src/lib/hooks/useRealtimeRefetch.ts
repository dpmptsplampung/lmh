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
    pollMs?: number;          // default 30000
  } = {},
): void {
  const { topic, table, tables, pollMs = 30_000 } = opts;
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

    const hasClient = supabase !== null && typeof supabase.channel === 'function';
    const channels: Array<ReturnType<NonNullable<typeof supabase>['channel']>> = [];
    if (hasClient) {
      try {
        if (topic) {
          channels.push(
            (supabase as NonNullable<typeof supabase>)
              .channel(`realtime-refetch-${topic}`)
              .on('broadcast', { event: '*' }, trigger)
              .subscribe(),
          );
        }
        if (kunciTabel) {
          let ch = (supabase as NonNullable<typeof supabase>).channel(
            `realtime-refetch-table-${kunciTabel.split(',').join('+')}`,
          );
          for (const nama of kunciTabel.split(',')) {
            ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: nama }, trigger);
          }
          channels.push(ch.subscribe());
        }
      } catch {
        // Tanpa realtime: polling tetap berjalan di bawah.
      }
    }

    const poll = setInterval(() => { void refetchRef.current(); }, pollMs);
    return () => {
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      if (supabase && typeof supabase.removeChannel === 'function') {
        for (const ch of channels) void supabase.removeChannel(ch);
      }
    };
  }, [topic, kunciTabel, pollMs]);
}
