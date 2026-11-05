'use client';

import ErrorRetry from '@/components/ErrorRetry';
import { cn } from '@/lib/utils';
import styles from './Galat.module.css';

export interface GalatProps {
  pesan: string;
  judul?: string;
  onRetry?: () => void;
  memuat?: boolean;
  labelTombol?: string;
  className?: string;
}

// Pembungkus ErrorRetry (tidak diubah) dengan rupa kartu "Dasbor". role="alert" datang dari ErrorRetry,
// jadi dipasang hanya saat komponen ini muncul karena galat baru; jangan dirender permanen.
export default function Galat({ className, ...sisa }: GalatProps) {
  return (
    <div className={cn(styles.galat, className)}>
      <ErrorRetry {...sisa} />
    </div>
  );
}
