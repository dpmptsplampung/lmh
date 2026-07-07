import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/constants';

export const metadata: Metadata = {
  title: `Dashboard Saya | ${APP_NAME}`,
  description: 'Dashboard pengunjung — akses layanan, buat reservasi, dan lihat QR code kunjungan.',
};

export default function MeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
