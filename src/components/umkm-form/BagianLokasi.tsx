'use client';

import { useId, useState } from 'react';
import Field from '@/components/ui/Field';
import type { Revisi } from '@/lib/umkm-katalog/types';
import { KABUPATEN_KOTA, kecamatanDari } from '@/lib/umkm-katalog/wilayah';
import styles from './umkm-form.module.css';

type Props = { awal?: Partial<Revisi>; galat?: Record<string, string> };

// Kecamatan hanya saran (datalist): isian bebas tetap diterima.
export default function BagianLokasi({ awal, galat = {} }: Props) {
  const idDaftar = useId();
  const [kabupaten, setKabupaten] = useState(
    awal?.kabupaten_kota && KABUPATEN_KOTA.includes(awal.kabupaten_kota) ? awal.kabupaten_kota : '');
  return <div className={styles.bidang}>
    <Field label="Kabupaten/kota" galat={galat.kabupaten_kota}>
      <select name="kabupaten_kota" value={kabupaten} onChange={(e) => setKabupaten(e.target.value)}>
        <option value="">Pilih kabupaten/kota</option>
        {KABUPATEN_KOTA.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </Field>
    <Field label="Kecamatan (opsional)" galat={galat.kecamatan}>
      <input name="kecamatan" list={idDaftar} defaultValue={awal?.kecamatan ?? ''} maxLength={100} autoComplete="off" />
    </Field>
    <datalist id={idDaftar}>
      {kecamatanDari(kabupaten).map((k) => <option key={k} value={k} />)}
    </datalist>
    <Field label="Alamat (privat, opsional)" galat={galat.alamat} className={styles.lebar}
      bantuan="Alamat tidak tampil di katalog.">
      <input name="alamat" defaultValue={awal?.alamat ?? ''} maxLength={500} />
    </Field>
  </div>;
}
