'use client';

// Kartu "Status hari ini": kesegaran data, cakupan antrean, dan pesan keadaan (mis. migrasi belum diterapkan),
// ditambah pintasan ke antrean dan layar TV bila peran berhak. Tautan mengikuti admin-nav.ts (Antrian: semua peran,
// Kelola Layar: Admin saja).
import { List, Tv } from 'lucide-react';
import Kartu from '@/components/ui/Kartu';
import Tombol from '@/components/ui/Tombol';
import BilahStatus, { type ItemBilahStatus } from '@/components/ui/grafik/BilahStatus';

interface Props {
  item: ItemBilahStatus[];
  adalahAdmin: boolean;
  className?: string;
}

export default function StatusHariIni({ item, adalahAdmin, className }: Props) {
  return (
    <Kartu
      judul="Status hari ini"
      className={className}
      aksi={
        <>
          <Tombol href="/admin/antrian" varian="hantu" ukuran="kecil" ikon={List}>
            Lihat antrean
          </Tombol>
          {adalahAdmin && (
            <Tombol href="/admin/layar" varian="hantu" ukuran="kecil" ikon={Tv}>
              Kelola layar TV
            </Tombol>
          )}
        </>
      }
    >
      <BilahStatus item={item} />
    </Kartu>
  );
}
