'use client';

import { SEKTOR_IPRO, SKEMA_IPRO, TAHAP_KAJIAN } from '@/lib/investasi/konstanta';
import { Area, Pilih, Teks, type DasarIsian } from './isian';
import styles from '../../FormIpro.module.css';

const SEKTOR = SEKTOR_IPRO.map((s) => ({ nilai: s.nilai, label: s.id }));
const TAHAP = TAHAP_KAJIAN.map((s) => ({ nilai: s.nilai, label: s.id }));
const SKEMA = SKEMA_IPRO.map((s) => ({ nilai: s.nilai, label: s.id }));

export default function TabInformasi(d: DasarIsian) {
  return (
    <div className={styles.bidang}>
      <div className={styles.lebar}><Teks {...d} k="judul" label="Judul proyek" wajib maks={200} /></div>
      <div className={styles.lebar}>
        <Area {...d} k="ringkasan" label="Ringkasan" wajib baris={3} maks={600}
          bantuan="Teks polos, tampil di kartu dan deskripsi mesin pencari (maksimal 600 karakter)." />
      </div>
      <div className={styles.lebar}>
        <Area {...d} k="deskripsi" label="Deskripsi" wajib baris={10} maks={20000}
          bantuan="Teks polos. Pisahkan paragraf dengan satu baris kosong. Wajib terisi sebelum diterbitkan." />
      </div>
      <Pilih {...d} k="sektor" label="Sektor" wajib pilihan={SEKTOR} />
      <Pilih {...d} k="tahap_kajian" label="Tahap kajian" pilihan={TAHAP} kosong="Belum ditentukan" />
      <Pilih {...d} k="skema" label="Skema kerja sama" pilihan={SKEMA} kosong="Belum ditentukan" />
      <Teks {...d} k="pemilik" label="Pemilik/pemrakarsa proyek" maks={200} />
      <Teks {...d} k="urutan" label="Urutan tampil" mode="numeric" bantuan="Angka lebih kecil tampil lebih dulu di halaman Investasi." />
    </div>
  );
}
