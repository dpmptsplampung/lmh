'use client';

import { KAB_KOTA_IPRO, STATUS_LAHAN } from '@/lib/investasi/konstanta';
import { Area, Pilih, Teks, type DasarIsian } from './isian';
import styles from '../../FormIpro.module.css';

const KAB_KOTA = KAB_KOTA_IPRO.map((k) => ({ nilai: k, label: k }));
const LAHAN = STATUS_LAHAN.map((s) => ({ nilai: s.nilai, label: s.id }));

export default function TabLokasi(d: DasarIsian) {
  return (
    <div className={styles.bidang}>
      <Pilih {...d} k="kab_kota" label="Kabupaten/kota" wajib pilihan={KAB_KOTA} />
      <Teks {...d} k="lokasi_teks" label="Lokasi (kecamatan/desa/kawasan)" maks={300} />
      <Teks {...d} k="lat" label="Lintang" mode="decimal" placeholder="-5.4500" bantuan="Wilayah Lampung: -6,6 sampai -3. Isi bersama bujur." />
      <Teks {...d} k="lng" label="Bujur" mode="decimal" placeholder="105.2600" bantuan="Wilayah Lampung: 103 sampai 106,6." />
      <Pilih {...d} k="status_lahan" label="Status lahan" pilihan={LAHAN} kosong="Belum ditentukan" />
      <div className={styles.lebar}>
        <Area {...d} k="perizinan" label="Status perizinan" baris={3} maks={2000} bantuan="Ringkasan teks polos." />
      </div>
    </div>
  );
}
