'use client';

import { Check, Frown, Laugh, Meh, Smile, type LucideIcon } from 'lucide-react';
import { SKALA_SKM, type KunciSkm } from '@/lib/survei/pertanyaan';
import { otomatisDariKlik, tanganiPanahRadio } from './navigasiRadio';
import styles from './survei.module.css';

interface SegmenSkmProps {
  kunci: KunciSkm;
  nomor: number;
  teks: string;
  nilai: number | undefined;
  nonaktif?: boolean;
  /** `otomatis` true hanya untuk ketukan/klik pointer; keyboard dan pembaca layar false. */
  onPilih: (nilai: number, otomatis: boolean) => void;
}

// Tampil dari kiri ke kanan: Kurang (1) ... Sangat Baik (4), searah dengan skala SPAK (buruk di kiri, baik di kanan).
const OPSI = [...SKALA_SKM].sort((a, b) => a.nilai - b.nilai);
const URUTAN = OPSI.map((s) => s.nilai);
// Ikon wajah hanya penguat visual (aria-hidden); arti tetap dari label teks, tidak dari warna atau ikon saja.
const IKON: Record<number, LucideIcon> = { 4: Laugh, 3: Smile, 2: Meh, 1: Frown };

// Satu unsur SKM: satu baris 4 segmen berlabel (Sangat Baik, Baik, Cukup, Kurang) dalam radiogroup berlabel nama unsur.
export default function SegmenSkm({ kunci, nomor, teks, nilai, nonaktif = false, onPilih }: SegmenSkmProps) {
  const idTeks = `soal-${kunci}-teks`;

  return (
    <div className={styles.soal} data-soal={kunci} data-terjawab={nilai !== undefined || undefined}>
      <div className={styles.soalKepala}>
        <span className={styles.nomor} aria-hidden="true">
          {nilai !== undefined ? <Check size={16} strokeWidth={3} /> : nomor}
        </span>
        <p id={idTeks} className={styles.soalTeks}>
          {teks}
        </p>
      </div>
      <div role="radiogroup" aria-labelledby={idTeks} className={styles.baris4}>
        {OPSI.map((opsi, posisi) => {
          const dipilih = opsi.nilai === nilai;
          const Ikon = IKON[opsi.nilai];
          return (
            <button
              key={opsi.nilai}
              type="button"
              role="radio"
              aria-checked={dipilih}
              tabIndex={dipilih || (nilai === undefined && posisi === 0) ? 0 : -1}
              disabled={nonaktif}
              className={`${styles.opsi} ${styles.opsiSkm}`}
              data-nilai={opsi.nilai}
              onClick={(e) => {
                const otomatis = otomatisDariKlik(e.detail);
                if (otomatis !== null) onPilih(opsi.nilai, otomatis);
              }}
              onKeyDown={(e) => tanganiPanahRadio(e, URUTAN, posisi, onPilih)}
            >
              <Ikon size={26} strokeWidth={1.75} aria-hidden="true" className={styles.ikonSkm} />
              <span>{opsi.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
