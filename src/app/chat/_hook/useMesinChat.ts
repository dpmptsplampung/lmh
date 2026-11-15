'use client';

// Pemegang mesin keadaan percakapan (rencana refaktor 2026-11-11 tugas 6.3): useReducer(kurangiChat) + cermin `ref`.
//
// Cermin diperbarui SINKRON di `kirim` dengan reducer yang sama, sehingga kode async (sinkronisasi, Realtime, kirim pesan)
// membaca sesi/status/generasi terbaru tanpa menunggu render (dulu: sesiIdRef, sesiStatusRef, percakapanGenRef yang
// disetel manual). Semua perubahan keadaan WAJIB lewat `kirim` agar cermin dan state React tidak pernah berbeda.
import { useCallback, useReducer, useRef } from 'react';
import { KEADAAN_AWAL_CHAT, kurangiChat, type AksiChat, type KeadaanChat } from '../_logika/mesinChat';

export interface MesinChat {
  keadaan: KeadaanChat;
  /** Keadaan terbaru untuk dibaca di callback async (jangan dibaca saat render). */
  ref: { readonly current: KeadaanChat };
  kirim: (aksi: AksiChat) => void;
}

export function useMesinChat(): MesinChat {
  const [keadaan, dispatch] = useReducer(kurangiChat, KEADAAN_AWAL_CHAT);
  const ref = useRef<KeadaanChat>(KEADAAN_AWAL_CHAT);
  const kirim = useCallback((aksi: AksiChat) => {
    ref.current = kurangiChat(ref.current, aksi);
    dispatch(aksi);
  }, []);
  return { keadaan, ref, kirim };
}
