'use client';

import { useState } from 'react';
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import DialogKonfirmasi from '@/components/ui/DialogKonfirmasi';
import type { GambarIproKelola } from '@/lib/data/investasi';
import type { SumberIpro } from '../_logika/nilai-form';
import { batasGambar } from '../_logika/gambar';
import type { useGambarIpro } from '../_hook/useGambarIpro';
import BarisGambar from './BarisGambar';
import TambahGambar from './TambahGambar';
import styles from '../../FormIpro.module.css';

export interface PropsTabGambar {
  sumber: SumberIpro;
  proyekId: string | null;
  gambar: GambarIproKelola[];
  op: ReturnType<typeof useGambarIpro>;
}

export default function TabGambar({ sumber, proyekId, gambar, op }: PropsTabGambar) {
  const [hapusId, setHapusId] = useState<string | null>(null);
  const batas = batasGambar(sumber);
  if (!proyekId) {
    return <CatatanKeadaan jenis="info" judul="Simpan draf lebih dulu">Gambar diunggah setelah draf IPRO disimpan, supaya setiap gambar terhubung ke proyeknya.</CatatanKeadaan>;
  }
  const ptsp = sumber === 'ptsp';
  return (
    <div className={styles.kolom}>
      <p className={styles.catatan}>
        {ptsp ? `Maksimal ${batas} gambar; tandai satu sebagai gambar utama (wajib untuk terbit).` : 'Kartu FOILA memakai tepat satu gambar. Unduh gambar dari FOILA lalu unggah di sini.'}
        {' '}Terisi {gambar.length} dari {batas}.
      </p>
      {op.galat && <p role="alert" className={styles.galatUmum}>{op.galat}</p>}
      {gambar.length === 0 ? (
        <CatatanKeadaan jenis="kosong" judul="Belum ada gambar">Unggah gambar pertama lewat formulir di bawah.</CatatanKeadaan>
      ) : (
        <ul className={styles.daftarGambar} aria-label="Daftar gambar proyek">
          {gambar.map((g, i) => (
            <BarisGambar key={g.id} gambar={g} nomor={i + 1} jumlah={gambar.length} bolehUtama={ptsp} sibuk={op.sibuk}
              onSimpan={(id, isian) => void op.ubah(id, isian)} onUtama={(id) => void op.jadikanUtama(id)}
              onGeser={(id, arah) => void op.geser(id, arah)} onHapus={setHapusId} />
          ))}
        </ul>
      )}
      {gambar.length < batas
        ? <TambahGambar sibuk={op.sibuk} tampilUtama={ptsp} utamaAwal={ptsp && !gambar.some((g) => g.utama)} onTambah={op.tambah} />
        : <p className={styles.catatan}>Batas {batas} gambar tercapai. Hapus satu gambar untuk menambah yang baru.</p>}
      <DialogKonfirmasi terbuka={!!hapusId} judul="Hapus gambar ini?" berbahaya labelSetuju="Hapus gambar" memuat={op.sibuk}
        deskripsi="Gambar dihapus permanen dari proyek dan penyimpanan. Tindakan ini tidak dapat dibatalkan."
        onBatal={() => setHapusId(null)}
        onSetuju={() => { const id = hapusId; if (id) void op.hapus(id).then(() => setHapusId(null)); }} />
    </div>
  );
}
