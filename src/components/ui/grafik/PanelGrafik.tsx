'use client';

import { BarChart3, Download, ExternalLink, Table2 } from 'lucide-react';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import Kartu from '../Kartu';
import MenuTitikTiga, { type ItemMenu } from '../MenuTitikTiga';
import Skeleton from '../Skeleton';
import TabelCadangan from './TabelCadangan';
import type { TabelGrafik } from './tipe';
import { unduhCsv } from './unduhCsv';
import styles from './PanelGrafik.module.css';

export interface LegendaItem {
  label: string;
  /** Warna CSS (token), mis. "var(--chart-1)". */
  warna: string;
  putus?: boolean;
}

export interface PanelGrafikProps {
  judul: string;
  /** Keterangan kanan judul, mis. "target 15 menit". */
  meta?: ReactNode;
  /** Angka ringkasan besar di bawah judul (mis. total 30 hari). */
  nilaiUtama?: ReactNode;
  legenda?: LegendaItem[];
  /**
   * Data di balik grafik: sumber menu "Lihat sebagai tabel" (tabel cadangan) dan "Unduh CSV".
   * Wajib untuk grafik berseri; hanya Meteran/Sparkline yang boleh tanpa tabel.
   */
  tabel?: TabelGrafik;
  /** Awalan nama berkas unduhan CSV. */
  namaBerkas?: string;
  /** Tautan "Buka laporan". */
  laporanHref?: string;
  memuat?: boolean;
  /** Bila diisi (mis. <CatatanKeadaan>), menggantikan grafik. */
  kosong?: ReactNode;
  kaki?: ReactNode;
  className?: string;
  /** Grafik (GrafikGaris, GrafikBatang, GrafikDonat, Meteran, ...). */
  children: ReactNode;
}

// Kartu grafik: judul, meta, legenda, menu titik tiga (tabel / CSV / laporan), isi, kaki.
export default function PanelGrafik({
  judul,
  meta,
  nilaiUtama,
  legenda,
  tabel,
  namaBerkas,
  laporanHref,
  memuat = false,
  kosong,
  kaki,
  className,
  children,
}: PanelGrafikProps) {
  const [lihatTabel, setLihatTabel] = useState(false);
  const idLegenda = useId();

  const item: ItemMenu[] = [];
  if (tabel) {
    item.push({
      kunci: 'tabel',
      label: lihatTabel ? 'Lihat sebagai grafik' : 'Lihat sebagai tabel',
      ikon: lihatTabel ? BarChart3 : Table2,
      onPilih: () => setLihatTabel((v) => !v),
    });
    item.push({
      kunci: 'csv',
      label: 'Unduh CSV',
      ikon: Download,
      onPilih: () => unduhCsv(namaBerkas ?? judul.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), tabel),
    });
  }
  if (laporanHref) item.push({ kunci: 'laporan', label: 'Buka laporan', ikon: ExternalLink, href: laporanHref });

  const adaKosong = kosong !== undefined && kosong !== null && kosong !== false;

  return (
    <Kartu
      judul={judul}
      className={cn(styles.panel, className)}
      aksi={
        <>
          {meta && <span className={styles.meta}>{meta}</span>}
          {item.length > 0 && <MenuTitikTiga item={item} label={`Opsi grafik ${judul}`} />}
        </>
      }
    >
      {nilaiUtama && <p className={styles.nilaiUtama}>{nilaiUtama}</p>}
      {legenda && legenda.length > 0 && (
        <ul className={styles.legenda} aria-label={`Legenda ${judul}`} id={idLegenda}>
          {legenda.map((l) => (
            <li key={l.label} className={styles.itemLegenda}>
              <span
                className={cn(styles.sampel, l.putus && styles.sampelPutus)}
                style={{ '--warna': l.warna } as CSSProperties}
                aria-hidden="true"
              />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <div className={styles.isi}>
        {memuat ? (
          <Skeleton bentuk="kartu" label={`Memuat ${judul}`} />
        ) : adaKosong ? (
          kosong
        ) : lihatTabel && tabel ? (
          <TabelCadangan caption={`Data ${judul}`} tabel={tabel} />
        ) : (
          children
        )}
      </div>
      {kaki && <div className={styles.kaki}>{kaki}</div>}
    </Kartu>
  );
}
