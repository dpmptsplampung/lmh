'use client';

import type { DokumenRingkas } from '@/lib/data/investasi';
import { Pilih, Teks, type DasarIsian } from './isian';
import styles from '../../FormIpro.module.css';

export default function TabKontak({ dokumen, ...d }: DasarIsian & { dokumen: DokumenRingkas[] }) {
  const pilihan = dokumen.map((x) => ({ nilai: x.id, label: x.judul }));
  // Dokumen yang sudah dipilih tetapi tidak lagi aktif tetap tampil agar pilihan tidak hilang diam-diam.
  if (d.nilai.dokumen_id && !pilihan.some((p) => p.nilai === d.nilai.dokumen_id)) {
    pilihan.unshift({ nilai: d.nilai.dokumen_id, label: 'Dokumen terpilih (tidak aktif atau tidak ditemukan)' });
  }
  return (
    <div className={styles.bidang}>
      <div className={styles.lebar}>
        <Pilih {...d} k="dokumen_id" label="Dokumen kajian" pilihan={pilihan} kosong="Tanpa dokumen"
          bantuan="Dokumen ber-watermark dari Investment Gallery yang berstatus aktif." />
      </div>
      <p className={`${styles.catatan} ${styles.lebar}`}>
        Isi kontak lembaga saja. Nomor pribadi petugas tidak boleh dicantumkan; calon investor dihubungkan lewat tombol &ldquo;Hubungi petugas&rdquo;.
      </p>
      <div className={styles.lebar}><Teks {...d} k="kontak_instansi" label="Instansi kontak" maks={200} /></div>
      <Teks {...d} k="kontak_email" label="Email dinas" tipe="email" mode="email" maks={254} />
      <Teks {...d} k="kontak_telepon" label="Telepon kantor" tipe="tel" mode="tel" maks={21} placeholder="0721 123456" />
    </div>
  );
}
