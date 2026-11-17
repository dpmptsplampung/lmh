import type { Metadata } from 'next';
import Sidebar from '@/components/layout/Sidebar';
import AdminGuard from '@/components/layout/AdminGuard';
import SesiStafGuard from '@/components/layout/SesiStafGuard';
import OfflineReplayer from '@/components/admin/OfflineReplayer';
// Cangkang yang sama dengan area admin (sidebar melayang + kolom isi); hanya menu, guard, dan rute yang berbeda.
import styles from '../admin/admin.module.css';
import { APP_NAME } from '@/lib/constants';

export const metadata: Metadata = {
  title: {
    default: `Panel Petugas | ${APP_NAME}`,
    template: `%s | Petugas ${APP_NAME}`,
  },
};

// Area Petugas Layanan (/petugas/*). Admin dan Front Office tetap di /admin/*. Rute ditegakkan di proxy.ts;
// AdminGuard hanya lapisan UX. Halaman di bawah ini HANYA merakit ulang halaman dan komponen area admin
// (tanpa menyalin logika), jadi perilaku, state, dan tes tetap satu sumber.
export default function PetugasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.adminLayout} data-tema="dasbor">
      <Sidebar />
      <div className={styles.adminContent}>
        <SesiStafGuard />
        <OfflineReplayer />
        <AdminGuard>{children}</AdminGuard>
      </div>
    </div>
  );
}
