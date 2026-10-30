'use client';

import { useId } from 'react';
import { kenaliPreset, LABEL_PRESET, rentangPreset, type Preset } from '@/lib/survei/rentang';
import styles from './HasilGlobal.module.css';

interface Props {
  dari: string;
  sampai: string;
  /** Hari ini (WIB); diberikan pemanggil agar mudah diuji. */
  hariIni: string;
  onUbah: (rentang: { dari: string; sampai: string }) => void;
  children?: React.ReactNode;
}

// Filter tanggal: preset cepat + rentang bebas "dari - sampai" (tanggal WIB, inklusif). Rentang tidak sah (dari > sampai) ditolak.
export default function FilterPeriode({ dari, sampai, hariIni, onUbah, children }: Props) {
  const id = useId();
  const preset = kenaliPreset(dari, sampai, hariIni);

  return (
    <div className={styles.filter}>
      <label className={styles.bidang} htmlFor={`${id}-preset`}>
        Periode
        <select
          id={`${id}-preset`}
          className="form-input"
          value={preset}
          onChange={(e) => {
            const p = e.target.value as Preset;
            if (p !== 'kustom') onUbah(rentangPreset(p, hariIni));
          }}
        >
          {(Object.keys(LABEL_PRESET) as Exclude<Preset, 'kustom'>[]).map((p) => (
            <option key={p} value={p}>{LABEL_PRESET[p]}</option>
          ))}
          <option value="kustom" disabled={preset !== 'kustom'}>Rentang tanggal sendiri</option>
        </select>
      </label>
      <label className={styles.bidang} htmlFor={`${id}-dari`}>
        Dari tanggal
        <input
          id={`${id}-dari`}
          type="date"
          className="form-input"
          value={dari}
          max={sampai}
          onChange={(e) => e.target.value && e.target.value <= sampai && onUbah({ dari: e.target.value, sampai })}
        />
      </label>
      <label className={styles.bidang} htmlFor={`${id}-sampai`}>
        Sampai tanggal
        <input
          id={`${id}-sampai`}
          type="date"
          className="form-input"
          value={sampai}
          min={dari}
          onChange={(e) => e.target.value && e.target.value >= dari && onUbah({ dari, sampai: e.target.value })}
        />
      </label>
      {children && <div className={styles.aksi}>{children}</div>}
    </div>
  );
}
