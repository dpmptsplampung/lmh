import Link from 'next/link';
import type { ReactNode } from 'react';
import Kartu from '../Kartu';
import Lencana, { type NadaLencana } from '../Lencana';
import Skeleton from '../Skeleton';
import styles from './DaftarRingkas.module.css';

export interface ItemDaftarRingkas {
  kunci: string;
  judul: string;
  deskripsi?: string;
  /** Waktu yang SUDAH diformat (WIB), mis. "09.15" atau "2 jam lalu". */
  waktu?: string;
  lencana?: { nada: NadaLencana; label: string };
  href?: string;
}

export interface DaftarRingkasProps {
  judul: string;
  aksi?: ReactNode;
  item: ItemDaftarRingkas[];
  maks?: number;
  lihatSemua?: { href: string; label?: string };
  memuat?: boolean;
  kosong?: ReactNode;
  className?: string;
}

// Daftar aktivitas/pengaduan/saran terbaru. Tiap item satu baris: judul + keterangan + waktu + Lencana status.
export default function DaftarRingkas({ judul, aksi, item, maks = 5, lihatSemua, memuat, kosong, className }: DaftarRingkasProps) {
  return (
    <Kartu judul={judul} aksi={aksi} className={className}>
      {memuat ? (
        <Skeleton bentuk="baris" jumlah={4} label={`Memuat ${judul}`} />
      ) : item.length === 0 && kosong ? (
        kosong
      ) : (
        <ul className={styles.daftar}>
          {item.slice(0, maks).map((it) => {
            const isi = (
              <>
                <span className={styles.teks}>
                  <span className={styles.judul}>{it.judul}</span>
                  {it.deskripsi && <span className={styles.deskripsi}>{it.deskripsi}</span>}
                </span>
                <span className={styles.sisi}>
                  {it.lencana && <Lencana nada={it.lencana.nada}>{it.lencana.label}</Lencana>}
                  {it.waktu && <span className={styles.waktu}>{it.waktu}</span>}
                </span>
              </>
            );
            return (
              <li key={it.kunci} className={styles.item}>
                {it.href ? (
                  <Link href={it.href} className={styles.baris}>
                    {isi}
                  </Link>
                ) : (
                  <div className={styles.baris}>{isi}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {lihatSemua && item.length > 0 && (
        <div className={styles.kaki}>
          <Link href={lihatSemua.href} className={styles.tautan}>
            {lihatSemua.label ?? 'Lihat semua'}
          </Link>
        </div>
      )}
    </Kartu>
  );
}
