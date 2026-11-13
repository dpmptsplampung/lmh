'use client';

import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import type { ComponentPropsWithRef, ElementType, MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './Tombol.module.css';

type IkonTombol = ElementType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' }>;

interface DasarProps {
  /** `aksen` = latar aksen (ajakan di halaman publik, mis. blok CTA). */
  varian?: 'utama' | 'sekunder' | 'hantu' | 'bahaya' | 'aksen';
  /** `besar` = ajakan utama halaman publik dan aksi utama alur (48px). */
  ukuran?: 'kecil' | 'normal' | 'besar';
  ikon?: IkonTombol;
  /** Ikon di belakang teks (panah/pesawat penunjuk arah). Seperti `ikon`, jangan dioper dari Server Component. */
  ikonAkhir?: IkonTombol;
  /** Sedang bekerja: teks dan lebar tetap, ikon diganti spinner, klik diabaikan, aria-busy aktif. */
  memuat?: boolean;
  className?: string;
  children: ReactNode;
}

type PropsTombol = DasarProps & { href?: undefined } & Omit<ComponentPropsWithRef<'button'>, keyof DasarProps>; // React 19: ref lewat props (pemanggil butuh fokus terkelola)
type PropsTautan = DasarProps & {
  href: string;
  /** Tautan ke luar aplikasi atau unduhan memakai <a> biasa. */
  eksternal?: boolean;
  target?: string;
  rel?: string;
  download?: string | boolean;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  'aria-label'?: string;
  title?: string;
};

export type TombolProps = PropsTombol | PropsTautan;

// Buang prop desain agar tidak bocor ke elemen <button>.
function omitDasar(props: PropsTombol) {
  const salinan: Record<string, unknown> = { ...props };
  for (const k of ['varian', 'ukuran', 'ikon', 'ikonAkhir', 'memuat', 'className', 'children', 'href']) delete salinan[k];
  return salinan as Omit<PropsTombol, keyof DasarProps | 'href'>;
}

// Tombol "Dasbor". Tanpa `href` = <button type="button"> (bukan submit kecuali type="submit" diberikan);
// dengan `href` = next/link. Saat `memuat`, tombol memakai aria-disabled (bukan disabled) agar fokus papan
// ketik tidak hilang di tengah aksi.
export default function Tombol(props: TombolProps) {
  const { varian = 'utama', ukuran = 'normal', ikon: Ikon, ikonAkhir: IkonAkhir, memuat = false, className, children } = props;
  const kelas = cn(
    styles.tombol,
    styles[varian],
    ukuran === 'kecil' && styles.kecil,
    ukuran === 'besar' && styles.besar,
    memuat && styles.memuat,
    className,
  );
  // Spinner menggantikan ikon depan; tanpa ikon depan ia menggantikan ikon akhir, dan tanpa keduanya menumpang di padding.
  const spinnerDiAkhir = memuat && !Ikon && !!IkonAkhir;
  const spinner = (
    <Loader2
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      className={cn(styles.spinner, !Ikon && !IkonAkhir && styles.spinnerTumpang)}
    />
  );
  const isi = (
    <>
      {memuat && !spinnerDiAkhir ? spinner : Ikon ? <Ikon size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
      <span>{children}</span>
      {spinnerDiAkhir ? (
        spinner
      ) : IkonAkhir ? (
        <IkonAkhir size={16} strokeWidth={1.75} aria-hidden="true" />
      ) : null}
    </>
  );

  if (props.href !== undefined) {
    const { href, eksternal, target, rel, download, onClick, title } = props;
    const ariaLabel = props['aria-label'];
    const tahan = (e: MouseEvent<HTMLAnchorElement>) => {
      if (memuat) {
        e.preventDefault();
        return;
      }
      onClick?.(e);
    };
    if (eksternal || download !== undefined || target) {
      return (
        <a
          href={href}
          className={kelas}
          target={target}
          rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
          download={download}
          onClick={tahan}
          aria-label={ariaLabel}
          title={title}
          aria-busy={memuat || undefined}
          aria-disabled={memuat || undefined}
        >
          {isi}
        </a>
      );
    }
    return (
      <Link
        href={href}
        className={kelas}
        onClick={tahan}
        aria-label={ariaLabel}
        title={title}
        aria-busy={memuat || undefined}
        aria-disabled={memuat || undefined}
      >
        {isi}
      </Link>
    );
  }

  const { type = 'button', onClick, ...sisa } = omitDasar(props as PropsTombol);
  return (
    <button
      {...sisa}
      type={type}
      className={kelas}
      aria-busy={memuat || undefined}
      aria-disabled={memuat || sisa['aria-disabled'] || undefined}
      onClick={(e) => {
        if (memuat) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {isi}
    </button>
  );
}
