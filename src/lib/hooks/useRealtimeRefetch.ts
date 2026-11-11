'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { langganStatus, langganTabel, statusTabel } from '@/lib/realtime/pusat';

// Pola bersama Fase 3: refetch dipicu event realtime (jalur utama) dengan
// debounce, polling cadangan (jalur aman bila realtime terhenti), dan
// AbortController agar fetch lama tidak menimpa data baru.
// Tabel postgres_changes lewat pusat realtime (G4.6): satu channel `staf-tabel-<tabel>` per tab, dipakai bersama.
export function useRealtimeRefetch(
  refetch: () => Promise<void>,
  opts: {
    topic?: string;           // topik broadcast_changes (mis. 'antrean:publik')
    table?: string;           // tabel postgres_changes (staf authenticated)
    tables?: string[];        // beberapa tabel postgres_changes; tiap tabel = satu channel bersama `staf-tabel-<tabel>` di lib/realtime/pusat.ts
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
    const daftarTabel = kunciTabel ? kunciTabel.split(',') : [];
    // Status per sumber; tersambung = ada sumber dan semuanya SUBSCRIBED. Topik broadcast = channel milik hook ini
    // (null = tidak dipakai); tabel = channel bersama di pusat realtime (statusTabel).
    let statusTopik: boolean | null = null;
    const tersambung = () => {
      if (statusTopik === null && daftarTabel.length === 0) return false;
      if (statusTopik === false) return false;
      return daftarTabel.every((t) => statusTabel(t) === 'tersambung');
    };
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
    const catatStatusTopik = (s: string) => {
      if (!aktif) return;
      const baru = s === 'SUBSCRIBED';
      if (statusTopik === baru) return;
      statusTopik = baru;
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
    if (topic) {
      statusTopik = false;
      if (hasClient) {
        try {
          channels.push(
            (supabase as NonNullable<typeof supabase>)
              .channel(`realtime-refetch-${topic}`)
              .on('broadcast', { event: '*' }, trigger)
              .subscribe(catatStatusTopik),
          );
        } catch {
          // Tanpa realtime: polling tetap berjalan di bawah.
        }
      }
    }
    // Tabel: satu channel per tabel untuk seluruh tab, dibagi dengan pemakai lain (sidebar + halaman).
    const berhenti: Array<() => void> = [];
    const saatStatusTabel = () => {
      if (aktif) jadwalkan(); // pusat hanya memberi tahu saat status berubah
    };
    for (const nama of daftarTabel) {
      berhenti.push(langganStatus(nama, saatStatusTabel));
      berhenti.push(langganTabel(nama, trigger));
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
      for (const f of berhenti) f();
      if (supabase && typeof supabase.removeChannel === 'function') {
        for (const ch of channels) void supabase.removeChannel(ch);
      }
    };
  }, [topic, kunciTabel, pollMs, pollSaatTersambungMs]);
}
