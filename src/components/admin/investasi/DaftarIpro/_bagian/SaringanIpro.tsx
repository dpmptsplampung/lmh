'use client';

import Field from '@/components/ui/Field';
import type { SaringanIpro as Nilai } from '../_logika/daftar';
import styles from '../../DaftarIpro.module.css';

export default function SaringanIpro({ saringan, onUbah }: { saringan: Nilai; onUbah: (b: Partial<Nilai>) => void }) {
  return (
    <form className={styles.saringan} role="search" aria-label="Saring daftar IPRO" onSubmit={(e) => e.preventDefault()}>
      <Field label="Cari judul">
        <input type="search" value={saringan.cari} maxLength={200} placeholder="Ketik judul proyek"
          onChange={(e) => onUbah({ cari: e.target.value })} />
      </Field>
      <Field label="Status">
        <select value={saringan.status} onChange={(e) => onUbah({ status: e.target.value as Nilai['status'] })}>
          <option value="">Semua status</option><option value="draf">Draf</option><option value="terbit">Terbit</option><option value="arsip">Arsip</option>
        </select>
      </Field>
      <Field label="Sumber">
        <select value={saringan.sumber} onChange={(e) => onUbah({ sumber: e.target.value as Nilai['sumber'] })}>
          <option value="">Semua sumber</option><option value="ptsp">PTSP</option><option value="foila">FOILA</option>
        </select>
      </Field>
    </form>
  );
}
