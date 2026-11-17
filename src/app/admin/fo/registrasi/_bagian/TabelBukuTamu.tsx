'use client';

import { BookOpen, Search } from 'lucide-react';
import StatusKosong from '@/components/ui/StatusKosong';
import Tabel, { type KolomTabel } from '@/components/ui/Tabel';
import Tombol from '@/components/ui/Tombol';
import type { TamuBuku } from '@/lib/data/buku-tamu';
import { hpTampil, jamWIB, tanggalMasuk, teksKeluar } from '../_logika/bukuTamu';
import styles from './bukuTamu.module.css';

export interface TabelBukuTamuProps {
  items: TamuBuku[];
  memuat: boolean;
  /** Pencarian aktif / hanya hari ini: menentukan teks kosong. */
  adaCari: boolean;
  hariIniSaja: boolean;
  sedangKeluar: ReadonlySet<string>;
  onCatatKeluar: (id: string) => void;
}

// Daftar tamu: masuk, keluar (atau tombol "Catat keluar"), nama, asal, keperluan, menemui siapa, pencatat.
export default function TabelBukuTamu({ items, memuat, adaCari, hariIniSaja, sedangKeluar, onCatatKeluar }: TabelBukuTamuProps) {
  const kolom: KolomTabel<TamuBuku>[] = [
    {
      kunci: 'masuk',
      judul: 'Masuk',
      render: (t) => (
        <span className={styles.waktu}>
          {tanggalMasuk(t)}
          <span className={styles.sub}>{jamWIB(t.waktu_masuk)}</span>
        </span>
      ),
    },
    {
      kunci: 'keluar',
      judul: 'Keluar',
      render: (t) => {
        const keluar = teksKeluar(t);
        if (keluar) return <span className={styles.waktu}>{keluar}</span>;
        return (
          <Tombol
            ukuran="kecil"
            varian="sekunder"
            aria-label={`Catat keluar ${t.nama}`}
            memuat={sedangKeluar.has(t.id)}
            onClick={() => onCatatKeluar(t.id)}
          >
            Catat keluar
          </Tombol>
        );
      },
    },
    {
      kunci: 'nama',
      judul: 'Nama',
      judulBaris: true,
      render: (t) => (
        <>
          {t.nama}
          <span className={styles.sub}>{hpTampil(t.no_hp)}</span>
        </>
      ),
    },
    { kunci: 'asal', judul: 'Asal', render: (t) => t.instansi ?? '—' },
    {
      kunci: 'keperluan',
      judul: 'Keperluan',
      render: (t) => <span className={styles.keperluan} title={t.tujuan ?? undefined}>{t.tujuan ?? '—'}</span>,
    },
    { kunci: 'menemui', judul: 'Menemui', render: (t) => t.bertemu || '—' },
    { kunci: 'pencatat', judul: 'Dicatat oleh', render: (t) => t.dicatat_nama ?? '—' },
  ];

  return (
    <Tabel
      kolom={kolom}
      baris={items}
      kunciBaris={(t) => t.id}
      caption="Daftar tamu kantor"
      memuat={memuat}
      kosong={
        <StatusKosong
          ikon={adaCari ? Search : BookOpen}
          judul={hariIniSaja && !adaCari ? 'Belum ada tamu tercatat hari ini.' : 'Tidak ada tamu yang cocok dengan tanggal dan pencarian ini.'}
        />
      }
    />
  );
}
