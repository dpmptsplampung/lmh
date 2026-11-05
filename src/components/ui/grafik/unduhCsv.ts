import { toCsv } from '@/lib/csv';
import type { TabelGrafik } from './tipe';

/** Isi CSV dari tabel grafik (RFC 4180, lewat lib/csv.ts). */
export function csvDariTabel(tabel: TabelGrafik): string {
  return toCsv(
    tabel.kolom.map((k) => ({ key: k.kunci, label: k.label })),
    tabel.baris,
  );
}

/** Memicu unduhan CSV di peramban. BOM UTF-8 agar Excel membaca huruf non-ASCII dengan benar. */
export function unduhCsv(namaBerkas: string, tabel: TabelGrafik): void {
  const blob = new Blob(['﻿', csvDariTabel(tabel)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaBerkas.endsWith('.csv') ? namaBerkas : `${namaBerkas}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
