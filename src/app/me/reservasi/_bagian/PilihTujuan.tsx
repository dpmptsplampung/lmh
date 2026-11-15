'use client';

// Pilihan tujuan kunjungan: dua radio asli (dapat difokus dan dioperasikan papan ketik) berbentuk kartu.
import { MapPin, User } from 'lucide-react';
import type { TujuanKunjungan } from '../_logika/validasiReservasi';
import styles from '../reservasi.module.css';

interface PilihTujuanProps {
  tujuan: TujuanKunjungan;
  onPilih: (tujuan: 'loket' | 'bertemu_seseorang') => void;
}

export default function PilihTujuan({ tujuan, onPilih }: PilihTujuanProps) {
  return (
    <div className={styles.grup}>
      <span className={styles.labelGrup}>
        Tujuan Kunjungan <span className={styles.bintang} aria-hidden="true">*</span>
      </span>
      <div className={styles.tujuanGroup} role="radiogroup" aria-label="Tujuan Kunjungan">
        <label className={`${styles.tujuanOption} ${tujuan === 'loket' ? styles.tujuanOptionActive : ''}`}>
          <input
            type="radio"
            name="tujuan"
            value="loket"
            checked={tujuan === 'loket'}
            onChange={() => onPilih('loket')}
            className={styles.tujuanRadioInput}
          />
          <span className={`${styles.tujuanRadio} ${tujuan === 'loket' ? styles.tujuanRadioActive : ''}`} aria-hidden />
          <span className={`${styles.tujuanIcon} ${styles.tujuanIconLoket}`} aria-hidden>
            <MapPin size={20} strokeWidth={1.75} />
          </span>
          <span>
            <span className={styles.tujuanLabel}>Menuju Loket Layanan</span>
            <span className={styles.tujuanHint}>Pilih layanan yang ingin Anda datangi</span>
          </span>
        </label>

        <label className={`${styles.tujuanOption} ${tujuan === 'bertemu_seseorang' ? styles.tujuanOptionActive : ''}`}>
          <input
            type="radio"
            name="tujuan"
            value="bertemu_seseorang"
            checked={tujuan === 'bertemu_seseorang'}
            onChange={() => onPilih('bertemu_seseorang')}
            className={styles.tujuanRadioInput}
          />
          <span
            className={`${styles.tujuanRadio} ${tujuan === 'bertemu_seseorang' ? styles.tujuanRadioActive : ''}`}
            aria-hidden
          />
          <span className={`${styles.tujuanIcon} ${styles.tujuanIconBertemu}`} aria-hidden>
            <User size={20} strokeWidth={1.75} />
          </span>
          <span>
            <span className={styles.tujuanLabel}>Bertemu Seseorang</span>
            <span className={styles.tujuanHint}>Ketik nama orang yang ingin ditemui</span>
          </span>
        </label>
      </div>
    </div>
  );
}
