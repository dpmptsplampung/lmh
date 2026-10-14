'use client';

// Dua isian wajib penutupan tahap FO (K10): topik (daftar topik FO) dan catatan singkat (maks 200 karakter, dengan
// penghitung). Label terhubung lewat htmlFor, galat lewat aria-invalid + aria-describedby (audit T8).
import { useEffect, useId, useRef } from 'react';
import { BATAS_CATATAN_FO, type TopikFo } from '@/lib/fo-penanganan';
import styles from './fo.module.css';

interface Props {
  topik: TopikFo[];
  topikId: string;
  catatan: string;
  onTopikChange: (id: string) => void;
  onCatatanChange: (teks: string) => void;
  disabled?: boolean;
  galatTopik?: string | null;
  galatCatatan?: string | null;
  /** Fokus awal ke pilihan topik saat komponen muncul (data-autofocus juga ditangkap focus trap dialog). */
  fokusAwal?: boolean;
}

export default function FoTopikCatatan({
  topik, topikId, catatan, onTopikChange, onCatatanChange, disabled = false, galatTopik, galatCatatan, fokusAwal = false,
}: Props) {
  const idDasar = useId();
  const idTopik = `${idDasar}-topik`;
  const idGalatTopik = `${idDasar}-galat-topik`;
  const idCatatan = `${idDasar}-catatan`;
  const idBantuan = `${idDasar}-bantuan`;
  const idGalatCatatan = `${idDasar}-galat-catatan`;
  const penuh = catatan.length >= BATAS_CATATAN_FO;
  const topikRef = useRef<HTMLSelectElement>(null);
  // Form inline (bukan dialog) tidak punya focus trap: pindahkan fokus ke isian pertama saat muncul.
  useEffect(() => {
    if (fokusAwal) topikRef.current?.focus();
  }, [fokusAwal]);

  return (
    <>
      <div className={styles.field}>
        <label htmlFor={idTopik} className="form-label form-label--required">Topik</label>
        <select
          ref={topikRef}
          id={idTopik}
          className="form-select"
          value={topikId}
          disabled={disabled}
          required
          aria-required="true"
          aria-invalid={galatTopik ? true : undefined}
          aria-describedby={galatTopik ? idGalatTopik : undefined}
          data-autofocus={fokusAwal ? '' : undefined}
          onChange={(e) => onTopikChange(e.target.value)}
        >
          <option value="">Pilih topik…</option>
          {topik.map((t) => (
            <option key={t.id} value={t.id}>{t.nama}</option>
          ))}
        </select>
        {galatTopik && <p id={idGalatTopik} role="alert" className={styles.galat}>{galatTopik}</p>}
      </div>

      <div className={styles.field}>
        <label htmlFor={idCatatan} className="form-label form-label--required">Catatan singkat</label>
        <textarea
          id={idCatatan}
          className="form-textarea"
          rows={3}
          value={catatan}
          maxLength={BATAS_CATATAN_FO}
          disabled={disabled}
          required
          aria-required="true"
          aria-invalid={galatCatatan ? true : undefined}
          aria-describedby={galatCatatan ? `${idBantuan} ${idGalatCatatan}` : idBantuan}
          placeholder="Ringkas apa yang ditanyakan atau dibantu"
          onChange={(e) => onCatatanChange(e.target.value)}
        />
        <div className={styles.bantuanBaris}>
          <span id={idBantuan} className={styles.bantuan}>Wajib diisi, maksimal {BATAS_CATATAN_FO} karakter.</span>
          <span
            className={`${styles.bantuan} ${styles.penghitung} ${penuh ? styles.penghitungPenuh : ''}`}
          >
            {catatan.length}/{BATAS_CATATAN_FO}
          </span>
        </div>
        {galatCatatan && <p id={idGalatCatatan} role="alert" className={styles.galat}>{galatCatatan}</p>}
      </div>
    </>
  );
}
