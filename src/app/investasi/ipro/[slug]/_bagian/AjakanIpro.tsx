'use client';

import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import FormulirHubungi from '@/components/investasi/FormulirHubungi';
import Tombol from '@/components/ui/Tombol';
import styles from '../detail.module.css';

/** Ajakan penutup halaman proyek: ulangi aksi utama (Hubungi petugas) dan tawarkan proyek lain. */
export default function AjakanIpro({ ipro }: { ipro: { id: string; judul: string } }) {
  const [formulir, setFormulir] = useState(false);
  return (
    <section className={styles.ajakanAkhir} aria-labelledby="judul-ajakan-ipro">
      <h2 id="judul-ajakan-ipro">Tertarik dengan proyek ini?</h2>
      <p>Petugas DPMPTSP membantu informasi lanjutan dan pendampingan. Anda juga dapat melihat proyek lain yang sedang ditawarkan.</p>
      <div className={styles.ajakanAksi}>
        <Tombol ukuran="besar" varian="aksen" ikon={MessageSquare} onClick={() => setFormulir(true)}>Tanya petugas</Tombol>
        <Tombol href="/investasi#proyek-ptsp" ukuran="besar" varian="sekunder">Lihat proyek lain</Tombol>
      </div>
      <FormulirHubungi terbuka={formulir} onTutup={() => setFormulir(false)} ipro={ipro} />
    </section>
  );
}
