import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/constants';

import ProfileCompletenessGate from '@/components/ProfileCompletenessGate';
import CangkangPengunjung from './_cangkang/CangkangPengunjung';

export const metadata: Metadata = {
  title: `Dasbor Saya | ${APP_NAME}`,
  description: 'Dasbor pengunjung: akses layanan, buat reservasi, dan lihat QR code kunjungan.',
};

export default function MeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProfileCompletenessGate>
      <CangkangPengunjung>{children}</CangkangPengunjung>
    </ProfileCompletenessGate>
  );
}
