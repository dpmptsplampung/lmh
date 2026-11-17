'use client';

// Langkah 2 wizard Mulai Layanan: isian Pendataan Khusus aktif Layanan (label, wajib, jenis, opsi terkini) dengan simpan
// otomatis ke draf. Tampilan dari props; state draf di useDrafKhusus.
import { useId } from 'react';
import Skeleton from '@/components/ui/Skeleton';
import Tombol from '@/components/ui/Tombol';
import PendataanKhususFields from '@/components/admin/PendataanKhususFields';
import type { FieldKhusus } from '@/lib/pendataan-khusus/jenis';
import IndikatorDraf from './IndikatorDraf';
import type { useDrafKhusus } from './useDrafKhusus';
import styles from './MulaiLayanan.module.css';

interface Props {
  fields: readonly FieldKhusus[];
  draf: ReturnType<typeof useDrafKhusus>;
  bolehUbah: boolean;
}

export default function LangkahPendataan({ fields, draf, bolehUbah }: Props) {
  const idDasar = useId();
  if (draf.memuat) return <Skeleton bentuk="kartu" jumlah={1} label="Memuat draf pendataan…" />;
  if (draf.galatMuat) {
    return (
      <div>
        <p role="alert" className={styles.galat}>{draf.galatMuat}</p>
        <Tombol varian="sekunder" ukuran="kecil" onClick={draf.muatUlang}>Coba lagi</Tombol>
      </div>
    );
  }
  return (
    <>
      <p className={styles.ringkas}>
        Isi data Pendataan Khusus sambil melayani. Perubahan disimpan otomatis sebagai draf; tiket baru benar-benar
        dikunci saat Anda menekan Selesai di daftar antrean.
      </p>
      <IndikatorDraf status={draf.status} terakhir={draf.simpanTerakhir} galat={draf.galatSimpan} bolehUbah={bolehUbah} />
      <div className={styles.badanIsian}>
        <PendataanKhususFields
          idDasar={idDasar}
          fields={[...fields]}
          nilai={draf.nilai}
          onNilai={draf.ubah}
          galat={{}}
          disabled={!bolehUbah}
        />
      </div>
    </>
  );
}
