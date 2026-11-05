'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Bunyi "ding" untuk panggilan di layar TV. Web Audio (dua nada sinus singkat), tanpa berkas audio.
// Peramban memblokir suara otomatis, jadi konteks audio baru dibuat saat `aktifkan()` dipanggil dari
// klik pengguna (satu klik per sesi). Sebelum itu `ding()` diam. Semua galat ditelan: layar tetap berjalan.

type KelasAudio = typeof AudioContext;

function kelasAudio(): KelasAudio | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: KelasAudio; webkitAudioContext?: KelasAudio };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const NADA: ReadonlyArray<{ hz: number; mulai: number }> = [
  { hz: 880, mulai: 0 },
  { hz: 1318.5, mulai: 0.16 },
];

function bunyikan(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  for (const { hz, mulai } of NADA) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = hz;
    g.gain.setValueAtTime(0.0001, t0 + mulai);
    g.gain.exponentialRampToValueAtTime(0.35, t0 + mulai + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + mulai + 0.55);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + mulai);
    o.stop(t0 + mulai + 0.6);
  }
}

export function useBunyi(): { tersedia: boolean; aktif: boolean; aktifkan: () => void; ding: () => void } {
  const [tersedia, setTersedia] = useState(false);
  const [aktif, setAktif] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // Dicek di peramban (bukan saat render server) agar markup server dan klien sama.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTersedia(kelasAudio() !== null);
  }, []);

  const aktifkan = useCallback(() => {
    if (ctxRef.current) return;
    const Kelas = kelasAudio();
    if (!Kelas) return;
    try {
      const ctx = new Kelas();
      ctxRef.current = ctx;
      void ctx.resume?.();
      setAktif(true);
    } catch {
      ctxRef.current = null;
    }
  }, []);

  const ding = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') void ctx.resume();
      bunyikan(ctx);
    } catch {
      // Diam-diam.
    }
  }, []);

  return { tersedia, aktif, aktifkan, ding };
}
