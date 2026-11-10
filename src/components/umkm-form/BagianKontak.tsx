'use client';

import Field from '@/components/ui/Field';
import type { Revisi } from '@/lib/umkm-katalog/types';
import styles from './umkm-form.module.css';

type Props = {
  awal?: Partial<Revisi>; galat?: Record<string, string>; labelNomor: string; bantuanNomor?: string;
};

// Data kontak tertutup: tidak pernah tampil di katalog. Nomor tidak diberi nilai awal.
export default function BagianKontak({ awal, galat = {}, labelNomor, bantuanNomor }: Props) {
  return <div className={styles.bidang}>
    <Field label="Nama pemilik (opsional)" galat={galat.nama_pemilik} bantuan="Tidak tampil di katalog.">
      <input name="nama_pemilik" defaultValue={awal?.nama_pemilik ?? ''} maxLength={200} autoComplete="off" />
    </Field>
    <Field label={labelNomor} galat={galat.nomor}
      bantuan={bantuanNomor ? `${bantuanNomor} Tidak tampil di katalog.` : 'Tidak tampil di katalog.'}>
      <input type="tel" name="nomor" inputMode="tel" maxLength={21} autoComplete="off" />
    </Field>
  </div>;
}
