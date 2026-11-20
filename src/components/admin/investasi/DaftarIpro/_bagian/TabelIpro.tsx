'use client';

import Link from 'next/link';
import Lencana from '@/components/ui/Lencana';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import type { IproAdmin } from '@/lib/data/investasi';
import { formatTanggal } from '@/lib/utils';
import { LABEL_STATUS, LABEL_SUMBER, NADA_STATUS, labelSektor } from '../../FormIpro/_logika/label';
import styles from '../../DaftarIpro.module.css';

export interface PropsTabelIpro {
  baris: IproAdmin[];
  hrefDaftar: string;
  memuat: boolean;
  kosong: React.ReactNode;
}

export default function TabelIpro({ baris, hrefDaftar, memuat, kosong }: PropsTabelIpro) {
  const kolom: KolomTabel<IproAdmin>[] = [
    { kunci: 'judul', judul: 'Judul', judulBaris: true, peran: 'utama',
      render: (b) => <Link className={styles.tautanJudul} href={`${hrefDaftar}/${b.id}`}>{b.judul}</Link> },
    { kunci: 'sumber', judul: 'Sumber', render: (b) => <Lencana nada="info">{LABEL_SUMBER[b.sumber]}</Lencana> },
    { kunci: 'sektor', judul: 'Sektor', render: (b) => labelSektor(b.sektor) },
    { kunci: 'kab_kota', judul: 'Kab/Kota' },
    { kunci: 'status', judul: 'Status', render: (b) => <Lencana nada={NADA_STATUS[b.status]} titik>{LABEL_STATUS[b.status]}</Lencana> },
    { kunci: 'diubah_pada', judul: 'Diperbarui', render: (b) => formatTanggal(b.diubah_pada) },
  ];
  return <Tabel caption="Daftar IPRO" kolom={kolom} baris={baris} kunciBaris="id" memuat={memuat} kosong={kosong} kartuDiHp />;
}
