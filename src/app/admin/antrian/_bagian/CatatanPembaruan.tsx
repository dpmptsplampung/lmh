'use client';

// Catatan "pembaruan terakhir gagal" di atas daftar: muat ulang senyap (Realtime/polling) gagal, data lama tetap tampil.
import CatatanKeadaan from '@/components/ui/CatatanKeadaan';
import Tombol from '@/components/ui/Tombol';
import { formatWaktu } from '@/lib/utils';

export interface CatatanPembaruanProps {
  /** Waktu muat sukses terakhir (ISO); null bila belum pernah. */
  terakhir: string | null;
  menyegarkan: boolean;
  onMuatUlang: () => void;
}

export default function CatatanPembaruan({ terakhir, menyegarkan, onMuatUlang }: CatatanPembaruanProps) {
  return (
    <CatatanKeadaan
      jenis="info"
      aksi={
        <Tombol varian="hantu" ukuran="kecil" onClick={() => onMuatUlang()} disabled={menyegarkan} memuat={menyegarkan}>
          {menyegarkan ? 'Memuat…' : 'Muat ulang'}
        </Tombol>
      }
    >
      Pembaruan terakhir gagal; data di bawah mungkin belum terbaru.
      {terakhir && <> Terakhir diperbarui {formatWaktu(terakhir)} WIB.</>}
    </CatatanKeadaan>
  );
}
