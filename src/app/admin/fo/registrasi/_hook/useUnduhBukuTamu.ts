'use client';

// Unduh Buku Tamu (XLSX/CSV) sesuai filter. Galat tetap tampil di tempat (bukan hanya toast); terpotong = peringatan.
// Hasil terakhir hanya ditampilkan selama filter-nya masih sama (kunci filter), tanpa efek pembersih.
import { useCallback, useState } from 'react';
import { useToast } from '@/components/Toast';
import { paramFilter, unduhBukuTamu, type FilterBukuTamu, type FormatUnduh } from '@/lib/data/buku-tamu';
import { pesanBerhasilUnduh, pesanTerpotong } from '../_logika/bukuTamu';

function simpanBerkas(blob: Blob, nama: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nama;
  a.click();
  URL.revokeObjectURL(url);
}

interface HasilTerakhir {
  kunci: string;
  galat: string;
  peringatan: string;
}

export function useUnduhBukuTamu(filter: FilterBukuTamu) {
  const { toast } = useToast();
  const [sedang, setSedang] = useState<FormatUnduh | null>(null);
  const [hasil, setHasil] = useState<HasilTerakhir | null>(null);
  const kunci = paramFilter(filter).toString();

  const unduh = useCallback(async (format: FormatUnduh) => {
    setSedang(format);
    setHasil(null);
    const res = await unduhBukuTamu(filter, format);
    setSedang(null);
    if (res.error !== null) {
      setHasil({ kunci, galat: res.error, peringatan: '' });
      return;
    }
    simpanBerkas(res.data.blob, res.data.nama);
    if (res.data.terpotong) {
      setHasil({ kunci, galat: '', peringatan: pesanTerpotong() });
      toast(pesanTerpotong(), 'warning');
    } else {
      toast(pesanBerhasilUnduh(format), 'success');
    }
  }, [filter, kunci, toast]);

  const terkini = hasil && hasil.kunci === kunci ? hasil : null;
  return { sedang, galat: terkini?.galat ?? '', peringatan: terkini?.peringatan ?? '', unduh };
}
