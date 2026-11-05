import type { CSSProperties, ReactNode } from 'react';
import Kartu from '../Kartu';
import Skeleton from '../Skeleton';
import { formatAngka } from '../format';
import styles from './RingkasanSegmen.module.css';

export interface SegmenRingkas {
  kunci?: string;
  label: string;
  nilai: number;
  /** Warna CSS (token); bawaan var(--chart-N) menurut urutan. */
  warna?: string;
}

export interface RingkasanSegmenProps {
  judul: string;
  aksi?: ReactNode;
  item: SegmenRingkas[];
  memuat?: boolean;
  /** Ditampilkan bila `item` kosong. */
  kosong?: ReactNode;
  className?: string;
}

// Ringkasan bersegmen: tiap segmen = angka besar + label + garis warna sepanjang bagiannya dari total.
export default function RingkasanSegmen({ judul, aksi, item, memuat = false, kosong, className }: RingkasanSegmenProps) {
  const total = item.reduce((j, s) => j + s.nilai, 0);
  return (
    <Kartu judul={judul} aksi={aksi} className={className}>
      {memuat ? (
        <Skeleton bentuk="angka" jumlah={2} label={`Memuat ${judul}`} />
      ) : item.length === 0 && kosong ? (
        kosong
      ) : (
        <ul className={styles.daftar}>
          {item.map((s, i) => {
            const warna = s.warna ?? `var(--chart-${(i % 6) + 1})`;
            const bagian = total > 0 ? (s.nilai / total) * 100 : 0;
            return (
              <li key={s.kunci ?? s.label} className={styles.segmen}>
                <p className={styles.nilai}>{formatAngka(s.nilai)}</p>
                <p className={styles.label}>
                  {s.label}
                  <span className="sr-only">, {formatAngka(bagian, 0)} persen dari total</span>
                </p>
                <span className={styles.jalur} aria-hidden="true">
                  <span className={styles.garis} style={{ '--warna': warna, '--lebar': `${bagian}%` } as CSSProperties} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Kartu>
  );
}
