'use client';

import { useState, type CSSProperties } from 'react';
import { ImageOff } from 'lucide-react';

interface FotoUmkmProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  /** Isi penuh induk (induk harus position: relative). */
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
}

// Foto UMKM bisa dari R2 atau tautan web eksternal mana pun (https). Karena host eksternal tak bisa didaftarkan untuk
// optimizer next/image, semuanya dirender <img> biasa: lazy, tanpa Referer (tautan eksternal tidak tahu halaman LMH),
// dan bila gagal dimuat (tautan mati) tampil placeholder, bukan ikon rusak.
export default function FotoUmkm({ src, alt, width, height, fill = false, className, style }: FotoUmkmProps) {
  const [gagal, setGagal] = useState(false);
  const ukuran: CSSProperties = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
    : { width, height };

  if (gagal) {
    return (
      <span
        role="img"
        aria-label="Foto tidak tersedia"
        className={className}
        style={{
          ...ukuran, ...style, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
          gap: 4, background: 'var(--color-neutral-100, #f3f4f6)', color: 'var(--text-tertiary, #6b7280)', fontSize: 11,
        }}
      >
        <ImageOff size={20} aria-hidden="true" />
        Foto tidak tersedia
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      style={{ objectFit: 'cover', ...ukuran, ...style }}
      onError={() => setGagal(true)}
    />
  );
}
