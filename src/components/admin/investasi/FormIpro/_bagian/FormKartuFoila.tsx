'use client';

import { SEKTOR_IPRO, KAB_KOTA_IPRO } from '@/lib/investasi/konstanta';
import { Area, Pilih, Teks, type DasarIsian } from './isian';
import styles from '../../FormIpro.module.css';

const SEKTOR = SEKTOR_IPRO.map((s) => ({ nilai: s.nilai, label: s.id }));
const KAB_KOTA = KAB_KOTA_IPRO.map((k) => ({ nilai: k, label: k }));
const MATA_UANG = [{ nilai: 'IDR', label: 'Rupiah (IDR)' }, { nilai: 'USD', label: 'Dolar AS (USD)' }];

// Field kartu FOILA saja: kartu hanya cuplikan + tautan keluar, tidak pernah menjadi halaman detail.
export default function FormKartuFoila(d: DasarIsian) {
  return (
    <div className={styles.bidang}>
      <div className={styles.lebar}>
        <Teks {...d} k="sumber_url" label="Tautan proyek di FOILA" wajib tipe="url" mode="url" maks={2048}
          placeholder="https://invest.lampungprov.go.id/..."
          bantuan="Hanya alamat dari invest.lampungprov.go.id (https, tanpa akun atau port)." />
      </div>
      <div className={styles.lebar}><Teks {...d} k="judul" label="Judul proyek" wajib maks={200} /></div>
      <div className={styles.lebar}><Area {...d} k="ringkasan" label="Ringkasan" wajib baris={3} maks={600} /></div>
      <Pilih {...d} k="sektor" label="Sektor" wajib pilihan={SEKTOR} bantuan="Petakan ke salah satu sektor LMH." />
      <Pilih {...d} k="kab_kota" label="Kabupaten/kota" wajib pilihan={KAB_KOTA} />
      <Teks {...d} k="nilai_teks" label="Label nilai (opsional)" maks={200} placeholder="IDR 53.18 trillion"
        bantuan="Ditampilkan apa adanya di kartu." />
      <Pilih {...d} k="mata_uang" label="Mata uang" wajib pilihan={MATA_UANG} kosong="Pilih mata uang" />
      <Teks {...d} k="nilai_investasi" label="Nilai investasi (opsional)" mode="numeric" bantuan="Bilangan bulat; dipakai bila label nilai kosong." />
      <Teks {...d} k="urutan" label="Urutan tampil" mode="numeric" />
      <div className={styles.lebar}><Teks {...d} k="judul_en" label="Judul (Inggris, opsional)" maks={200} /></div>
      <div className={styles.lebar}><Area {...d} k="ringkasan_en" label="Ringkasan (Inggris, opsional)" baris={2} maks={600} /></div>
    </div>
  );
}
