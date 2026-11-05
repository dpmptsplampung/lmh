'use client';

import { useId, type ReactNode } from 'react';
import Field from '@/components/ui/Field';
import PemilihRentang from '@/components/ui/PemilihRentang';
import { kenaliPreset, LABEL_PRESET, rentangPreset, type Preset } from '@/lib/survei/rentang';
import styles from './pesanPerilaku.module.css';

export default function FilterHasil({ dari, sampai, hariIni, onUbah, children }: {
  dari: string; sampai: string; hariIni: string;
  onUbah: (rentang: { dari: string; sampai: string }) => void;
  children?: ReactNode;
}) {
  const id = useId();
  const preset = kenaliPreset(dari, sampai, hariIni);
  return (
    <div className={styles.filter}>
      <Field label="Periode">
        <select id={id} value={preset} onChange={(e) => {
          const p = e.target.value as Preset;
          if (p !== 'kustom') onUbah(rentangPreset(p, hariIni));
        }}>
          {(Object.keys(LABEL_PRESET) as Exclude<Preset, 'kustom'>[]).map((p) => <option key={p} value={p}>{LABEL_PRESET[p]}</option>)}
          <option value="kustom" disabled={preset !== 'kustom'}>Rentang tanggal sendiri</option>
        </select>
      </Field>
      <PemilihRentang dari={dari} sampai={sampai} onUbah={onUbah} label="Rentang tanggal" />
      {children && <div className={styles.aksi}>{children}</div>}
    </div>
  );
}
