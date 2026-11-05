'use client';

import KerangkaModal, { type KerangkaModalProps } from './KerangkaModal';

export type PanelSampingProps = Omit<KerangkaModalProps, 'varian'>;

// Panel kanan penuh tinggi (di HP menjadi lembar bawah). Perilaku sama dengan Dialog; `lebar` = 'sedang' (440px) | 'lebar' (640px).
export default function PanelSamping(props: PanelSampingProps) {
  return <KerangkaModal {...props} varian="samping" />;
}
