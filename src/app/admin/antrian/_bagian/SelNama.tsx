'use client';

// Sel Nama pada tabel antrean: nama pengunjung + (tiket hasil eskalasi) catatan Front Office. Hanya tampilan dari props.
import { MessageSquare } from 'lucide-react';
import type { CatatanEskalasi, TiketBaris } from '@/lib/data/antrean';
import { tiketHasilEskalasi } from '@/lib/pelayanan';
import { kunjunganDari } from '../_logika/turunan';
import styles from '../antrian.module.css';

export interface SelNamaProps {
  tiket: TiketBaris;
  /** Catatan eskalasi FO tahap asal tiket (pelengkap; belum termuat/gagal = tidak ada). */
  catatanFo?: CatatanEskalasi;
}

export default function SelNama({ tiket, catatanFo }: SelNamaProps) {
  const k = kunjunganDari(tiket);
  return (
    <>
      <span className={styles.nama}>{k?.nama ?? '—'}</span>
      {tiketHasilEskalasi(tiket) && (
        <div className={styles.eskalasi}>
          <strong className={styles.eskalasiJudul}>
            <MessageSquare size={12} aria-hidden="true" /> Eskalasi dari Front Office
          </strong>
          {catatanFo?.topik && <div>Topik: {catatanFo.topik}</div>}
          {catatanFo?.catatan && <div className={styles.catatanFo}>{catatanFo.catatan}</div>}
          {catatanFo?.foNama && <div className={styles.oleh}>oleh {catatanFo.foNama}</div>}
        </div>
      )}
    </>
  );
}
