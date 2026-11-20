'use client';

import Field from '@/components/ui/Field';
import type { GalatForm } from '../_logika/validasi';
import type { KunciForm, NilaiForm } from '../_logika/nilai-form';

export interface DasarIsian {
  nilai: NilaiForm;
  galat: GalatForm;
  ubah: (kunci: KunciForm, v: string) => void;
  nonaktif?: boolean;
}
type Umum = DasarIsian & { k: KunciForm; label: string; bantuan?: string; wajib?: boolean; lebar?: boolean };

export function Teks({ k, label, bantuan, wajib, nilai, galat, ubah, nonaktif, tipe = 'text', mode, placeholder, maks }:
  Umum & { tipe?: string; mode?: 'numeric' | 'decimal' | 'email' | 'tel' | 'url'; placeholder?: string; maks?: number }) {
  return (
    <Field label={label} bantuan={bantuan} galat={galat[k]} wajib={wajib}>
      <input type={tipe} inputMode={mode} value={nilai[k]} placeholder={placeholder} maxLength={maks} disabled={nonaktif}
        onChange={(e) => ubah(k, e.target.value)} />
    </Field>
  );
}

export function Area({ k, label, bantuan, wajib, nilai, galat, ubah, nonaktif, baris = 4, maks }: Umum & { baris?: number; maks?: number }) {
  return (
    <Field label={label} bantuan={bantuan} galat={galat[k]} wajib={wajib}>
      <textarea rows={baris} value={nilai[k]} maxLength={maks} disabled={nonaktif} onChange={(e) => ubah(k, e.target.value)} />
    </Field>
  );
}

export function Pilih({ k, label, bantuan, wajib, nilai, galat, ubah, nonaktif, pilihan, kosong }:
  Umum & { pilihan: { nilai: string; label: string }[]; kosong?: string }) {
  return (
    <Field label={label} bantuan={bantuan} galat={galat[k]} wajib={wajib}>
      <select value={nilai[k]} disabled={nonaktif} onChange={(e) => ubah(k, e.target.value)}>
        <option value="">{kosong ?? 'Pilih...'}</option>
        {pilihan.map((p) => <option key={p.nilai} value={p.nilai}>{p.label}</option>)}
      </select>
    </Field>
  );
}
