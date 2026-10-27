'use client';

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

const URUTAN = SKALA_SKM.map((s) => s.nilai);

// Satu unsur SKM: satu baris 4 segmen berlabel (Sangat Baik, Baik, Cukup, Kurang) dalam radiogroup berlabel nama unsur.
export default function SegmenSkm({ kunci, nomor, teks, nilai, nonaktif = false, onPilih }: SegmenSkmProps) {
  const idTeks = `soal-${kunci}-teks`;

  return (
    <div className={styles.soal} data-soal={kunci}>
      <div className={styles.soalKepala}>
        <span className={styles.nomor} aria-hidden="true">
          {nomor}
        </span>
        <p id={idTeks} className={styles.soalTeks}>
          {teks}
        </p>
      </div>
      <div role="radiogroup" aria-labelledby={idTeks} className={styles.baris4}>
        {SKALA_SKM.map((opsi, posisi) => {
          const dipilih = opsi.nilai === nilai;
          return (
            <button
              key={opsi.nilai}
              type="button"
              role="radio"
              aria-checked={dipilih}
              tabIndex={dipilih || (nilai === undefined && posisi === 0) ? 0 : -1}
              disabled={nonaktif}
              className={`${styles.opsi} ${styles.opsiSkm}`}
              onClick={(e) => {
                const otomatis = otomatisDariKlik(e.detail);
                if (otomatis !== null) onPilih(opsi.nilai, otomatis);
              }}
              onKeyDown={(e) => tanganiPanahRadio(e, URUTAN, posisi, onPilih)}
            >
              {opsi.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
