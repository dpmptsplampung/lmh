'use client';

import { useState } from 'react';

// Gambar lampiran chat dibaca lewat route berizin (/api/chat/lampiran/<pesanId>); gagal -> teks pengganti, daftar pesan tetap utuh.
export default function GambarLampiran({ pesanId, nama }: { pesanId: string; nama?: string | null }) {
  const [gagal, setGagal] = useState(false);
  if (gagal) return <span style={{ fontSize: 12, opacity: 0.7 }}>Foto tidak tersedia</span>;
  return (
    <a href={`/api/chat/lampiran/${pesanId}`} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/chat/lampiran/${pesanId}`}
        alt={nama ? `Foto: ${nama}` : 'Foto lampiran'}
        loading="lazy"
        onError={() => setGagal(true)}
        style={{ display: 'block', maxWidth: 'min(240px, 100%)', maxHeight: 240, borderRadius: 8, objectFit: 'cover' }}
      />
    </a>
  );
}
