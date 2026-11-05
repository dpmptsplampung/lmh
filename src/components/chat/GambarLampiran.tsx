'use client';

import { useState } from 'react';
import styles from './gambar-lampiran.module.css';

// Gambar lampiran chat dibaca lewat route berizin (/api/chat/lampiran/<pesanId>); gagal -> teks pengganti, daftar pesan tetap utuh.
export default function GambarLampiran({ pesanId, nama }: { pesanId: string; nama?: string | null }) {
  const [gagal, setGagal] = useState(false);
  if (gagal) return <span className={styles.gagal}>Foto tidak tersedia</span>;
  return (
    <a href={`/api/chat/lampiran/${pesanId}`} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/no-noninteractive-element-interactions -- onError pada img = deteksi gagal muat, bukan interaksi pengguna */}
      <img
        src={`/api/chat/lampiran/${pesanId}`}
        alt={nama ? `Foto: ${nama}` : 'Foto lampiran'}
        loading="lazy"
        onError={() => setGagal(true)}
        className={styles.gambar}
      />
    </a>
  );
}
