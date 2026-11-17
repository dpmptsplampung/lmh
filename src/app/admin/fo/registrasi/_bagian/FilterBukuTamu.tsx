'use client';

import PemilihRentang from '@/components/ui/PemilihRentang';
import Tombol from '@/components/ui/Tombol';
import { todayWIB } from '@/lib/time';
import styles from './bukuTamu.module.css';

export interface FilterBukuTamuProps {
  dari: string;
  sampai: string;
  cari: string;
  /** Kata kunci yang sedang berlaku (sesudah jeda ketik). */
  q: string;
  onRentang: (r: { dari: string; sampai: string }) => void;
  onCari: (nilai: string) => void;
  onHariIni: () => void;
}

// Filter tanggal + pencarian. Tanpa query dan tanpa state sendiri: semuanya dari props.
export default function FilterBukuTamu({ dari, sampai, cari, q, onRentang, onCari, onHariIni }: FilterBukuTamuProps) {
  const hariIniSaja = dari === todayWIB() && sampai === todayWIB();
  return (
    <div className={styles.filter} role="search" aria-label="Filter buku tamu">
      <PemilihRentang dari={dari} sampai={sampai} max={todayWIB()} label="Rentang tanggal buku tamu" onUbah={onRentang} />
      <div className={`form-group ${styles.cari}`}>
        <label className="form-label" htmlFor="btCari">Cari tamu</label>
        <input
          id="btCari"
          type="search"
          className="form-input"
          value={cari}
          maxLength={100}
          placeholder="Nama, asal, atau yang ditemui"
          onChange={(e) => onCari(e.target.value)}
        />
      </div>
      <Tombol varian="sekunder" onClick={onHariIni} disabled={hariIniSaja && !cari && !q}>Hari ini</Tombol>
    </div>
  );
}
