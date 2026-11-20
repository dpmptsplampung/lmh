'use client';

import { useState } from 'react';
import { FileText, MessageSquare } from 'lucide-react';
import FormulirHubungi from '@/components/investasi/FormulirHubungi';
import PenampilDokumen from '@/components/investasi/PenampilDokumen';
import Tombol from '@/components/ui/Tombol';
import styles from '../detail.module.css';

type Props = {
  ipro: { id: string; judul: string };
  /** Dokumen kajian aktif proyek ini (null = tidak ada atau tidak aktif). */
  dokumen: { id: string; judul: string; jumlahHalaman: number } | null;
  kontakEmail: string;
};

/** Aksi utama: Hubungi petugas (formulir tanpa login) dan Lihat dokumen kajian (penampil view-only). */
export default function AksiIpro({ ipro, dokumen, kontakEmail }: Props) {
  const [formulir, setFormulir] = useState(false);
  const [penampil, setPenampil] = useState(false);
  return (
    <div className={styles.aksi}>
      <Tombol ukuran="besar" ikon={MessageSquare} onClick={() => setFormulir(true)}>Hubungi petugas</Tombol>
      {dokumen && (
        <Tombol ukuran="besar" varian="sekunder" ikon={FileText} onClick={() => setPenampil(true)}>Lihat dokumen kajian</Tombol>
      )}
      <FormulirHubungi terbuka={formulir} onTutup={() => setFormulir(false)} ipro={ipro} />
      {penampil && dokumen && (
        <PenampilDokumen
          dokumenId={dokumen.id}
          judul={dokumen.judul}
          jumlahHalaman={dokumen.jumlahHalaman}
          kontakEmail={kontakEmail}
          onTutup={() => setPenampil(false)}
        />
      )}
    </div>
  );
}
