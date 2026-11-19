'use client';

import { Archive, RotateCcw, Save, Send, Trash2 } from 'lucide-react';
import Lencana from '@/components/ui/Lencana';
import Tombol from '@/components/ui/Tombol';
import type { IproAdmin } from '@/lib/data/investasi';
import { LABEL_STATUS, LABEL_SUMBER, NADA_STATUS } from '../_logika/label';
import type { SumberIpro } from '../_logika/nilai-form';
import type { AksiKonfirmasi } from '../_hook/useFormIpro';
import styles from '../../FormIpro.module.css';

export interface PropsKepalaAksi {
  proyek: IproAdmin | null;
  sumber: SumberIpro;
  kotor: boolean;
  sedang: null | 'simpan' | 'status';
  onSimpan: () => void;
  onAksi: (aksi: AksiKonfirmasi) => void;
}

// Status, jenis, dan aksi. Terbit/arsip/kembali ke draf memakai data tersimpan, jadi dinonaktifkan saat ada perubahan belum disimpan.
export default function KepalaAksi({ proyek, sumber, kotor, sedang, onSimpan, onAksi }: PropsKepalaAksi) {
  const sibuk = sedang !== null;
  const tahan = sibuk || kotor;
  return (
    <div className={styles.kepalaAksi}>
      <div className={styles.lencanaBaris}>
        <Lencana nada="info">{LABEL_SUMBER[sumber]}</Lencana>
        {proyek ? <Lencana nada={NADA_STATUS[proyek.status]} titik>{LABEL_STATUS[proyek.status]}</Lencana> : <Lencana titik>Belum disimpan</Lencana>}
        {kotor && <span className={styles.catatan}>Ada perubahan yang belum disimpan.</span>}
      </div>
      <div className={styles.aksiBaris}>
        <Tombol type="button" ikon={Save} onClick={onSimpan} memuat={sedang === 'simpan'} disabled={sibuk && sedang !== 'simpan'}>
          {proyek ? 'Simpan perubahan' : 'Simpan draf'}
        </Tombol>
        {proyek && proyek.status !== 'terbit' && (
          <Tombol type="button" varian="sekunder" ikon={Send} disabled={tahan} onClick={() => onAksi('terbit')}>Terbitkan</Tombol>
        )}
        {proyek && proyek.status !== 'draf' && (
          <Tombol type="button" varian="sekunder" ikon={RotateCcw} disabled={tahan} onClick={() => onAksi('kembali_draf')}>Kembalikan ke draf</Tombol>
        )}
        {proyek && proyek.status !== 'arsip' && (
          <Tombol type="button" varian="sekunder" ikon={Archive} disabled={tahan} onClick={() => onAksi('arsip')}>Arsipkan</Tombol>
        )}
        {proyek?.status === 'draf' && (
          <Tombol type="button" varian="bahaya" ikon={Trash2} disabled={tahan} onClick={() => onAksi('hapus')}>Hapus draf</Tombol>
        )}
      </div>
    </div>
  );
}
