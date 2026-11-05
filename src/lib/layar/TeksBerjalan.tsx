'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './elemen.module.css';

/** Kecepatan gulir (piksel per detik): cukup pelan untuk dibaca dari jauh. */
export const KECEPATAN_PX_DETIK = 140;
export const JEDA_PENGUMUMAN_MS = 5_000;

/** Cadangan bila ukuran tidak terukur (mis. tanpa tata letak) atau gerakan dikurangi. */
function durasiCadanganMs(teks: string): number {
  return Math.max(5_000, teks.length * 90);
}

function kurangiGerakan(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Teks berjalan layar TV: 1 sampai 3 pengumuman BERGANTIAN. Satu pengumuman bergulir sampai habis,
 * jeda `jedaMs`, lalu pengumuman berikutnya (berputar; satu pengumuman berulang sendiri).
 * Daftar kosong = tidak merender apa pun.
 */
export default function TeksBerjalan({
  pengumuman,
  jedaMs = JEDA_PENGUMUMAN_MS,
}: {
  pengumuman: string[];
  jedaMs?: number;
}) {
  const [indeksMentah, setIndeks] = useState(0);
  const [siklus, setSiklus] = useState(0);
  const [fase, setFase] = useState<'jalan' | 'jeda'>('jalan');
  const [durasi, setDurasi] = useState<number | null>(null);
  const [lebarBar, setLebarBar] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const teksRef = useRef<HTMLSpanElement>(null);

  const jumlah = pengumuman.length;
  const indeks = jumlah > 0 ? indeksMentah % jumlah : 0;
  const teks = pengumuman[indeks] ?? '';

  // Ukur sebelum dilukis: durasi = jarak tempuh (lebar bilah + lebar teks) / kecepatan.
  useLayoutEffect(() => {
    if (fase !== 'jalan' || !teks) return;
    const lebarB = barRef.current?.clientWidth ?? 0;
    const lebarT = teksRef.current?.scrollWidth ?? 0;
    setLebarBar(lebarB > 0 ? lebarB : null);
    setDurasi(
      kurangiGerakan() || lebarB <= 0 || lebarT <= 0
        ? durasiCadanganMs(teks)
        : Math.round(((lebarB + lebarT) / KECEPATAN_PX_DETIK) * 1000),
    );
  }, [fase, siklus, teks]);

  useEffect(() => {
    if (jumlah === 0) return;
    if (fase === 'jalan') {
      if (durasi === null) return;
      const t = setTimeout(() => setFase('jeda'), durasi);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setIndeks(i => i + 1);
      setSiklus(s => s + 1);
      setDurasi(null);
      setFase('jalan');
    }, jedaMs);
    return () => clearTimeout(t);
  }, [fase, durasi, jedaMs, jumlah]);

  if (jumlah === 0) return null;

  const style = {
    ...(durasi !== null ? { animationDuration: `${durasi}ms` } : {}),
    ...(lebarBar !== null ? { '--lebar-bar': `${lebarBar}px` } : {}),
  } as React.CSSProperties;

  return (
    <div ref={barRef} className={styles.bar} aria-live="off" data-testid="teks-berjalan">
      {fase === 'jalan' && (
        <span
          key={siklus}
          ref={teksRef}
          className={`${styles.teks} ${durasi !== null ? styles.teksJalan : ''}`}
          style={style}
        >
          {teks}
        </span>
      )}
    </div>
  );
}
