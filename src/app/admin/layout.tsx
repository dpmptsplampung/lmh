import type { Metadata } from 'next';
import Sidebar from '@/components/layout/Sidebar';
import styles from './admin.module.css';
import { APP_NAME } from '@/lib/constants';

export const metadata: Metadata = {
  title: {
    default: `Panel Admin | ${APP_NAME}`,
    template: `%s | Admin ${APP_NAME}`,
  },
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={styles.adminLayout}>
      <Sidebar />
      <div className={styles.adminContent}>
        {children}
      </div>
    </div>
  );
}
