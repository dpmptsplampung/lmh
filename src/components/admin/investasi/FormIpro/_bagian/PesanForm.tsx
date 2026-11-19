'use client';

import Tombol from '@/components/ui/Tombol';
import { labelKekurangan } from '../_logika/syarat';
import styles from '../../FormIpro.module.css';

export interface PropsPesanForm {
  pesan: string;
  konflik: boolean;
  kekurangan: string[];
  onMuatUlang: () => void;
}

// Galat layar: konflik versi (minta muat ulang), pesan umum, dan daftar kekurangan syarat terbit dari server.
export default function PesanForm({ pesan, konflik, kekurangan, onMuatUlang }: PropsPesanForm) {
  if (!pesan && !konflik && kekurangan.length === 0) return null;
  return (
    <div className={styles.pesan} role="alert">
      {pesan && <p>{pesan}</p>}
      {kekurangan.length > 0 && (
        <>
          <p><strong>Belum bisa diterbitkan. Lengkapi dulu:</strong></p>
          <ul>{labelKekurangan(kekurangan).map((k) => <li key={k}>{k}</li>)}</ul>
        </>
      )}
      {konflik && <Tombol type="button" varian="sekunder" ukuran="kecil" onClick={onMuatUlang}>Muat ulang data</Tombol>}
    </div>
  );
}
