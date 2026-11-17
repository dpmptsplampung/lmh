// Registrasi Pengunjung: walk-in, scan QR reservasi, dan Buku Tamu dalam satu halaman bertab (?tab=walkin|scan|bukutamu).
// Komponen bertab memakai useSearchParams, jadi dibungkus Suspense (guide Next.js: useSearchParams).
import { Suspense } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import Skeleton from '@/components/ui/Skeleton';
import styles from '../fo-halaman.module.css';
import RegistrasiPengunjung from '@/components/fo/RegistrasiPengunjung';

export default function RegistrasiPage() {
  return (
    <>
      <PageHeader
        title="Registrasi Pengunjung"
        description="Daftarkan pengunjung walk-in, pindai QR reservasi, atau catat tamu kantor di Buku Tamu. Tiket antrean baru terbit saat Anda mengeskalasi ke petugas layanan."
      />
      <Suspense fallback={<div className={styles.halaman}><Skeleton bentuk="kartu" jumlah={2} label="Memuat registrasi…" /></div>}>
        <RegistrasiPengunjung />
      </Suspense>
    </>
  );
}
