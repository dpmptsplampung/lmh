'use client';

import { Pilih, Teks, type DasarIsian } from './isian';
import styles from '../../FormIpro.module.css';

const MATA_UANG = [{ nilai: 'IDR', label: 'Rupiah (IDR)' }, { nilai: 'USD', label: 'Dolar AS (USD)' }];

export default function TabAngka(d: DasarIsian) {
  return (
    <div className={styles.bidang}>
      <Pilih {...d} k="mata_uang" label="Mata uang" wajib pilihan={MATA_UANG} kosong="Pilih mata uang"
        bantuan="Berlaku untuk nilai investasi dan NPV. Tidak ada konversi otomatis." />
      <Teks {...d} k="nilai_investasi" label="Nilai investasi" mode="numeric" bantuan="Bilangan bulat tanpa titik, mis. 1500000000." />
      <Teks {...d} k="irr_persen" label="IRR (%)" mode="decimal" bantuan="Antara -100 dan 1000." />
      <Teks {...d} k="npv_nilai" label="NPV" mode="numeric" bantuan="Boleh negatif." />
      <Teks {...d} k="payback_bulan" label="Payback (bulan)" mode="numeric" bantuan="1-600 bulan; ditampilkan sebagai tahun dan bulan." />
      <Teks {...d} k="luas_ha" label="Luas lahan (hektare)" mode="decimal" />
    </div>
  );
}
