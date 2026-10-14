// Registrasi Pengunjung: walk-in dan scan QR reservasi dalam satu halaman bertab (?tab=walkin|scan).
// Komponen bertab memakai useSearchParams, jadi dibungkus Suspense (guide Next.js: useSearchParams).
import { Suspense } from 'react';
import PageHeader from '@/components/layout/PageHeader';
import RegistrasiPengunjung from '@/components/fo/RegistrasiPengunjung';

export default function RegistrasiPage() {
  return (
    <>
      <PageHeader
        title="Registrasi Pengunjung"
        description="Daftarkan pengunjung walk-in atau pindai QR reservasi. Tiket antrean baru terbit saat Anda mengeskalasi ke petugas layanan."
      />
      <Suspense fallback={<p role="status" style={{ padding: 'var(--space-8)' }}>Memuat…</p>}>
        <RegistrasiPengunjung />
      </Suspense>
    </>
  );
}
