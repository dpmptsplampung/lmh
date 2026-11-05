'use client';

import { useState } from 'react';
import { todayWIB } from '@/lib/time';
import KisiKalender from './kalender/KisiKalender';
import PopoverKalender, { useTutupPopover } from './kalender/PopoverKalender';
import { apitkan, diLuarBatas, formatPanjang, formatPendek, tanggalValid } from './kalender/tanggal';
import styles from './PemilihTanggal.module.css';

export interface PemilihTanggalProps {
  /** "YYYY-MM-DD" (kalender WIB). Kosong atau format salah ditampilkan sebagai belum dipilih. */
  nilai: string;
  onUbah: (nilai: string) => void;
  /** Nama bidang untuk pembaca layar, mis. "Tanggal". */
  label: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  /** Dipasang pada tombol pemicu, jadi `<label htmlFor>` luar bisa menunjuknya. */
  id?: string;
  className?: string;
  'aria-describedby'?: string;
}

// Pemilih satu tanggal buatan sendiri (pengganti <input type="date">). Nilai "YYYY-MM-DD" seperti input bawaan.
export default function PemilihTanggal({ nilai, onUbah, label, min, max, disabled, id, className, ...aria }: PemilihTanggalProps) {
  const valid = tanggalValid(nilai);
  const teks = valid ? formatPendek(nilai) : 'Pilih tanggal';
  const labelTombol = `${label}: ${valid ? formatPanjang(nilai) : 'belum dipilih'}`;

  return (
    <PopoverKalender
      id={id}
      className={className}
      disabled={disabled}
      teks={teks}
      labelTombol={labelTombol}
      labelDialog={label}
      {...aria}
    >
      <IsiTanggal nilai={valid ? nilai : ''} min={min} max={max} onUbah={onUbah} />
    </PopoverKalender>
  );
}

interface IsiTanggalProps {
  nilai: string;
  min?: string;
  max?: string;
  onUbah: (v: string) => void;
}

function IsiTanggal({ nilai, min, max, onUbah }: IsiTanggalProps) {
  const tutup = useTutupPopover();
  const hariIni = todayWIB();
  const onPilih = (v: string) => {
    if (v !== nilai) onUbah(v);
    tutup(true);
  };
  const [fokus, setFokus] = useState(() => apitkan(nilai || hariIni, min, max));
  const hariIniBoleh = !diLuarBatas(hariIni, min, max);

  return (
    <div className={styles.isi}>
      <KisiKalender fokus={fokus} onFokus={setFokus} onPilih={onPilih} terpilih={nilai || null} min={min} max={max} hariIni={hariIni} />
      <div className={styles.kaki}>
        <button type="button" className={styles.tautan} disabled={!hariIniBoleh} onClick={() => onPilih(hariIni)}>
          Hari ini
        </button>
      </div>
    </div>
  );
}
