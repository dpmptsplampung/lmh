'use client';

import { SKALA_SPAK, type KunciSpak } from '@/lib/survei/pertanyaan';
import { otomatisDariKlik, tanganiPanahRadio } from './navigasiRadio';
import styles from './survei.module.css';

interface SkalaSpakProps {
  kunci: KunciSpak;
  nomor: number;
  teks: string;
  nilai: number | undefined;
  nonaktif?: boolean;
  /** `otomatis` true hanya untuk ketukan/klik pointer; keyboard dan pembaca layar false. */
  onPilih: (nilai: number, otomatis: boolean) => void;
}

const URUTAN = SKALA_SPAK.map((s) => s.nilai);

// Satu butir SPAK: baris 6 kotak angka (1 = Sangat Tidak Setuju ... 6 = Sangat Setuju) dalam radiogroup berlabel teks butir.
// Legenda skala ditampilkan sekali per langkah oleh SurveiWizard; di sini hanya label kedua ujung dan jawaban terpilih.
export default function SkalaSpak({ kunci, nomor, teks, nilai, nonaktif = false, onPilih }: SkalaSpakProps) {
  const idTeks = `soal-${kunci}-teks`;
  const terpilih = SKALA_SPAK.find((s) => s.nilai === nilai);

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
      <div role="radiogroup" aria-labelledby={idTeks} className={styles.baris6}>
        {SKALA_SPAK.map((opsi, posisi) => {
          const dipilih = opsi.nilai === nilai;
          return (
            <button
              key={opsi.nilai}
              type="button"
              role="radio"
              aria-checked={dipilih}
              // Nama aksesibel memuat angka yang terlihat (WCAG 2.5.3) ditambah arti angkanya.
              aria-label={`${opsi.nilai}, ${opsi.label}`}
              // Satu tab stop per kelompok (roving tabindex): jawaban terpilih, atau opsi pertama bila belum ada.
              tabIndex={dipilih || (nilai === undefined && posisi === 0) ? 0 : -1}
              disabled={nonaktif}
              className={styles.opsi}
              onClick={(e) => {
                const otomatis = otomatisDariKlik(e.detail);
                if (otomatis !== null) onPilih(opsi.nilai, otomatis);
              }}
              onKeyDown={(e) => tanganiPanahRadio(e, URUTAN, posisi, onPilih)}
            >
              {opsi.nilai}
            </button>
          );
        })}
      </div>
      <div className={styles.ujung} aria-hidden="true">
        <span>{SKALA_SPAK[0].label}</span>
        <span>{SKALA_SPAK[SKALA_SPAK.length - 1].label}</span>
      </div>
      <p className={styles.terpilih} aria-hidden="true">
        {terpilih ? `Terpilih: ${terpilih.label}` : 'Ketuk angka untuk memilih'}
      </p>
    </div>
  );
}
